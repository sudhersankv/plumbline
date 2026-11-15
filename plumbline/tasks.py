"""Task definitions shared by workflows and the benchmark: labels, instructions, and how items are built."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import config


@dataclass(frozen=True)
class TaskSpec:
    name: str
    kind: str                    # which corpus: policy | evidence
    labels: dict[str, str]       # label -> what it means
    positive: str                # the "all good" label; a wrong positive is the dangerous error
    no_citation: frozenset[str]  # labels that claim absence and need no citation
    instructions: str


@dataclass
class Item:
    id: str
    question: str                # what is judged, as shown to models
    query: str                   # retrieval query
    regulation_quote: str | None = None
    meta: dict = field(default_factory=dict)


GAP = TaskSpec(
    name="judge_gap",
    kind="policy",
    labels={
        "met": "The plan's policies fully meet the requirement as written.",
        "gap": "The requirement is missing, or the policy language falls short of it (weaker, narrower, wrong number or timeline, optional where it must be mandatory).",
        "conflict": "One policy meets the requirement but another policy paragraph contradicts or undercuts it.",
    },
    positive="met",
    no_citation=frozenset({"gap"}),
    instructions=(
        "Decide whether the health plan's policies meet one requirement from a state regulatory letter. "
        "Read exactly: numbers, timelines, who performs an action, mandatory vs optional, and exceptions in appendices or "
        "definitions all matter. A requirement is only 'met' if nothing elsewhere contradicts it."
    ),
)

EVIDENCE = TaskSpec(
    name="judge_evidence",
    kind="evidence",
    labels={
        "satisfied": "The evidence fully demonstrates what the auditor asked for: right period, population, scope and sample.",
        "partial": "Some relevant evidence exists but it falls short: wrong period, incomplete sample, planned but not done, or missing a required element.",
        "missing": "No evidence addresses the request.",
    },
    positive="satisfied",
    no_citation=frozenset({"missing"}),
    instructions=(
        "Decide whether the plan's evidence satisfies one audit item. Auditors are strict: check the period, population, "
        "sample size, and whether something was actually done rather than planned. Superseded or draft documents do not count."
    ),
)

SPECS = {s.name: s for s in (GAP, EVIDENCE)}


def load_requirements(regulation_id: str = "APL26-001") -> list[dict]:
    return json.loads((config.DATA / f"requirements/{regulation_id}.json").read_text(encoding="utf-8"))["requirements"]


def load_audit_items(plan: str) -> list[dict]:
    p = config.DATA / f"plans/{plan}/audit_items.json"
    return json.loads(p.read_text(encoding="utf-8"))["items"] if p.exists() else []


def gap_items(reqs: list[dict]) -> list[Item]:
    return [Item(id=r["id"], question=f"Requirement {r['id']} ({r['topic']}): {r['obligation']}\nRegulation text: \"{r['quote']}\"",
                 query=f"{r['topic']}: {r['obligation']}", regulation_quote=r["quote"],
                 meta={"paragraph_id": r["paragraph_id"], "topic": r["topic"]}) for r in reqs]


def evidence_items(audit_items: list[dict], reqs: list[dict]) -> list[Item]:
    by_id = {r["id"]: r for r in reqs}
    out = []
    for a in audit_items:
        r = by_id[a["requirement_id"]]
        out.append(Item(id=a["id"], question=f"Audit item {a['id']}: {a['text']}\n(Tests requirement {r['id']}: {r['obligation']})",
                        query=a["text"], regulation_quote=r["quote"], meta={"requirement_id": r["id"]}))
    return out
