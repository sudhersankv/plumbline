"""cite: check every citation in code. Failures become needs_review; nothing is dropped."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
                         " ": " "})


def normalize(s: str) -> str:
    """Only cosmetic differences are forgiven: whitespace, curly quotes, dash style."""
    return re.sub(r"\s+", " ", s.translate(_QUOTES)).strip()


@dataclass
class Check:
    status: str  # verified | needs_review
    notes: list[str] = field(default_factory=list)


def verify(
    *,
    label: str,
    paragraph_ids: list[str],
    quote: str | None,
    corpus: dict[str, str],
    retrieved_ids: set[str] | None = None,
    needs_citation: bool = True,
) -> Check:
    """
    label          the verdict; used only for the notes
    paragraph_ids  paragraphs the model cited
    quote          text the model claims is in one of those paragraphs (None when the platform supplies it)
    corpus         id -> text for every paragraph this plan may cite
    retrieved_ids  if given, the model only saw these, so it may only cite these
    needs_citation false for verdicts that claim absence ("gap" with nothing relevant, "missing")
    """
    notes: list[str] = []
    ids = [p for p in paragraph_ids if p]
    if needs_citation and not ids:
        notes.append(f"'{label}' has no cited paragraph")
    for pid in ids:
        if pid not in corpus:
            notes.append(f"{pid} does not exist in this plan's documents")
        elif retrieved_ids is not None and pid not in retrieved_ids:
            notes.append(f"{pid} was cited but not retrieved, so the model never saw it")
    if quote is not None and quote.strip():
        q = normalize(quote).strip(" .;:\"'")
        if not any(q and q in normalize(corpus.get(pid, "")) for pid in ids):
            notes.append("quote does not appear word for word in the cited paragraphs")
    elif needs_citation and ids and quote is not None:
        notes.append("no quote given")
    return Check("needs_review" if notes else "verified", notes)
