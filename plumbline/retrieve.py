"""retrieve: index paragraphs with embeddings and find the closest ones for a query."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from . import db, gateway
from .documents import Document

# Qwen3 embeddings use an instruction on the query side only; documents stay unprefixed.
QUERY_INSTRUCTION = ("Instruct: Given a healthcare compliance requirement or an auditor's request, "
                     "retrieve the policy or evidence passages that address it\nQuery: ")


@dataclass(frozen=True)
class Hit:
    id: str
    doc_id: str
    section: str
    text: str
    score: float


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


def index(docs: list[Document], plan: str | None, kind: str) -> int:
    """Store documents and paragraphs; embed only paragraphs that are new or changed. Returns # embedded."""
    todo: list[tuple[str, str]] = []
    for d in docs:
        db.q("""insert into documents(id, plan, kind, title, path) values (%s,%s,%s,%s,%s)
                on conflict (id) do update set title=excluded.title, path=excluded.path, plan=excluded.plan, kind=excluded.kind""",
             d.id, plan, kind, d.title, d.path)
        keep = [p.id for p in d.paragraphs]
        db.q("delete from paragraphs where doc_id=%s and not (id = any(%s))", d.id, keep)
        for p in d.paragraphs:
            h = _hash(p.text)
            row = db.one("select text_hash, embedding is not null as has from paragraphs where id=%s", p.id)
            if row and row["text_hash"] == h and row["has"]:
                continue
            db.q("""insert into paragraphs(id, doc_id, plan, kind, idx, section, text, text_hash) values (%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do update set idx=excluded.idx, section=excluded.section, text=excluded.text,
                    text_hash=excluded.text_hash, embedding=null""",
                 p.id, d.id, plan, kind, p.index, p.section, p.text, h)
            todo.append((p.id, f"{d.title} — {p.section}\n{p.text}" if p.section else f"{d.title}\n{p.text}"))
    if todo:
        vecs = gateway.embed([t for _, t in todo], task="index")
        for (pid, _), v in zip(todo, vecs):
            db.q("update paragraphs set embedding=%s where id=%s", np.array(v, dtype=np.float32), pid)
    return len(todo)


def search(query: str, plan: str | None, kind: str, k: int = 5) -> list[Hit]:
    [v] = gateway.embed([QUERY_INSTRUCTION + query], task="retrieve")
    rows = db.q("""select id, doc_id, section, text, 1 - (embedding <=> %s) as score from paragraphs
                   where plan is not distinct from %s and kind=%s and embedding is not null
                   order by embedding <=> %s limit %s""",
                np.array(v, dtype=np.float32), plan, kind, np.array(v, dtype=np.float32), k)
    return [Hit(r["id"], r["doc_id"], r["section"], r["text"], float(r["score"])) for r in rows]


def corpus(plan: str | None, kind: str) -> tuple[str, dict[str, str]]:
    """Whole document set as one text with paragraph IDs inline, plus an id -> text lookup."""
    rows = db.q("""select p.id, p.doc_id, p.section, p.text, d.title from paragraphs p join documents d on d.id=p.doc_id
                   where p.plan is not distinct from %s and p.kind=%s order by p.doc_id, p.idx""", plan, kind)
    out, lookup, doc, section = [], {}, None, None
    for r in rows:
        if r["doc_id"] != doc:
            doc, section = r["doc_id"], None
            out.append(f"\n=== DOCUMENT {r['doc_id']}: {r['title']} ===")
        if r["section"] and r["section"] != section:
            section = r["section"]
            out.append(f"## {section}")
        out.append(f"[{r['id']}] {r['text']}")
        lookup[r["id"]] = r["text"]
    return "\n\n".join(out).strip(), lookup
