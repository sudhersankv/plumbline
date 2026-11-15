"""documents: load a markdown file and split it into paragraphs with stable IDs.

Rule (also used by data authors): blocks are separated by blank lines.
Headings (lines starting with '#') and HTML comments are not numbered.
Every other block is a paragraph, numbered P1, P2, ... in order.
A paragraph's ID is '<DOC_ID>:P<n>', where DOC_ID is the file stem.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_COMMENT = re.compile(r"<!--.*?-->", re.S)


@dataclass(frozen=True)
class Paragraph:
    id: str  # e.g. SUNVALE-POL-02:P3
    doc_id: str
    index: int
    text: str
    section: str  # nearest heading above, for display


@dataclass(frozen=True)
class Document:
    id: str
    title: str
    path: str
    paragraphs: list[Paragraph]

    def get(self, paragraph_id: str) -> Paragraph | None:
        return next((p for p in self.paragraphs if p.id == paragraph_id), None)

    @property
    def full_text(self) -> str:
        """Whole document with paragraph IDs inline, for long-context models."""
        out = [f"# {self.title} [{self.id}]"]
        section = None
        for p in self.paragraphs:
            if p.section != section and p.section:
                out.append(f"## {p.section}")
                section = p.section
            out.append(f"[{p.id}] {p.text}")
        return "\n\n".join(out)


def parse(doc_id: str, text: str, path: str = "") -> Document:
    text = _COMMENT.sub("", text.replace("\r\n", "\n"))
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    title, section, paras, n = doc_id, "", [], 0
    for block in blocks:
        if block.startswith("#"):
            heading = block.lstrip("#").strip()
            if block.startswith("# ") and title == doc_id:
                title = heading
            else:
                section = heading
            continue
        n += 1
        clean = re.sub(r"\s+", " ", re.sub(r"^[-*]\s+", "", block))
        paras.append(Paragraph(f"{doc_id}:P{n}", doc_id, n, clean, section))
    return Document(doc_id, title, path, paras)


def load(path: str | Path) -> Document:
    p = Path(path)
    return parse(p.stem, p.read_text(encoding="utf-8"), str(p))


def load_dir(path: str | Path) -> list[Document]:
    return [load(p) for p in sorted(Path(path).glob("*.md"))]
