"""judge: run a labelling task over many items in the shape its route asks for.

Shapes (set in the routing table, so changing one is a config change):
  per_item      retrieve k passages per item, one model call per item (LLM, or Snap as a control)
  batched       SubQ Snap: whole corpus as `state`, every item as a typed question, one call per 128 questions
  long_context  whole corpus in the prompt, every item answered in one call (SubQ Savant or Claude)
  cascade       run `first`; escalate low-confidence or non-positive items to `then`

Every shape returns the same Verdict records, and every citation goes through cite.verify.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from . import cite, gateway, retrieve
from .tasks import Item, TaskSpec


@dataclass
class Verdict:
    item_id: str
    label: str
    setup: str
    confidence: float | None = None
    probabilities: dict | None = None
    paragraph_ids: list[str] = field(default_factory=list)
    quote: str | None = None
    reason: str | None = None
    regulation_quote: str | None = None
    severity: str | None = None
    explanation: str | None = None
    citation_status: str = "verified"
    citation_notes: list[str] = field(default_factory=list)
    latency_ms: int = 0
    escalated: bool = False


SYSTEM = """You are a careful healthcare compliance analyst at a California Medi-Cal managed care health plan.
{instructions}

Rules:
- Use only the passages provided. Each passage starts with its paragraph ID in square brackets.
- Cite paragraph IDs exactly as shown. Cite every paragraph your verdict depends on (both sides of a conflict).
- `quote` must be copied word for word from one cited paragraph: one sentence or phrase, under 40 words. Empty if you cite nothing.
- `reason` is one or two plain sentences a reviewer can check.

Labels:
{labels}"""


def _labels_text(spec: TaskSpec) -> str:
    return "\n".join(f"- {k}: {v}" for k, v in spec.labels.items())


def _schema(spec: TaskSpec) -> dict:
    return {"type": "object", "properties": {
        "label": {"type": "string", "enum": list(spec.labels)},
        "paragraph_ids": {"type": "array", "items": {"type": "string"}},
        "quote": {"type": "string"},
        "reason": {"type": "string"},
    }, "required": ["label", "paragraph_ids", "quote", "reason"]}


def setup_name(route: dict) -> str:
    if route.get("name"):
        return route["name"]
    shape = route.get("shape", "per_item")
    if shape == "cascade":
        return f"cascade({setup_name(route['first'])}->{setup_name(route['then'])})"
    return f"{shape}:{route.get('model')}"


def _check(spec: TaskSpec, v: Verdict, lookup: dict[str, str], retrieved: set[str] | None, quote_from_model: bool) -> Verdict:
    c = cite.verify(label=v.label, paragraph_ids=v.paragraph_ids, quote=v.quote if quote_from_model else None,
                    corpus=lookup, retrieved_ids=retrieved, needs_citation=v.label not in spec.no_citation)
    v.citation_status, v.citation_notes = c.status, c.notes
    if v.label not in spec.labels:
        v.citation_status = "needs_review"
        v.citation_notes = v.citation_notes + [f"model gave no usable answer ({v.label})"]
    return v


# ─── per_item ──────────────────────────────────────────────────────────────────
def _passages(hits) -> str:
    return "\n\n".join(f"[{h.id}] {h.text}" for h in hits)


def _per_item(spec: TaskSpec, item: Item, plan: str, route: dict, lookup: dict[str, str]) -> Verdict:
    hits = retrieve.search(item.query, plan, spec.kind, k=int(route.get("k", 5)))
    retrieved = {h.id for h in hits}
    name = setup_name(route)
    if route["provider"] == "subq-snap":  # Snap given the same input as an LLM: a control, not its intended use
        state = f"{item.question}\n\nPASSAGES:\n{_passages(hits)}"
        r = gateway.decide(spec.name, state, {
            "verdict": {"type": "choice", "instructions": spec.instructions, "criteria": dict(spec.labels)},
            "where": {"type": "choice", "instructions": "Which passage most directly decides the verdict?",
                      "criteria": {**{h.id: None for h in hits}, "not_found": "No passage addresses it."}},
        }, route=route)
        a, w = r.data["verdict"], r.data["where"]
        pid = w.get("choice")
        v = Verdict(item.id, a.get("choice", "no_answer"), name, a.get("confidence"), a.get("probabilities"),
                    [pid] if pid and pid != "not_found" else [], lookup.get(pid) if pid in lookup else None,
                    latency_ms=r.latency_ms)
        return _check(spec, v, lookup, retrieved, quote_from_model=False)

    system = SYSTEM.format(instructions=spec.instructions, labels=_labels_text(spec))
    user = f"{item.question}\n\nPASSAGES:\n{_passages(hits)}"
    r = gateway.complete(spec.name, system, user, _schema(spec), route=route, max_tokens=16000)
    d = r.data
    v = Verdict(item.id, d.get("label", "no_answer"), name, paragraph_ids=list(d.get("paragraph_ids") or []),
                quote=d.get("quote") or None, reason=d.get("reason"), latency_ms=r.latency_ms)
    return _check(spec, v, lookup, retrieved, quote_from_model=True)


# ─── batched (SubQ Snap) ───────────────────────────────────────────────────────
MAX_OPTIONS = 254  # Snap allows 2-255 options per choice question; one is reserved for not_found


def _batched(spec: TaskSpec, items: list[Item], plan: str, route: dict, corpus_text: str,
             lookup: dict[str, str]) -> list[Verdict]:
    questions: dict[str, dict] = {}
    for i, it in enumerate(items):
        questions[f"v{i}"] = {"type": "choice", "instructions": f"{spec.instructions}\n\n{it.question}",
                              "criteria": dict(spec.labels)}
        if len(lookup) <= MAX_OPTIONS:
            options = list(lookup)
        else:  # too many paragraphs for one choice question: offer the closest ones
            options = [h.id for h in retrieve.search(it.query, plan, spec.kind, k=MAX_OPTIONS)]
        questions[f"p{i}"] = {"type": "choice",
                              "instructions": f"Which paragraph most directly decides this?\n\n{it.question}",
                              "criteria": {**{o: None for o in options}, "not_found": "No paragraph addresses it."}}
    t0 = time.perf_counter()
    r = gateway.decide(spec.name, corpus_text, questions, route=route)
    wall = r.latency_ms or int((time.perf_counter() - t0) * 1000)
    out = []
    for i, it in enumerate(items):
        a, w = r.data.get(f"v{i}", {}), r.data.get(f"p{i}", {})
        pid = w.get("choice")
        pids = [pid] if pid and pid != "not_found" else []
        v = Verdict(it.id, a.get("choice", "no_answer"), setup_name(route), a.get("confidence"), a.get("probabilities"),
                    pids, lookup.get(pid) if pids else None, latency_ms=wall)
        out.append(_check(spec, v, lookup, None, quote_from_model=False))
    return out


# ─── long_context (Savant or Claude) ───────────────────────────────────────────
def _long_context(spec: TaskSpec, items: list[Item], route: dict, corpus_text: str,
                  lookup: dict[str, str]) -> list[Verdict]:
    system = (SYSTEM.format(instructions=spec.instructions, labels=_labels_text(spec)) +
              "\n\nYou are given the plan's ENTIRE document set below. Check every document: a requirement met in one "
              "place can be contradicted or narrowed in another, including appendices and definitions.\n\n"
              f"DOCUMENTS:\n{corpus_text}")
    user = ("Give one verdict for every item below, in order, using its exact item_id.\n\n" +
            "\n\n".join(f"ITEM {it.id}\n{it.question}" for it in items))
    item_schema = _schema(spec)
    item_schema["properties"] = {"item_id": {"type": "string"}, **item_schema["properties"]}
    item_schema["required"] = ["item_id", *item_schema["required"]]
    schema = {"type": "object", "properties": {"verdicts": {"type": "array", "items": item_schema}}, "required": ["verdicts"]}
    r = gateway.complete(spec.name, system, user, schema, route=route, max_tokens=64000)
    got = {d.get("item_id"): d for d in (r.data or {}).get("verdicts", [])}
    out = []
    for it in items:
        d = got.get(it.id, {})
        v = Verdict(it.id, d.get("label", "no_answer"), setup_name(route), paragraph_ids=list(d.get("paragraph_ids") or []),
                    quote=d.get("quote") or None, reason=d.get("reason"), latency_ms=r.latency_ms)
        out.append(_check(spec, v, lookup, None, quote_from_model=True))
    return out


# ─── entry point ───────────────────────────────────────────────────────────────
def judge(spec: TaskSpec, items: list[Item], plan: str, route: dict | None = None) -> list[Verdict]:
    route = route or gateway.get_route(spec.name)
    shape = route.get("shape", "per_item")
    corpus_text, lookup = retrieve.corpus(plan, spec.kind)
    if shape == "per_item":
        vs = gateway.pmap(lambda it: _per_item(spec, it, plan, route, lookup), items, workers=8)
    elif shape == "batched":
        vs = _batched(spec, items, plan, route, corpus_text, lookup)
    elif shape == "long_context":
        vs = _long_context(spec, items, route, corpus_text, lookup)
    elif shape == "cascade":
        vs = judge(spec, items, plan, route["first"])
        threshold = float(route.get("threshold", 0.8))
        esc = [i for i, v in enumerate(vs)
               if v.label != spec.positive or v.confidence is None or v.confidence < threshold]
        if esc:
            redo = judge(spec, [items[i] for i in esc], plan, route["then"])
            for i, nv in zip(esc, redo):
                nv.escalated = True
                vs[i] = nv
        for v in vs:
            v.setup = setup_name(route)
    else:
        raise ValueError(f"unknown shape {shape}")
    for v, it in zip(vs, items):
        v.regulation_quote = it.regulation_quote  # never generated: always from the saved requirement
    return vs


# ─── follow-up tasks ───────────────────────────────────────────────────────────
SEVERITY_LEVELS = ["low", "medium", "high", "critical"]


def rate_severity(spec: TaskSpec, verdicts: list[Verdict], items: list[Item], plan: str) -> None:
    """Snap score question per problem verdict, over the whole corpus. Sets v.severity in place."""
    by_id = {it.id: it for it in items}
    bad = [v for v in verdicts if v.label != spec.positive and v.label in spec.labels]
    if not bad:
        return
    corpus_text, _ = retrieve.corpus(plan, spec.kind)
    qs = {f"s{i}": {"type": "score",
                    "instructions": ("How severe is the regulatory risk of this finding if a state auditor found it? "
                                     "Consider member harm, how many members are affected, and enforcement exposure.\n\n"
                                     f"{by_id[v.item_id].question}\nFinding: {v.label}. {v.reason or ''}"),
                    "criteria": ["low: paperwork or wording issue, no member impact",
                                 "medium: process weakness, limited member impact",
                                 "high: members could miss required care or protections",
                                 "critical: systemic failure or a missed regulatory deadline"]}
          for i, v in enumerate(bad)}
    r = gateway.decide("rate_severity", corpus_text, qs)
    for i, v in enumerate(bad):
        a = r.data.get(f"s{i}", {})
        probs = a.get("probabilities") or {}
        if probs:
            v.severity = SEVERITY_LEVELS[int(max(probs, key=lambda k: probs[k]))]


EXPLAIN_SYSTEM = """You write short explanations for compliance reviewers at a health plan.
Given an audit item, the verdict, and the evidence passages, explain in 2-3 plain sentences what is missing or weak and
what evidence would close it. Name paragraph IDs in square brackets. No preamble."""


def explain(task: str, spec: TaskSpec, verdicts: list[Verdict], items: list[Item], plan: str) -> None:
    by_id = {it.id: it for it in items}
    _, lookup = retrieve.corpus(plan, spec.kind)

    def one(v: Verdict) -> None:
        it = by_id[v.item_id]
        cited = [f"[{p}] {lookup[p]}" for p in v.paragraph_ids if p in lookup]
        if not cited:
            cited = [f"[{h.id}] {h.text}" for h in retrieve.search(it.query, plan, spec.kind, k=3)]
        user = (f"{it.question}\n\nVerdict: {v.label}" + (f" (confidence {v.confidence:.2f})" if v.confidence else "") +
                (f"\nModel's reason: {v.reason}" if v.reason else "") + "\n\nPassages:\n" + "\n\n".join(cited))
        v.explanation = gateway.complete(task, EXPLAIN_SYSTEM, user, max_tokens=2000).data.strip()

    gateway.pmap(one, verdicts, workers=8)
