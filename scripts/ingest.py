"""Create tables, seed routes, and index every document. Run: uv run python scripts/ingest.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from plumbline import config, db, gateway, retrieve  # noqa: E402
from plumbline.documents import load_dir  # noqa: E402

db.migrate()
gateway.seed_routes(reset="--reset-routes" in sys.argv)
n = retrieve.index(load_dir(config.DATA / "regulations"), None, "regulation")
print(f"regulations: embedded {n}")
for plan_dir in sorted((config.DATA / "plans").iterdir()):
    for kind, sub in (("policy", "policies"), ("evidence", "evidence")):
        if (plan_dir / sub).exists():
            n = retrieve.index(load_dir(plan_dir / sub), plan_dir.name, kind)
            print(f"{plan_dir.name} {kind}: embedded {n}")
print(db.q("select plan, kind, count(*) n from paragraphs group by 1,2 order by 1,2"))
