"""Check that the fictional data and labels are consistent. Run: uv run python scripts/validate_data.py"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from plumbline.documents import load_dir  # noqa: E402

ROOT = Path(__file__).resolve().parents[1] / "data"
errors: list[str] = []

reqs = json.loads((ROOT / "requirements/APL26-001.json").read_text(encoding="utf-8"))["requirements"]
req_ids = {r["id"] for r in reqs}

paragraphs: dict[str, dict[str, str]] = {}
for plan_dir in sorted((ROOT / "plans").iterdir()):
    plan = plan_dir.name
    ids = {}
    for sub in ("policies", "evidence"):
        if (plan_dir / sub).exists():
            for d in load_dir(plan_dir / sub):
                if not d.id.startswith(plan.upper() + "-"):
                    errors.append(f"{d.path}: doc id must start with {plan.upper()}-")
                if not d.paragraphs:
                    errors.append(f"{d.path}: no paragraphs")
                ids.update({p.id: p.text for p in d.paragraphs})
    paragraphs[plan] = ids
    print(f"{plan}: {len(ids)} paragraphs")

gap = json.loads((ROOT / "labels/gap_labels.json").read_text(encoding="utf-8"))["labels"]
seen = set()
for g in gap:
    key = (g["plan"], g["requirement_id"])
    if key in seen:
        errors.append(f"gap label duplicated: {key}")
    seen.add(key)
    if g["requirement_id"] not in req_ids:
        errors.append(f"gap label unknown requirement: {key}")
    if g["label"] not in ("met", "gap", "conflict"):
        errors.append(f"gap label bad value: {key} {g['label']}")
    if g["severity"] not in ("none", "low", "medium", "high", "critical"):
        errors.append(f"gap label bad severity: {key}")
    if (g["label"] == "met") != (g["severity"] == "none"):
        errors.append(f"gap label: severity must be 'none' exactly when label is 'met': {key}")
    if g["label"] == "conflict" and len(g["paragraph_ids"]) < 2:
        errors.append(f"conflict needs >= 2 paragraph_ids: {key}")
    if g["label"] == "met" and not g["paragraph_ids"]:
        errors.append(f"met needs a paragraph_id: {key}")
    for pid in g["paragraph_ids"]:
        if pid not in paragraphs.get(g["plan"], {}):
            errors.append(f"gap label {key}: unknown paragraph {pid}")
for plan in paragraphs:
    if any(p["plan"] == plan for p in gap):
        missing = req_ids - {r for (pl, r) in seen if pl == plan}
        if missing:
            errors.append(f"{plan}: no gap label for {sorted(missing)}")

items = json.loads((ROOT / "plans/sunvale/audit_items.json").read_text(encoding="utf-8"))["items"]
item_ids = {i["id"] for i in items}
for i in items:
    if i["requirement_id"] not in req_ids:
        errors.append(f"audit item {i['id']}: unknown requirement")
ev = json.loads((ROOT / "labels/evidence_labels.json").read_text(encoding="utf-8"))["labels"]
for e in ev:
    if e["audit_item_id"] not in item_ids:
        errors.append(f"evidence label unknown item {e['audit_item_id']}")
    if e["label"] not in ("satisfied", "partial", "missing"):
        errors.append(f"evidence label bad value {e['audit_item_id']}")
    if e["label"] != "missing" and not e["evidence_paragraph_ids"]:
        errors.append(f"{e['audit_item_id']}: satisfied/partial needs evidence_paragraph_ids")
    for pid in e["evidence_paragraph_ids"]:
        if pid not in paragraphs["sunvale"]:
            errors.append(f"{e['audit_item_id']}: unknown paragraph {pid}")
if {e["audit_item_id"] for e in ev} != item_ids:
    errors.append("every audit item needs exactly one evidence label")

from collections import Counter  # noqa: E402

print("gap labels:", Counter((g["plan"], g["label"]) for g in gap))
print("evidence labels:", Counter(e["label"] for e in ev), "tricky:", sum(e["tricky"] for e in ev))
print("\n".join(errors) if errors else "OK")
sys.exit(1 if errors else 0)
