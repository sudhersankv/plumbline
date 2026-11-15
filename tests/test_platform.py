"""Platform unit tests. No network or database needed."""

from plumbline import cite, config
from plumbline.documents import load, parse
from plumbline.gateway import _strict
from plumbline.judge import Verdict, _check, setup_name
from plumbline.tasks import EVIDENCE, GAP, gap_items, load_requirements

CORPUS = {
    "SUNVALE-POL-01:P3": "The Member’s PCP performs the IHA within 120 calendar days of enrollment.",
    "SUNVALE-POL-02:P9": "Urgent care centers may complete the IHA when the PCP is unavailable.",
}


# ─── documents ────────────────────────────────────────────────────────────────
def test_paragraph_ids_skip_headings_and_comments():
    d = parse("X-POL-01", "# Title\n\n<!-- note -->\n\n## Purpose\n\nFirst para.\n\n- bullet one\n\n## Policy\n\nSecond\nline.")
    assert d.title == "Title"
    assert [p.id for p in d.paragraphs] == ["X-POL-01:P1", "X-POL-01:P2", "X-POL-01:P3"]
    assert d.paragraphs[1].text == "bullet one"            # bullet marker stripped
    assert d.paragraphs[2].text == "Second line."           # whitespace collapsed
    assert d.paragraphs[2].section == "Policy"


def test_ids_are_stable_across_reloads():
    a = load(config.DATA / "regulations/APL26-001.md")
    b = load(config.DATA / "regulations/APL26-001.md")
    assert [(p.id, p.text) for p in a.paragraphs] == [(p.id, p.text) for p in b.paragraphs]


# ─── cite ─────────────────────────────────────────────────────────────────────
def test_made_up_quote_becomes_needs_review():
    c = cite.verify(label="met", paragraph_ids=["SUNVALE-POL-01:P3"],
                    quote="The PCP completes the IHA within 90 days.", corpus=CORPUS)
    assert c.status == "needs_review"
    assert any("word for word" in n for n in c.notes)


def test_exact_quote_is_verified_even_with_curly_quotes_and_spacing():
    c = cite.verify(label="met", paragraph_ids=["SUNVALE-POL-01:P3"],
                    quote="The Member's  PCP performs the IHA", corpus=CORPUS)
    assert c.status == "verified", c.notes


def test_quote_from_another_paragraph_than_cited_fails():
    c = cite.verify(label="met", paragraph_ids=["SUNVALE-POL-01:P3"],
                    quote="Urgent care centers may complete the IHA", corpus=CORPUS)
    assert c.status == "needs_review"


def test_cited_but_not_retrieved_fails():
    c = cite.verify(label="met", paragraph_ids=["SUNVALE-POL-02:P9"], quote="Urgent care centers may complete the IHA",
                    corpus=CORPUS, retrieved_ids={"SUNVALE-POL-01:P3"})
    assert c.status == "needs_review"
    assert any("not retrieved" in n for n in c.notes)


def test_unknown_paragraph_fails():
    c = cite.verify(label="met", paragraph_ids=["SUNVALE-POL-09:P1"], quote="anything", corpus=CORPUS)
    assert c.status == "needs_review"


def test_positive_verdict_without_citation_fails_but_absence_does_not():
    assert cite.verify(label="met", paragraph_ids=[], quote="", corpus=CORPUS).status == "needs_review"
    assert cite.verify(label="gap", paragraph_ids=[], quote="", corpus=CORPUS, needs_citation=False).status == "verified"


def test_platform_supplied_quote_needs_only_a_valid_id():
    # Snap returns a paragraph ID; the quote is read from storage, so only the ID is checked.
    v = _check(GAP, Verdict("R1", "met", "batched", paragraph_ids=["SUNVALE-POL-01:P3"]), CORPUS, None,
               quote_from_model=False)
    assert v.citation_status == "verified"


def test_unusable_answer_is_never_dropped():
    v = _check(EVIDENCE, Verdict("AUD-1", "no_answer", "long_context"), CORPUS, None, quote_from_model=True)
    assert v.citation_status == "needs_review"


# ─── requirements ─────────────────────────────────────────────────────────────
def test_every_reviewed_requirement_quote_is_in_the_regulation():
    doc = load(config.DATA / "regulations/APL26-001.md")
    lookup = {p.id: p.text for p in doc.paragraphs}
    for r in load_requirements("APL26-001"):
        c = cite.verify(label="req", paragraph_ids=[r["paragraph_id"]], quote=r["quote"], corpus=lookup)
        assert c.status == "verified", (r["id"], c.notes)


def test_regulation_quote_comes_from_saved_requirement():
    items = gap_items(load_requirements("APL26-001"))
    assert all(it.regulation_quote for it in items)


# ─── gateway helpers ──────────────────────────────────────────────────────────
def test_strict_schema_marks_everything_required():
    s = _strict({"type": "object", "properties": {"a": {"type": "string"},
                 "b": {"type": "array", "items": {"type": "object", "properties": {"c": {"type": "integer"}}}}}})
    assert s["required"] == ["a", "b"] and s["additionalProperties"] is False
    assert s["properties"]["b"]["items"]["required"] == ["c"]


def test_cost_math():
    assert abs(config.cost_usd("claude-opus-5-5", 1_000_000, 100_000) - 6.0) < 1e-9
    assert config.cost_usd("unknown-model", 10, 10) == 0.0


def test_setup_names():
    assert setup_name({"shape": "batched", "model": "subq-snap-1.2"}) == "batched:subq-snap-1.2"
    assert setup_name({"shape": "cascade", "first": {"name": "snap"}, "then": {"name": "opus"}}) == "cascade(snap->opus)"
