"""requirements: turn a regulation into atomic obligations, each with an exact quote.

Run once per regulation (strong LLM), checked by cite.verify, reviewed by a person, then saved and
shared by every plan. Workflows only ever read the reviewed file.
"""

from __future__ import annotations

import json

from . import cite, config, gateway
from .documents import load
from .tasks import load_requirements

SYSTEM = """You turn a state regulatory letter for Medi-Cal managed care plans into a checklist of atomic obligations.
One obligation per row: something a plan must do, must include, or must not do. Split lists into separate rows.
Skip background, history and contact information unless it removes or changes an obligation.
`quote` must be copied word for word from the cited paragraph. `paragraph_id` must be one of the IDs shown in brackets."""

SCHEMA = {"type": "object", "properties": {"requirements": {"type": "array", "items": {"type": "object", "properties": {
    "topic": {"type": "string"}, "obligation": {"type": "string"},
    "paragraph_id": {"type": "string"}, "quote": {"type": "string"}},
    "required": ["topic", "obligation", "paragraph_id", "quote"]}}}, "required": ["requirements"]}


def extract_draft(regulation_id: str = "APL26-001") -> dict:
    doc = load(config.DATA / f"regulations/{regulation_id}.md")
    r = gateway.complete("extract_requirements", SYSTEM, doc.full_text, SCHEMA, max_tokens=16000)
    lookup = {p.id: p.text for p in doc.paragraphs}
    rows = []
    for i, req in enumerate(r.data["requirements"], 1):
        c = cite.verify(label="requirement", paragraph_ids=[req["paragraph_id"]], quote=req["quote"], corpus=lookup)
        rows.append({"id": f"{regulation_id}-D{i:02d}", **req, "citation_status": c.status, "citation_notes": c.notes})
    draft = {"regulation_id": regulation_id, "status": "draft", "model": r.model, "cost_usd": r.cost_usd,
             "requirements": rows}
    (config.DATA / f"requirements/{regulation_id}.draft.json").write_text(json.dumps(draft, indent=2), encoding="utf-8")
    return draft


def load_reviewed(regulation_id: str = "APL26-001") -> list[dict]:
    return load_requirements(regulation_id)
