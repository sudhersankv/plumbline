"""Run the benchmark for both tasks and the Snap stress tests, and print a summary.
Run: uv run python scripts/run_benchmarks.py [judge_evidence] [judge_gap] [stress]"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.stdout.reconfigure(encoding="utf-8")

from plumbline import benchmark, db  # noqa: E402

what = sys.argv[1:] or ["judge_evidence", "judge_gap", "stress"]
for t in [w for w in what if w != "stress"]:
    bid = benchmark.run(t)
    r = db.one("select results from benchmarks where id=%s", bid)["results"]
    print(f"\n== {t} ({r['n']} items) {bid}")
    for k, s in r["setups"].items():
        print(f"{s['name']:26} acc={s['accuracy']:.2f} [{s['accuracy_ci'][0]:.2f}-{s['accuracy_ci'][1]:.2f}] "
              f"binary={s['binary_accuracy']:.2f} tricky={s['tricky_accuracy'] or 0:.2f} "
              f"falsepos={s['false_positive']}/{s['false_positive_of']} cost=${s['cost_usd']:.4f} "
              f"p50={s['p50_ms']} review={s['needs_review']} cite_hit={s['citation_hit_rate']} "
              f"esc={s.get('escalation_rate')} thr={s.get('threshold')}")
        print("   false positives:", s["false_positive_items"])
if "stress" in what:
    bid = benchmark.stress("judge_evidence")
    r = db.one("select results from benchmarks where id=%s", bid)["results"]
    print("\n== snap stress", bid)
    print(json.dumps({k: v for k, v in r.items() if k != "calibration"}, indent=1, default=str)[:4000])
    print("ECE", r["calibration"]["ece"], json.dumps(r["calibration"]["bins"]))
