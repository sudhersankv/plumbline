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
                   "tricky": r["tricky"], "why_tricky": r["why_tricky"], "paragraph_ids": r["paragraph_ids"]}
                  for r in rows]
    out["review_labels"] = _jsonable(db.q("select * from review_labels order by created_at desc limit 200"))
    return out


# ─── static console ───────────────────────────────────────────────────────────
DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
