"""The two workflows. Each is a short function that only calls platform pieces."""

from __future__ import annotations

from . import judge, requirements, runs, tasks


def regulatory_change(plan: str, regulation: str = "APL26-001", run_id: str | None = None) -> str:
    """The state changed the rule. Which of our policies now fall short?"""
    reqs = requirements.load_reviewed(regulation)                       # extracted once, shared by every plan
    with runs.run("regulatory_change", plan, {"regulation": regulation}, run_id) as rid:
        items = tasks.gap_items(reqs)
        verdicts = judge.judge(tasks.GAP, items, plan)                 # route decides model and shape
        judge.rate_severity(tasks.GAP, verdicts, items, plan)          # Snap score question for each gap
        runs.save(rid, "judge_gap", verdicts)
    return rid


def audit_review(plan: str, regulation: str = "APL26-001", run_id: str | None = None,
                 explain_below: float = 0.8) -> str:
    """An auditor will check we follow the rule. Does our evidence satisfy each audit item?"""
    reqs = requirements.load_reviewed(regulation)
    with runs.run("audit_review", plan, {"regulation": regulation}, run_id) as rid:
        items = tasks.evidence_items(tasks.load_audit_items(plan), reqs)
        verdicts = judge.judge(tasks.EVIDENCE, items, plan)
        to_explain = [v for v in verdicts if v.label != "satisfied"
                      or (v.confidence is not None and v.confidence < explain_below)]
        judge.explain("explain_evidence", tasks.EVIDENCE, to_explain, items, plan)
        runs.save(rid, "judge_evidence", verdicts)
    return rid


WORKFLOWS = {"regulatory_change": regulatory_change, "audit_review": audit_review}
