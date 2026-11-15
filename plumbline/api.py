"""Platform API for the console. The UI only reads results and triggers runs; all logic stays in the platform."""

from __future__ import annotations

import json
import threading
import traceback
from pathlib import Path

import base64
import os
import secrets

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import benchmark, config, db, gateway, runs, tasks, workflows
from .documents import load

app = FastAPI(title="Plumbline platform API")

# Optional basic auth for a hosted demo: runs spend real model credits, so a public URL stays behind a password.
_PASSWORD = os.environ.get("CONSOLE_PASSWORD", "").strip()


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if _PASSWORD and request.url.path != "/healthz":
        ok = False
        h = request.headers.get("authorization", "")
        if h.startswith("Basic "):
            try:
                _, _, pw = base64.b64decode(h[6:]).decode().partition(":")
                ok = secrets.compare_digest(pw, _PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Plumbline demo"'})
    return await call_next(request)


@app.get("/healthz")
def healthz():
    return {"ok": True}
PLANS = {"sunvale": "Sunvale Health Plan", "bayline": "Bayline Community Health"}


def _bg(fn, *args):
    def go():
        try:
            fn(*args)
        except Exception:
            traceback.print_exc()
    threading.Thread(target=go, daemon=True).start()


def _jsonable(rows):
    return json.loads(json.dumps(rows, default=str))


# ─── overview ─────────────────────────────────────────────────────────────────
@app.get("/api/overview")
def overview():
    latest = db.q("""select distinct on (workflow, plan) id, workflow, plan, status, summary, started_at, finished_at
                     from runs order by workflow, plan, started_at desc""")
    spend = db.one("""select coalesce(sum(cost_usd) filter (where not cached),0) cost, count(*) calls,
                      count(*) filter (where cached) cached from model_calls""")
    return _jsonable({"plans": PLANS, "latest_runs": latest, "spend": spend,
                      "regulations": [{"id": "APL26-001", "title": "Initial Health Appointment", "issued": "2026-01-07",
                                       "agency": "DHCS", "supersedes": "APL 22-030", "due": "2026-04-07",
                                       "affects": list(PLANS), "requirements": len(tasks.load_requirements())}]})


# ─── regulation + requirements ────────────────────────────────────────────────
@app.get("/api/regulations/{reg_id}")
def regulation(reg_id: str):
    doc = load(config.DATA / f"regulations/{reg_id}.md")
    draft_p = config.DATA / f"requirements/{reg_id}.draft.json"
    return {"id": doc.id, "title": doc.title,
            "paragraphs": [{"id": p.id, "section": p.section, "text": p.text} for p in doc.paragraphs],
            "requirements": tasks.load_requirements(reg_id),
            "draft": json.loads(draft_p.read_text(encoding="utf-8")) if draft_p.exists() else None}


@app.get("/api/paragraphs")
def paragraphs(ids: str):
    rows = db.q("""select p.id, p.doc_id, p.section, p.text, d.title from paragraphs p join documents d on d.id=p.doc_id
                   where p.id = any(%s)""", ids.split(","))
    return {r["id"]: r for r in rows}


@app.get("/api/documents/{doc_id}")
def document(doc_id: str):
    d = db.one("select * from documents where id=%s", doc_id)
    if not d:
        raise HTTPException(404)
    ps = db.q("select id, idx, section, text from paragraphs where doc_id=%s order by idx", doc_id)
    return {**d, "paragraphs": ps}


@app.get("/api/plans/{plan}/documents")
def plan_documents(plan: str):
    return db.q("""select d.id, d.kind, d.title, count(p.id) paragraphs from documents d left join paragraphs p on p.doc_id=d.id
                   where d.plan=%s group by d.id order by d.kind, d.id""", plan)


# ─── runs ─────────────────────────────────────────────────────────────────────
class RunIn(BaseModel):
    workflow: str
    plan: str


@app.post("/api/runs")
def start_run(body: RunIn):
    if body.workflow not in workflows.WORKFLOWS or body.plan not in PLANS:
        raise HTTPException(400, "unknown workflow or plan")
    if body.workflow == "audit_review" and not tasks.load_audit_items(body.plan):
        raise HTTPException(400, f"{body.plan} has no audit items")
    rid = runs.create(body.workflow, body.plan, {"regulation": "APL26-001"})
    _bg(workflows.WORKFLOWS[body.workflow], body.plan, "APL26-001", rid)
    return {"id": rid}


@app.get("/api/runs")
def list_runs():
    return _jsonable(db.q("""select id, workflow, plan, status, summary, error, started_at, finished_at
                             from runs order by started_at desc limit 100"""))


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    r = db.one("select * from runs where id=%s", run_id)
    if not r:
        raise HTTPException(404)
    vs = db.q("select * from verdicts where run_id=%s order by item_id", run_id)
    calls = db.q("""select id, task, kind, provider, model, setup, input_tokens, output_tokens, cost_usd, latency_ms, cached,
                    fallback_from, attempts, error, created_at from model_calls where run_id=%s order by id""", run_id)
    live = runs.summary(run_id) if r["status"] == "running" else r["summary"]
    return _jsonable({**r, "summary": live, "verdicts": vs, "calls": calls})


class ReviewIn(BaseModel):
    decision: str           # accept | reject
    label: str | None = None
    note: str | None = None


@app.post("/api/verdicts/{verdict_id}/review")
def review(verdict_id: int, body: ReviewIn):
    v = db.one("select v.*, r.plan from verdicts v join runs r on r.id=v.run_id where v.id=%s", verdict_id)
    if not v:
        raise HTTPException(404)
    label = v["label"] if body.decision == "accept" else (body.label or None)
    db.q("""update verdicts set review_status=%s, review_label=%s, review_note=%s, reviewed_at=now() where id=%s""",
         "accepted" if body.decision == "accept" else "rejected", label, body.note, verdict_id)
    if label:  # a reviewer decision becomes a label the benchmark can grow from
        db.q("insert into review_labels(task, plan, item_id, label, verdict_id) values (%s,%s,%s,%s,%s)",
             v["task"], v["plan"], v["item_id"], label, verdict_id)
    return {"ok": True}


# ─── routing ──────────────────────────────────────────────────────────────────
@app.get("/api/routes")
def routes():
    rows = db.q("select task, route, note, updated_at from routes order by task")
    hist = db.q("select task, route, changed_at from route_history order by changed_at desc limit 30")
    return _jsonable({"routes": rows, "history": hist, "setups": benchmark.SETUPS,
                      "models": {"strong": config.STRONG_MODEL, "cheap": config.CHEAP_MODEL,
                                 "fallback": config.FALLBACK_MODEL, "snap": config.SNAP_MODEL,
                                 "savant": config.SAVANT_MODEL, "embedding": config.EMBEDDING_MODEL}})


class RouteIn(BaseModel):
    route: dict


@app.put("/api/routes/{task}")
def put_route(task: str, body: RouteIn):
    gateway.set_route(task, body.route)
    return {"ok": True}


# ─── benchmarks ───────────────────────────────────────────────────────────────
class BenchIn(BaseModel):
    task: str
    kind: str = "setups"


@app.post("/api/benchmarks")
def start_benchmark(body: BenchIn):
    if body.task not in tasks.SPECS:
        raise HTTPException(400)
    bid = str(db.one("insert into benchmarks(task, kind) values (%s,%s) returning id", body.task, body.kind)["id"])
    _bg(benchmark.stress if body.kind == "snap_stress" else benchmark.run, body.task, *([bid] if body.kind == "snap_stress" else [None, bid]))
    return {"id": bid}


@app.get("/api/benchmarks")
def list_benchmarks():
    return _jsonable(db.q("""select distinct on (task, kind) id, task, kind, status, results, error, started_at, finished_at
                             from benchmarks order by task, kind, (status='done') desc, started_at desc"""))


@app.get("/api/benchmarks/{bid}")
def get_benchmark(bid: str):
    return _jsonable(db.one("select * from benchmarks where id=%s", bid))


# ─── datasets ─────────────────────────────────────────────────────────────────
@app.get("/api/datasets")
def datasets():
    out = {}
    for t in tasks.SPECS:
        rows = benchmark.dataset(t)
        out[t] = [{"plan": r["plan"], "item_id": r["item"].id, "question": r["item"].question, "truth": r["truth"],
                   "tricky": r["tricky"], "why_tricky": r["why_tricky"], "paragraph_ids": r["paragraph_ids"],
                   "planted": r.get("planted", ""), "severity": r.get("severity")}
                  for r in rows]
    out["review_labels"] = _jsonable(db.q("select * from review_labels order by created_at desc limit 200"))
    return out


# ─── platform overview (what was built) ───────────────────────────────────────
REPO = "https://github.com/sudhersankv/plumbline/blob/main"
PIECES = [
    {"id": "documents", "layer": "pieces", "file": "plumbline/documents.py", "kind": "Code",
     "does": "Splits regulations, policies and evidence into paragraphs with stable IDs like SUNVALE-POL-02:P12.",
     "why": "A reviewer must find cited text in seconds, and code can only verify a citation if paragraphs have fixed IDs."},
    {"id": "requirements", "layer": "pieces", "file": "plumbline/requirements.py", "kind": "LLM, once",
     "does": "Turns a regulation into atomic obligations, each with an exact quote. Run once with Opus, checked, reviewed by a person, saved, shared by every plan.",
     "why": "One state letter reaches every health plan. Doing the regulation side once cuts cost, and every plan cites the same requirement IDs."},
    {"id": "retrieve", "layer": "pieces", "file": "plumbline/retrieve.py", "kind": "Embeddings + pgvector",
     "does": "Embeds every paragraph (qwen3-embedding-0-6b via Neon AI Gateway) and finds the closest ones for a question. Also assembles a whole document set for long-context models.",
     "why": "Per-item retrieval is the usual RAG baseline; whole-corpus assembly makes long-context routes possible with the same data."},
    {"id": "cite", "layer": "pieces", "file": "plumbline/cite.py", "kind": "Code",
     "does": "Checks every citation: the paragraph exists, belongs to this plan, was actually shown to the model, and the quote appears in it word for word. Failures become needs_review.",
     "why": "A person signs every output, so a citation must be guaranteed, not likely. Unverified findings are flagged, never dropped."},
    {"id": "judge", "layer": "pieces", "file": "plumbline/judge.py", "kind": "Calls the gateway",
     "does": "Runs a labelling task over many items in whatever shape the route asks for: per item with retrieval, batched typed questions (Snap), whole corpus in one call (long context), or a cascade. Every shape returns the same verdict records.",
     "why": "This is the seam that makes routing a config change: workflows and the benchmark call the same function; only the route differs."},
    {"id": "runs", "layer": "pieces", "file": "plumbline/runs.py", "kind": "Code",
     "does": "Records every workflow run: inputs, verdicts, review decisions, and every model call it made.",
     "why": "Audits need a trail: which model said what, from which text, at what cost."},
    {"id": "gateway", "layer": "gateway", "file": "plumbline/gateway.py", "kind": "The only door to models",
     "does": "complete() for LLMs, decide() for the decision model, embed() for vectors. Routes each task from the routing table, retries, falls back to a backup model, caches, and logs tokens, cost and latency per call.",
     "why": "Logging, cost, caching, fallback and future data controls (PHI scrubbing, BAA-covered providers) apply everywhere at once."},
    {"id": "benchmark", "layer": "workflows", "file": "plumbline/benchmark.py", "kind": "Eval harness",
     "does": "Runs each task's labelled dataset through several model setups via the same judge piece, scores them, replays a cascade, and stress-tests the decision model.",
     "why": "Routing decisions come from metrics, not demos."},
]


def _source(fn) -> str:
    import inspect
    return inspect.getsource(fn)


def _tests() -> list[dict]:
    import ast
    p = Path(__file__).resolve().parents[1] / "tests" / "test_platform.py"
    if not p.exists():
        return []
    tree = ast.parse(p.read_text(encoding="utf-8"))
    out = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
            out.append({"name": node.name, "doc": ast.get_docstring(node) or "",
                        "readable": node.name[5:].replace("_", " ").capitalize()})
    return out


@app.get("/api/source")
def source(file: str):
    root = Path(__file__).resolve().parents[1]
    p = (root / file).resolve()
    allowed = [root / "plumbline", root / "tests", root / "scripts"]
    if p.suffix != ".py" or not any(str(p).startswith(str(a)) for a in allowed) or not p.is_file():
        raise HTTPException(404)
    return {"file": file, "url": f"{REPO}/{file}", "code": p.read_text(encoding="utf-8")}


@app.get("/api/platform")
def platform():
    stats = db.one("""select count(*) calls, count(*) filter (where cached) cached,
                      count(*) filter (where fallback_from is not null) fallbacks,
                      coalesce(sum(cost_usd) filter (where not cached),0) spend,
                      count(*) filter (where error is not null) errors from model_calls""")
    by_model = db.q("""select provider, model, kind, count(*) calls, count(*) filter (where cached) cached,
                       coalesce(sum(cost_usd) filter (where not cached),0) spend, coalesce(sum(input_tokens),0) tin,
                       coalesce(sum(output_tokens),0) tout,
                       percentile_cont(0.5) within group (order by latency_ms) filter (where not cached) p50
                       from model_calls group by 1,2,3 order by spend desc""")
    corpus = db.q("select coalesce(plan,'shared') plan, kind, count(distinct doc_id) docs, count(*) paragraphs from paragraphs group by 1,2 order by 1,2")
    latest = {}
    for wf in workflows.WORKFLOWS:
        r = db.one("select id, plan, summary, started_at, finished_at from runs where workflow=%s and status='done' order by started_at desc limit 1", wf)
        if r:
            calls = db.q("""select task, kind, model, count(*) n, count(*) filter (where cached) cached,
                            coalesce(sum(cost_usd) filter (where not cached),0) cost, max(latency_ms) latency
                            from model_calls where run_id=%s group by 1,2,3 order by min(id)""", r["id"])
            latest[wf] = {**r, "calls": calls}
    return _jsonable({
        "repo": REPO.replace("/blob/main", ""), "repo_blob": REPO, "pieces": PIECES,
        "sources": {"regulatory_change": _source(workflows.regulatory_change), "audit_review": _source(workflows.audit_review)},
        "tests": _tests(), "stats": stats, "by_model": by_model, "corpus": corpus, "latest": latest,
        "routes": db.q("select task, route from routes order by task"),
        "prices": {m: {"input": p[0], "output": p[1]} for m, p in config.PRICES.items()},
        "models": {"strong": config.STRONG_MODEL, "cheap": config.CHEAP_MODEL, "fallback": config.FALLBACK_MODEL,
                   "embedding": config.EMBEDDING_MODEL, "snap": config.SNAP_MODEL, "savant": config.SAVANT_MODEL},
        "counts": {"requirements": len(tasks.load_requirements()), "audit_items": len(tasks.load_audit_items("sunvale")),
                   "gap_labels": len(benchmark.dataset("judge_gap")), "evidence_labels": len(benchmark.dataset("judge_evidence")),
                   "runs": db.one("select count(*) n from runs")["n"], "benchmarks": db.one("select count(*) n from benchmarks where status='done'")["n"]},
    })


# ─── static console ───────────────────────────────────────────────────────────
DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
