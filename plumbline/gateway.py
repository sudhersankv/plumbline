"""gateway: the only door to models.

Three kinds of call:
  complete(task, ...)  LLM text or structured output (Claude via Neon AI Gateway, or SubQ Savant)
  decide(task, ...)    typed decisions (SubQ Snap): many questions over one large context
  embed(texts)         embeddings (Neon AI Gateway)

Each call is routed by task (routing table in Postgres), retried, falls back to a backup model,
cached, and logged with tokens, cost and latency against the current run or benchmark.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

import httpx

from . import config, db

# ─── Context: which run or benchmark is this call part of ──────────────────────
current_run: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_run", default=None)
current_benchmark: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_benchmark", default=None)
current_setup: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_setup", default=None)
use_cache: contextvars.ContextVar[bool] = contextvars.ContextVar("use_cache", default=True)


def pmap(fn: Callable, items: Iterable, workers: int = 8) -> list:
    """Parallel map that keeps context (current run/benchmark) in worker threads."""
    items = list(items)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(contextvars.copy_context().run, fn, it) for it in items]
        return [f.result() for f in futs]


# ─── Routing table ─────────────────────────────────────────────────────────────
# shape: per_item (retrieve then judge each item) | batched (Snap: all items as typed questions
# over the whole corpus) | long_context (Savant: whole corpus, all items, one call) | cascade
DEFAULT_ROUTES: dict[str, tuple[dict, str]] = {
    "extract_requirements": ({"provider": "anthropic", "model": config.STRONG_MODEL, "fallback": config.FALLBACK_MODEL},
                             "Run once per regulation; output reviewed by a person."),
    "judge_gap": ({"shape": "per_item", "provider": "anthropic", "model": config.STRONG_MODEL,
                   "fallback": config.FALLBACK_MODEL, "k": 5}, "Benchmarked. Start on the strong LLM."),
    "judge_evidence": ({"shape": "per_item", "provider": "anthropic", "model": config.STRONG_MODEL,
                        "fallback": config.FALLBACK_MODEL, "k": 3}, "Benchmarked. The main comparison."),
    "explain_evidence": ({"provider": "anthropic", "model": config.CHEAP_MODEL, "fallback": config.FALLBACK_MODEL},
                         "Only for items a reviewer reads."),
    "rate_severity": ({"provider": "subq-snap", "model": config.SNAP_MODEL},
                      "Snap score question over the whole policy set."),
}

_PROVIDERS = {
    "anthropic": "Neon AI Gateway",
    "subq-chat": "SubQ",
    "subq-snap": "SubQ",
    "neon-embed": "Neon AI Gateway",
}


def seed_routes(reset: bool = False) -> None:
    for task, (route, note) in DEFAULT_ROUTES.items():
        if reset:
            db.q("delete from routes where task=%s", task)
        db.q("insert into routes(task, route, note) values (%s,%s,%s) on conflict (task) do nothing",
             task, db.J(route), note)


def get_route(task: str) -> dict:
    row = db.one("select route from routes where task=%s", task)
    if row:
        return row["route"]
    if task in DEFAULT_ROUTES:
        return DEFAULT_ROUTES[task][0]
    raise KeyError(f"No route for task {task!r}")


def set_route(task: str, route: dict) -> None:
    db.q("insert into routes(task, route) values (%s,%s) on conflict (task) do update set route=excluded.route, updated_at=now()",
         task, db.J(route))
    db.q("insert into route_history(task, route) values (%s,%s)", task, db.J(route))


# ─── Results and logging ───────────────────────────────────────────────────────
@dataclass
class CallResult:
    data: Any
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0       # cost of producing this answer (original call, even if served from cache)
    latency_ms: int = 0         # latency of the original call
    cached: bool = False
    fallback_from: str | None = None
    calls: int = 1
    extra: dict = field(default_factory=dict)


class GatewayError(RuntimeError):
    pass


def _log(task: str, kind: str, r: CallResult, attempts: int = 1, error: str | None = None) -> None:
    try:
        db.q(
            # cost and latency are the original call's; `cached` says whether this time it was free and instant
            """insert into model_calls(run_id, benchmark_id, setup, task, kind, provider, model, input_tokens,
               output_tokens, cost_usd, latency_ms, cached, fallback_from, attempts, error)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            current_run.get(), current_benchmark.get(), current_setup.get(), task, kind, r.provider, r.model,
            r.input_tokens, r.output_tokens, r.cost_usd, r.latency_ms, r.cached, r.fallback_from, attempts, error,
        )
    except Exception as e:  # logging must never break a workflow
        print("gateway: log failed:", e)


def _cache_key(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


def _cache_get(key: str) -> dict | None:
    if not use_cache.get():
        return None
    row = db.one("select response from cache where key=%s", key)
    return row["response"] if row else None


def _cache_put(key: str, value: dict) -> None:
    db.q("insert into cache(key, response) values (%s,%s) on conflict (key) do update set response=excluded.response",
         key, db.J(value))


# ─── HTTP ──────────────────────────────────────────────────────────────────────
_client = httpx.Client(timeout=httpx.Timeout(600.0, connect=20.0))
_limits = {"anthropic": threading.Semaphore(8), "subq": threading.Semaphore(4), "embed": threading.Semaphore(4)}
RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 504, 529}


def _post(url: str, headers: dict, body: dict, limit: str) -> tuple[dict, int]:
    with _limits[limit]:
        t0 = time.perf_counter()
        r = _client.post(url, headers=headers, json=body)
        ms = int((time.perf_counter() - t0) * 1000)
    if r.status_code >= 400:
        err = GatewayError(f"{r.status_code} from {url}: {r.text[:400]}")
        err.status = r.status_code  # type: ignore[attr-defined]
        raise err
    return r.json(), ms


def _with_retries(fn: Callable[[], CallResult], tries: int = 3) -> tuple[CallResult, int]:
    last: Exception | None = None
    for attempt in range(1, tries + 1):
        try:
            return fn(), attempt
        except (GatewayError, httpx.TransportError, ValueError, KeyError) as e:
            last = e
            status = getattr(e, "status", None)
            if status is not None and status not in RETRYABLE:
                break
            time.sleep(min(2 ** attempt, 20))
    raise GatewayError(str(last))


# ─── complete() ────────────────────────────────────────────────────────────────
def _anthropic(model: str, system: str, user: str, schema: dict | None, max_tokens: int, effort: str) -> CallResult:
    sys_block: dict = {"type": "text", "text": system}
    if len(system) > 4000:  # long, reused document context: let the provider cache it
        sys_block["cache_control"] = {"type": "ephemeral"}
    # Current Claude models think adaptively; effort is the depth/cost control. Structured output via
    # output_config.format (forced tool_choice is rejected by Opus 5.5).
    output_config: dict = {"effort": effort}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": _strict(schema)}
    body: dict = {"model": model, "max_tokens": max_tokens, "system": [sys_block], "output_config": output_config,
                  "messages": [{"role": "user", "content": user}]}
    resp, ms = _post(f"{config.NEON_BASE}/anthropic/v1/messages",
                     {"Authorization": f"Bearer {config.NEON_TOKEN}", "anthropic-version": "2023-06-01"}, body, "anthropic")
    if resp.get("stop_reason") == "refusal":
        raise ValueError(f"model refused: {resp.get('stop_details')}")
    if resp.get("stop_reason") == "max_tokens":
        raise ValueError("hit max_tokens before finishing")
    text = "".join(b.get("text", "") for b in resp["content"] if b.get("type") == "text")
    data = json.loads(text) if schema else text
    u = resp.get("usage", {})
    cr, cw = u.get("cache_read_input_tokens", 0) or 0, u.get("cache_creation_input_tokens", 0) or 0
    it, ot = u.get("input_tokens", 0), u.get("output_tokens", 0)
    return CallResult(data, "anthropic", model, it + cr + cw, ot, config.cost_usd(model, it, ot, cr, cw), ms,
                      extra={"cache_read_tokens": cr, "cache_write_tokens": cw})


def _strict(schema: dict) -> dict:
    """SubQ strict JSON schema: every object lists all properties as required, no extras."""
    s = dict(schema)
    if s.get("type") == "object":
        props = {k: _strict(v) for k, v in s.get("properties", {}).items()}
        s.update(properties=props, required=list(props), additionalProperties=False)
    if s.get("type") == "array" and "items" in s:
        s["items"] = _strict(s["items"])
    s.pop("minimum", None), s.pop("maximum", None)
    return s


def _subq_chat(model: str, system: str, user: str, schema: dict | None, max_tokens: int, effort: str) -> CallResult:
    body: dict = {"model": model, "max_tokens": max_tokens, "reasoning_effort": effort,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if schema:
        body["response_format"] = {"type": "json_schema",
                                   "json_schema": {"name": "result", "strict": True, "schema": _strict(schema)}}
    resp, ms = _post(f"{config.SUBQ_BASE}/chat/completions", {"Authorization": f"Bearer {config.SUBQ_KEY}"}, body, "subq")
    content = resp["choices"][0]["message"].get("content")
    if not content:
        raise ValueError("empty content (reasoning used the whole token budget)")
    data = json.loads(content) if schema else content
    u = resp.get("usage", {})
    it, ot = u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
    cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
    return CallResult(data, "subq-chat", model, it, ot, config.cost_usd(model, it - cached, ot, cached), ms)


def complete(task: str, system: str, user: str, schema: dict | None = None, *, route: dict | None = None,
             max_tokens: int = 2000) -> CallResult:
    route = route or get_route(task)
    provider, model = route["provider"], route["model"]
    effort = route.get("reasoning_effort", "low")
    key = _cache_key("complete", provider, model, system, user, schema, max_tokens, effort)
    hit = _cache_get(key)
    if hit:
        r = CallResult(**hit)
        r.cached = True
        _log(task, "complete", r)
        return r

    def call(m: str) -> CallResult:
        if provider == "anthropic":
            return _anthropic(m, system, user, schema, max_tokens, effort)
        if provider == "subq-chat":
            return _subq_chat(m, system, user, schema, max(max_tokens, 8000), effort)
        raise GatewayError(f"complete() cannot use provider {provider}")

    try:
        r, attempts = _with_retries(lambda: call(model))
    except GatewayError as e:
        fb = route.get("fallback")
        if not fb:
            _log(task, "complete", CallResult(None, provider, model), error=str(e)[:500])
            raise
        r, attempts = _with_retries(lambda: call(fb))
        r.fallback_from = model
    _cache_put(key, {k: v for k, v in r.__dict__.items() if k != "cached"})
    _log(task, "complete", r, attempts)
    return r


# ─── decide() ──────────────────────────────────────────────────────────────────
MAX_QUESTIONS = 128


def decide(task: str, state: Any, questions: dict[str, dict], *, route: dict | None = None) -> CallResult:
    """Ask SubQ Snap many typed questions about one state. Splits into calls of <=128 questions.

    questions: {name: {"type": "choice"|"noul"|"score", "instructions": str, "criteria": ...}}
    Returns CallResult with data = {name: answer}, summed tokens/cost, and the slowest call's latency.
    """
    route = route or get_route(task)
    model = route.get("model", config.SNAP_MODEL)
    names = list(questions)
    size = int(route.get("max_questions", MAX_QUESTIONS))
    chunks = [names[i:i + size] for i in range(0, len(names), size)]

    def one_chunk(chunk: list[str]) -> CallResult:
        body = {"model": model, "state": state, "questions": {n: questions[n] for n in chunk}}
        key = _cache_key("decide", body)
        hit = _cache_get(key)
        if hit:
            r = CallResult(**hit)
            r.cached = True
            _log(task, "decide", r)
            return r

        def call() -> CallResult:
            resp, ms = _post(f"{config.SUBQ_BASE}/systemone", {"Authorization": f"Bearer {config.SUBQ_KEY}"}, body, "subq")
            it = resp.get("usage", {}).get("input_tokens", 0)
            return CallResult(resp["answers"], "subq-snap", model, it, 0, config.cost_usd(model, it, 0), ms)

        r, attempts = _with_retries(call)
        _cache_put(key, {k: v for k, v in r.__dict__.items() if k != "cached"})
        _log(task, "decide", r, attempts)
        return r

    parts = pmap(one_chunk, chunks, workers=4)
    answers: dict = {}
    for p in parts:
        answers.update(p.data)
    return CallResult(answers, "subq-snap", model, sum(p.input_tokens for p in parts), 0,
                      sum(p.cost_usd for p in parts), max(p.latency_ms for p in parts),
                      cached=all(p.cached for p in parts), calls=len(parts))


# ─── embed() ───────────────────────────────────────────────────────────────────
def embed(texts: list[str], task: str = "embed") -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        batch = texts[i:i + 64]
        body = {"model": config.EMBEDDING_MODEL, "input": batch, "dimensions": config.EMBEDDING_DIMENSIONS}

        def call() -> CallResult:
            resp, ms = _post(f"{config.NEON_BASE}/v1/embeddings", {"Authorization": f"Bearer {config.NEON_TOKEN}"},
                             body, "embed")
            vecs = [d["embedding"] for d in sorted(resp["data"], key=lambda d: d["index"])]
            return CallResult(vecs, "neon-embed", config.EMBEDDING_MODEL,
                              resp.get("usage", {}).get("prompt_tokens", 0), 0, 0.0, ms)

        r, attempts = _with_retries(call)
        _log(task, "embed", r, attempts)
        out.extend(r.data)
    return out


def provider_label(provider: str) -> str:
    return _PROVIDERS.get(provider, provider)
