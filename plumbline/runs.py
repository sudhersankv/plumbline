"""runs: record every workflow run, its verdicts, and the model calls behind it."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from . import db, gateway
from .judge import Verdict


@contextmanager
def run(workflow: str, plan: str | None, params: dict | None = None, run_id: str | None = None) -> Iterator[str]:
    if run_id is None:
        run_id = str(db.one("insert into runs(workflow, plan, params) values (%s,%s,%s) returning id",
                            workflow, plan, db.J(params or {}))["id"])
    token = gateway.current_run.set(run_id)
    try:
        yield run_id
        db.q("update runs set status='done', finished_at=now(), summary=%s where id=%s", db.J(summary(run_id)), run_id)
    except Exception as e:
        db.q("update runs set status='failed', finished_at=now(), error=%s, summary=%s where id=%s",
             repr(e)[:2000], db.J(summary(run_id)), run_id)
        raise
    finally:
        gateway.current_run.reset(token)


def create(workflow: str, plan: str | None, params: dict | None = None) -> str:
    return str(db.one("insert into runs(workflow, plan, params) values (%s,%s,%s) returning id",
                      workflow, plan, db.J(params or {}))["id"])


def save(run_id: str, task: str, verdicts: list[Verdict]) -> None:
    for v in verdicts:
        db.q("""insert into verdicts(run_id, task, item_id, label, confidence, probabilities, severity, paragraph_ids,
                quote, regulation_quote, reason, explanation, citation_status, citation_notes, setup)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             run_id, task, v.item_id, v.label, v.confidence, db.J(v.probabilities) if v.probabilities else None,
             v.severity, db.J(v.paragraph_ids), v.quote, v.regulation_quote, v.reason, v.explanation,
             v.citation_status, db.J(v.citation_notes), v.setup)


def summary(run_id: str) -> dict:
    v = db.q("select label, citation_status, count(*) n from verdicts where run_id=%s group by 1,2", run_id)
    c = db.one("""select count(*) calls, coalesce(sum(cost_usd) filter (where not cached),0) cost, coalesce(sum(input_tokens),0) tin,
                  coalesce(sum(output_tokens),0) tout, count(*) filter (where cached) cached,
                  count(*) filter (where fallback_from is not null) fallbacks
                  from model_calls where run_id=%s""", run_id)
    labels: dict[str, int] = {}
    review = 0
    for r in v:
        labels[r["label"]] = labels.get(r["label"], 0) + r["n"]
        if r["citation_status"] == "needs_review":
            review += r["n"]
    return {"labels": labels, "needs_review": review, "items": sum(labels.values()), "calls": c["calls"],
            "cost_usd": round(float(c["cost"]), 5), "input_tokens": c["tin"], "output_tokens": c["tout"],
            "cached_calls": c["cached"], "fallbacks": c["fallbacks"]}
