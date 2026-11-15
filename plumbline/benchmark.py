"""benchmark: run one task's labelled dataset through several model setups and compare them.

Every model call goes through the gateway, tagged with the benchmark id and setup, so cost and latency
are read from the gateway log rather than estimated.
"""

from __future__ import annotations

import json
import math
import random
import time
from collections import Counter

import numpy as np

from . import config, db, gateway, judge, retrieve, tasks
from .tasks import TaskSpec

SETUPS: dict[str, dict] = {
    "opus_retrieve": {"name": "Opus 5.5 · retrieve", "shape": "per_item", "provider": "anthropic",
                      "model": config.STRONG_MODEL, "fallback": config.FALLBACK_MODEL},
    "haiku_retrieve": {"name": "Haiku 5.5 · retrieve", "shape": "per_item", "provider": "anthropic",
                       "model": config.CHEAP_MODEL, "fallback": config.FALLBACK_MODEL},
    "snap_per_item": {"name": "Snap · per item", "shape": "per_item", "provider": "subq-snap", "model": config.SNAP_MODEL},
    "snap_batched": {"name": "Snap · batched", "shape": "batched", "provider": "subq-snap", "model": config.SNAP_MODEL},
    "savant_long": {"name": "Savant · long context", "shape": "long_context", "provider": "subq-chat",
                    "model": config.SAVANT_MODEL, "reasoning_effort": "low"},
    "opus_long": {"name": "Opus 5.5 · long context", "shape": "long_context", "provider": "anthropic",
                  "model": config.STRONG_MODEL, "fallback": config.FALLBACK_MODEL},
}
DEFAULT_K = {"judge_gap": 5, "judge_evidence": 3}


# ─── dataset ──────────────────────────────────────────────────────────────────
def dataset(task: str) -> list[dict]:
    """[{plan, item, truth, tricky, why_tricky, paragraph_ids}] for the task."""
    reqs = tasks.load_requirements()
    if task == "judge_gap":
        labels = json.loads((config.DATA / "labels/gap_labels.json").read_text(encoding="utf-8"))["labels"]
        items = {it.id: it for it in tasks.gap_items(reqs)}
        return [{"plan": l["plan"], "item": items[l["requirement_id"]], "truth": l["label"], "tricky": l["tricky"],
                 "why_tricky": l.get("why_tricky", ""), "paragraph_ids": l["paragraph_ids"],
                 "severity": l.get("severity"), "planted": l.get("planted", "")} for l in labels]
    labels = {l["audit_item_id"]: l for l in
              json.loads((config.DATA / "labels/evidence_labels.json").read_text(encoding="utf-8"))["labels"]}
    out = []
    for it in tasks.evidence_items(tasks.load_audit_items("sunvale"), reqs):
        l = labels[it.id]
        out.append({"plan": "sunvale", "item": it, "truth": l["label"], "tricky": l["tricky"],
                    "why_tricky": l.get("why_tricky", ""), "paragraph_ids": l["evidence_paragraph_ids"]})
    return out


def split(rows: list[dict]) -> tuple[set[str], set[str]]:
    """Deterministic half split by key: threshold is chosen on `tune`, reported on `test`."""
    keys = sorted(f"{r['plan']}|{r['item'].id}" for r in rows)
    rnd = random.Random(7)
    rnd.shuffle(keys)
    h = len(keys) // 2
    return set(keys[:h]), set(keys[h:])


# ─── metrics ──────────────────────────────────────────────────────────────────
def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def score(spec: TaskSpec, rows: list[dict], preds: dict[str, judge.Verdict]) -> dict:
    n = len(rows)
    right = [r for r in rows if preds[_key(r)].label == r["truth"]]
    binary = [r for r in rows if (preds[_key(r)].label == spec.positive) == (r["truth"] == spec.positive)]
    tricky = [r for r in rows if r["tricky"]]
    bad_truth = [r for r in rows if r["truth"] != spec.positive]
    false_pos = [r for r in bad_truth if preds[_key(r)].label == spec.positive]
    cited = [r for r in rows if preds[_key(r)].paragraph_ids and r["paragraph_ids"]]
    hit = [r for r in cited if set(preds[_key(r)].paragraph_ids) & set(r["paragraph_ids"])]
    lo, hi = wilson(len(right), n)
    confusion = Counter(f"{r['truth']}→{preds[_key(r)].label}" for r in rows)
    return {
        "n": n,
        "accuracy": len(right) / n if n else 0,
        "accuracy_ci": [lo, hi],
        "binary_accuracy": len(binary) / n if n else 0,
        "tricky_n": len(tricky),
        "tricky_accuracy": sum(preds[_key(r)].label == r["truth"] for r in tricky) / len(tricky) if tricky else None,
        "false_positive": len(false_pos),
        "false_positive_of": len(bad_truth),
        "false_positive_items": [r["item"].id + (f" ({r['plan']})" if spec.name == "judge_gap" else "") for r in false_pos],
        "needs_review": sum(preds[_key(r)].citation_status == "needs_review" for r in rows),
        "citation_hit_rate": len(hit) / len(cited) if cited else None,
        "confusion": dict(confusion),
    }


def _key(r: dict) -> str:
    return f"{r['plan']}|{r['item'].id}"


def _cost_latency(bench_id: str, setup: str, n_items: int) -> dict:
    c = db.one("""select coalesce(sum(cost_usd),0) cost, count(*) calls, coalesce(sum(input_tokens),0) tin,
                  coalesce(sum(output_tokens),0) tout from model_calls
                  where benchmark_id=%s and setup=%s and kind<>'embed'""", bench_id, setup)
    return {"cost_usd": float(c["cost"]), "cost_per_item": float(c["cost"]) / n_items if n_items else 0,
            "calls": c["calls"], "input_tokens": c["tin"], "output_tokens": c["tout"]}


def _lat(preds: list[judge.Verdict]) -> dict:
    ls = [v.latency_ms for v in preds if v.latency_ms]
    return {"p50_ms": float(np.percentile(ls, 50)) if ls else None, "p95_ms": float(np.percentile(ls, 95)) if ls else None}


# ─── run ──────────────────────────────────────────────────────────────────────
def _run_setup(spec: TaskSpec, rows: list[dict], key: str, route: dict) -> dict[str, judge.Verdict]:
    route = {**route, "k": DEFAULT_K[spec.name]}
    gateway.current_setup.set(key)
    preds: dict[str, judge.Verdict] = {}
    for plan in sorted({r["plan"] for r in rows}):
        prow = [r for r in rows if r["plan"] == plan]
        for r, v in zip(prow, judge.judge(spec, [r["item"] for r in prow], plan, route)):
            preds[_key(r)] = v
    return preds


def _cascade(spec: TaskSpec, rows: list[dict], first: dict[str, judge.Verdict], then: dict[str, judge.Verdict],
             tune: set[str], test: set[str], first_cost: dict, then_cost: dict) -> dict:
    """Replay the cascade from the two setups' answers: Snap first, escalate to Opus when Snap is unsure or the
    label is not the positive one. The threshold is chosen on `tune` and reported on `test`."""
    def preds_at(t: float) -> tuple[dict, set]:
        esc = {k for k, v in first.items() if v.label != spec.positive or (v.confidence or 0) < t}
        return {k: (then[k] if k in esc else first[k]) for k in first}, esc

    tune_rows = [r for r in rows if _key(r) in tune]
    best = None
    for t in [0.0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99, 1.01]:
        p, esc = preds_at(t)
        s = score(spec, tune_rows, p)
        # never trade away safety: fewest false positives first, then accuracy, then fewest escalations
        obj = (-s["false_positive"], s["accuracy"], -len(esc & tune))
        if best is None or obj > best[0]:
            best = (obj, t)
    t = best[1]
    p, esc = preds_at(t)
    test_rows = [r for r in rows if _key(r) in test]
    per_item_then = then_cost["cost_usd"] / max(len(then), 1)
    cost = first_cost["cost_usd"] + per_item_then * len(esc)
    out = score(spec, test_rows, p)
    out.update({"threshold": t, "escalated": len(esc), "escalation_rate": len(esc) / len(rows),
                "cost_usd": cost, "cost_per_item": cost / len(rows), "calls": first_cost["calls"] + len(esc),
                "evaluated_on": "test half", "cost_note": "Snap cost plus Opus per-item average for escalated items",
                "all_items": score(spec, rows, p)})
    out.update(_lat([p[k] for k in p]))
    return out


def run(task: str, setups: list[str] | None = None, bench_id: str | None = None) -> str:
    spec = tasks.SPECS[task]
    rows = dataset(task)
    setups = setups or list(SETUPS)
    if bench_id is None:
        bench_id = str(db.one("insert into benchmarks(task, kind) values (%s,'setups') returning id", task)["id"])
    tok = gateway.current_benchmark.set(bench_id)
    results: dict = {"task": task, "n": len(rows), "setups": {}, "items": {}}
    try:
        all_preds: dict[str, dict] = {}
        for key in setups:
            route = SETUPS[key]
            t0 = time.perf_counter()
            preds = _run_setup(spec, rows, key, route)
            wall = time.perf_counter() - t0
            all_preds[key] = preds
            m = score(spec, rows, preds)
            m.update(_cost_latency(bench_id, key, len(rows)))
            m.update(_lat(list(preds.values())))
            m.update({"name": route["name"], "shape": route["shape"], "model": route["model"], "wall_s": wall})
            results["setups"][key] = m
            db.q("update benchmarks set results=%s where id=%s", db.J(results), bench_id)
        tune, test = split(rows)
        for name, then in (("cascade", "opus_retrieve"), ("cascade_long", "opus_long")):
            if "snap_batched" in all_preds and then in all_preds:
                c = _cascade(spec, rows, all_preds["snap_batched"], all_preds[then], tune, test,
                             results["setups"]["snap_batched"], results["setups"][then])
                c.update({"name": f"Cascade · Snap → {SETUPS[then]['name']}", "shape": "cascade",
                          "model": f"{config.SNAP_MODEL} → {config.STRONG_MODEL}"})
                results["setups"][name] = c
        results["items"] = {
            _key(r): {"plan": r["plan"], "item_id": r["item"].id, "truth": r["truth"], "tricky": r["tricky"],
                      "why_tricky": r["why_tricky"], "label_paragraphs": r["paragraph_ids"],
                      "preds": {k: {"label": p[_key(r)].label, "confidence": p[_key(r)].confidence,
                                    "paragraph_ids": p[_key(r)].paragraph_ids, "citation": p[_key(r)].citation_status}
                                for k, p in all_preds.items()}}
            for r in rows}
        db.q("update benchmarks set status='done', finished_at=now(), results=%s where id=%s", db.J(results), bench_id)
    except Exception as e:
        db.q("update benchmarks set status='failed', finished_at=now(), error=%s, results=%s where id=%s",
             repr(e)[:2000], db.J(results), bench_id)
        raise
    finally:
        gateway.current_benchmark.reset(tok)
    return bench_id


# ─── Snap stress tests ────────────────────────────────────────────────────────
def _snap_route(**kw) -> dict:
    return {"provider": "subq-snap", "model": config.SNAP_MODEL, **kw}


def _verdict_questions(spec: TaskSpec, rows: list[dict], reverse: bool = False) -> dict:
    crit = dict(reversed(list(spec.labels.items()))) if reverse else dict(spec.labels)
    return {f"v{i}": {"type": "choice", "instructions": f"{spec.instructions}\n\n{r['item'].question}", "criteria": crit}
            for i, r in enumerate(rows)}


def _acc(rows: list[dict], answers: dict) -> dict:
    labels = [answers.get(f"v{i}", {}).get("choice") for i in range(len(rows))]
    right = sum(l == r["truth"] for l, r in zip(labels, rows))
    return {"accuracy": right / len(rows), "accuracy_ci": list(wilson(right, len(rows))), "labels": labels}


def stress(task: str = "judge_evidence", bench_id: str | None = None) -> str:
    """Questions per call, context depth, calibration and option order for SubQ Snap."""
    spec = tasks.SPECS[task]
    rows = [r for r in dataset(task) if r["plan"] == "sunvale"]
    plan = "sunvale"
    if bench_id is None:
        bench_id = str(db.one("insert into benchmarks(task, kind) values (%s,'snap_stress') returning id", task)["id"])
    tok = gateway.current_benchmark.set(bench_id)
    res: dict = {"task": task, "n": len(rows)}
    try:
        corpus_text, lookup = retrieve.corpus(plan, spec.kind)
        qs = _verdict_questions(spec, rows)

        # 1. Questions per call: same items, same state, asked 1, 10 or all at a time.
        res["questions_per_call"] = []
        for size in [1, 10, len(rows)]:
            gateway.current_setup.set(f"qpc_{size}")
            r = gateway.decide(task, corpus_text, qs, route=_snap_route(max_questions=size))
            a = _acc(rows, r.data)
            a.pop("labels")
            res["questions_per_call"].append({"questions_per_call": size, "calls": r.calls, "cost_usd": r.cost_usd,
                                              "input_tokens": r.input_tokens, **a})
            db.q("update benchmarks set results=%s where id=%s", db.J(res), bench_id)

        # 2. Context depth: the deciding evidence placed at the start, middle or end of a long state,
        #    padded with distractor documents (both plans' policies).
        docs: dict[str, list[str]] = {}
        for pid, text in lookup.items():
            docs.setdefault(pid.split(":")[0], []).append(f"[{pid}] {text}")
        pad = "\n\n".join(f"=== DISTRACTOR DOCUMENT ===\n{retrieve.corpus(p, 'policy')[0]}" for p in ("bayline", "sunvale"))
        depth_rows = [r for r in rows if any(p.split(":")[0] in docs for p in r["paragraph_ids"])]
        res["context_depth"] = []
        for pos in ("start", "middle", "end"):
            gateway.current_setup.set(f"depth_{pos}")

            def one(r: dict) -> str | None:
                key_docs = {p.split(":")[0] for p in r["paragraph_ids"]} & set(docs)
                key = "\n\n".join(f"=== DOCUMENT {d} ===\n" + "\n\n".join(docs[d]) for d in sorted(key_docs))
                other = "\n\n".join(f"=== DOCUMENT {d} ===\n" + "\n\n".join(v) for d, v in sorted(docs.items())
                                    if d not in key_docs)
                filler = other + "\n\n" + pad
                h = len(filler) // 2
                state = {"start": key + "\n\n" + filler, "middle": filler[:h] + "\n\n" + key + "\n\n" + filler[h:],
                         "end": filler + "\n\n" + key}[pos]
                q = {"v0": {"type": "choice", "instructions": f"{spec.instructions}\n\n{r['item'].question}",
                            "criteria": dict(spec.labels)}}
                return gateway.decide(task, state, q, route=_snap_route()).data.get("v0", {}).get("choice")

            labels = gateway.pmap(one, depth_rows, workers=4)
            right = sum(l == r["truth"] for l, r in zip(labels, depth_rows))
            c = _cost_latency(bench_id, f"depth_{pos}", len(depth_rows))
            res["context_depth"].append({"position": pos, "n": len(depth_rows), "accuracy": right / len(depth_rows),
                                         "accuracy_ci": list(wilson(right, len(depth_rows))),
                                         "avg_input_tokens": c["input_tokens"] / max(c["calls"], 1),
                                         "cost_usd": c["cost_usd"]})
            db.q("update benchmarks set results=%s where id=%s", db.J(res), bench_id)

        # 3. Calibration: does confidence c mean right about c of the time? (batched, all items one call)
        gateway.current_setup.set("calibration")
        r = gateway.decide(task, corpus_text, qs, route=_snap_route())
        pts = [(r.data[f"v{i}"].get("confidence") or 0, r.data[f"v{i}"].get("choice") == row["truth"])
               for i, row in enumerate(rows)]
        bins = []
        for lo, hi in [(0, .6), (.6, .8), (.8, .9), (.9, .97), (.97, 1.01)]:
            b = [ok for c, ok in pts if lo <= c < hi]
            mean_c = [c for c, _ in pts if lo <= c < hi]
            if b:
                bins.append({"range": [lo, min(hi, 1)], "n": len(b), "accuracy": sum(b) / len(b),
                             "mean_confidence": sum(mean_c) / len(mean_c)})
        ece = sum(b["n"] * abs(b["accuracy"] - b["mean_confidence"]) for b in bins) / len(pts)
        res["calibration"] = {"bins": bins, "ece": ece, "points": [{"confidence": c, "correct": ok} for c, ok in pts]}

        # 4. Option order: reverse the order of the choice options; answers should not change.
        gateway.current_setup.set("option_order")
        base = [r.data[f"v{i}"].get("choice") for i in range(len(rows))]
        rr = gateway.decide(task, corpus_text, _verdict_questions(spec, rows, reverse=True), route=_snap_route())
        rev = [rr.data[f"v{i}"].get("choice") for i in range(len(rows))]
        res["option_order"] = {"agreement": sum(a == b for a, b in zip(base, rev)) / len(rows),
                               "changed_items": [rows[i]["item"].id for i in range(len(rows)) if base[i] != rev[i]]}
        res["total_cost_usd"] = float(db.one("select coalesce(sum(cost_usd),0) c from model_calls where benchmark_id=%s",
                                             bench_id)["c"])
        db.q("update benchmarks set status='done', finished_at=now(), results=%s where id=%s", db.J(res), bench_id)
    except Exception as e:
        db.q("update benchmarks set status='failed', finished_at=now(), error=%s, results=%s where id=%s",
             repr(e)[:2000], db.J(res), bench_id)
        raise
    finally:
        gateway.current_benchmark.reset(tok)
    return bench_id
