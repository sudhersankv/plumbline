"""Head-to-head: same tasks through Opus, Sonnet, Haiku, Savant and Snap, fresh calls, compared with Opus.
Run: uv run python scripts/compare_models.py [judge_gap] [judge_evidence]"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.stdout.reconfigure(encoding="utf-8")

from plumbline import benchmark, db  # noqa: E402

for t in sys.argv[1:] or ["judge_gap", "judge_evidence"]:
    bid = benchmark.compare(t)
    r = db.one("select results from benchmarks where id=%s", bid)["results"]
    print(f"\n== {t} ({r['n']} items) {bid}")
    for cond, ms in r["conditions"].items():
        print(f"-- {cond}")
        for k, m in ms.items():
            v = m["vs_opus"]
            print(f"{m['setup']:28} acc={m['accuracy']:.2f} ({v['accuracy_delta']:+.2f}) danger={m['false_positive']} "
                  f"cost=${m['cost_usd']:.4f} (saved {v['cost_saved_pct'] or 0:.0%}) wall={m['wall_s']:.1f}s "
                  f"(saved {v['time_saved_pct'] or 0:.0%}, {v['speedup'] or 0:.1f}x) agree={v['agreement']:.0%} "
                  f"tokens={m['input_tokens']}/{m['output_tokens']} calls={m['calls']} fb={m['fallbacks']}")
