# Plumbline

A small AI platform for healthcare compliance work. Two compliance workflows run on shared building blocks: documents, requirements, retrieval, citation checks, a model gateway, run records and a benchmark. Every model call goes through one gateway that routes each task to an LLM or a decision model. The benchmark, not a guess, decides which model gets which task.

Built as a toy to show the shape of a compliance AI platform: answers that are right, cited and defensible to a regulator, at the lowest cost that keeps quality.

> **Data:** the two health plans (Sunvale Health Plan, Bayline Community Health), their policies, evidence and audit items are fictional. The regulation is real: [DHCS All Plan Letter 26-001, Initial Health Appointment](https://www.dhcs.ca.gov/hm/formsandpubs/Documents/MMCDAPLsandPolicyLetters/APL%202026/APL26-001.pdf).

## What it does

| Workflow | The compliance team's question | Output |
|---|---|---|
| **Regulatory change** | "The state changed the rule. Which of our policies now fall short?" | Each of 16 requirements marked **met**, **gap** or **conflict**, with cited policy paragraphs and a severity |
| **Audit review** | "An auditor will check we follow the rule. Does our evidence satisfy each item?" | Each of 42 audit items marked **satisfied**, **partial** or **missing**, with cited evidence and an explanation for the reviewer |

A person reviews every finding in the console. The regulation text on screen always comes from the saved requirement and is never written by a model. Each policy citation is checked in code: the paragraph must exist, and the quote must appear in it word for word. A citation that fails becomes `needs_review`; nothing is dropped. A reviewer's accept or reject is saved as a label for the benchmark.

## Results

Each setup was run on the labelled datasets: 32 policy-gap items across both plans, and 42 audit items. Cost and latency are read from the gateway log. The **dangerous error** is a false "met" or false "satisfied": a gap the auditor finds and we didn't. It is reported separately.

### Policy gaps (32 items)

| Setup | Accuracy (95% CI) | False "met" | Cost (all items) |
|---|---|---|---|
| Opus 5.5, retrieve 5 paragraphs per item | 75% (58–87) | **4 of 10** | $0.263 |
| Haiku 5.5, retrieve 5 | 62% (45–77) | 5 of 10 | $0.008 |
| SubQ Snap, one item per call | 41% (26–58) | 5 of 10 | $0.001 |
| SubQ Snap, all items in one call | 81% (65–91) | 2 of 10 | $0.002 |
| **SubQ Savant, whole policy set in one call** | **94% (80–98)** | **0** | **$0.007** |
| Opus 5.5, whole policy set in one call | 94% (80–98) | 0 | $0.165 |

Retrieving the top 5 paragraphs misses **cross-policy conflicts**. For example, the IHA policy says only primary care may perform the IHA, while the network policy lets urgent care and a telehealth vendor do it. Neither paragraph is a gap on its own; the problem shows only when both are read together. Long-context setups catch these. Savant matches Opus long-context accuracy at about 1/24 of its cost, so `judge_gap` now routes to Savant.

### Audit evidence (42 items)

| Setup | Accuracy (95% CI) | False "satisfied" | Cost |
|---|---|---|---|
| Opus 5.5, retrieve 3 per item | 64% (49–77) | 0 | $0.326 |
| Haiku 5.5, retrieve 3 | 45% (31–60) | 0 | $0.009 |
| SubQ Snap, one item per call | 45% (31–60) | 5 of 21 | $0.001 |
| SubQ Snap, all items in one call | 83% (69–92) | 5 of 21 | $0.005 |
| SubQ Savant, whole evidence pack | 88% (75–95) | 2 of 21 | $0.012 |
| **Opus 5.5, whole evidence pack** | **95% (84–99)** | **0** | **$0.207** |
| Cascade: Snap first, escalate to Opus long context* | 95% (77–99) | 1 of 8 | $0.172 |

\*The cascade's confidence threshold was tuned on half the items and is reported on the other half.

`judge_evidence` routes to Opus with the whole evidence pack. It is the only setup with no false "satisfied", and in an audit that error matters more than the cost. Savant is 18× cheaper at 88%, but with 2 false "satisfied".

### SubQ Snap used as designed

Snap is a decision model: it takes one large context and many typed questions, and returns labels with probabilities. Stress tests on the 42 audit items:

| Test | Result |
|---|---|
| Questions per call: 1, 10 or 42 | 83%, 83%, 86% accuracy. Asking all 42 at once costs **24× less** than one call per question ($0.0007 vs $0.018) |
| Context depth: deciding evidence at the start, middle or end of a ~19K-token state with distractors | 85%, 85%, 82%: no position effect at this length |
| Calibration | Expected calibration error 0.10. Answers with confidence ≥ 0.97 were right 89% of the time, so a confidence threshold alone isn't enough to skip review |
| Option order reversed | 100% of answers unchanged |

The pattern that works: **Snap is cheap and fast enough to triage everything, long-context models judge the hard cases, and nothing a reviewer sees depends on a quote the model wrote.**

### Limitations

These are small, author-planted datasets: confidence intervals are wide. The stress tests used ~19K-token states, well below Snap's 384K-token limit. The Snap and Savant numbers come from SubQ's API as of 2026-11-14.

## Architecture

See [Toy compliance AI platform — architecture.md](Toy%20compliance%20AI%20platform%20—%20architecture.md) for the full design. The short version:

```
console (React) ──► platform API (FastAPI)
                       │
         workflows: regulatory_change · audit_review   (short functions)
                       │
  documents · requirements · retrieve · cite · judge · runs · benchmark   (platform pieces)
                       │
                    gateway  ── routing table (Postgres) ──┐
                       │                                    │
     Neon AI Gateway: Claude Opus/Sonnet/Haiku 5.5, embeddings      SubQ: Snap (decide), Savant (long context)
                       │
                Neon Postgres + pgvector: paragraphs, runs, verdicts, model calls, cache, routes, benchmarks
```

| Piece | Job |
|---|---|
| [`documents`](plumbline/documents.py) | Splits markdown into paragraphs with stable IDs such as `SUNVALE-POL-02:P12` |
| [`requirements`](plumbline/requirements.py) | Regulation → atomic obligations with exact quotes. Run once with Opus, checked, reviewed by a person, then shared by every plan |
| [`retrieve`](plumbline/retrieve.py) | pgvector search over paragraph embeddings (`qwen3-embedding-0-6b`) |
| [`cite`](plumbline/cite.py) | Checks every citation in code. A failure becomes `needs_review` and is never dropped |
| [`judge`](plumbline/judge.py) | Runs a labelling task in the shape its route names: `per_item`, `batched` (Snap), `long_context` or `cascade`. Every shape returns the same verdict records |
| [`gateway`](plumbline/gateway.py) | The only door to models: `complete()`, `decide()`, `embed()`. Routing by task, retries, fallback model, cache, and a log of cost and latency for every call |
| [`runs`](plumbline/runs.py) | Records each run, its verdicts and its model calls |
| [`benchmark`](plumbline/benchmark.py) | Runs labelled datasets through each setup; cascade replay; Snap stress tests |
| [`workflows`](plumbline/workflows.py) | The two workflows, about 15 lines each |

Changing a workflow's model is a row in the routing table, editable from the console, not a code change.

## Run it

You need Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 20+, a Neon project with the AI Gateway enabled, and a SubQ API key.

```bash
cp .env.example .env        # then fill in the values
uv sync
uv run python scripts/ingest.py           # create tables, seed routes, embed all documents
uv run pytest -q                          # platform unit tests (offline)
cd web && npm install && npm run build && cd ..
uv run uvicorn plumbline.api:app --port 8000
```

Open http://localhost:8000 and run a workflow from **Regulatory changes**. To regenerate the benchmark (about $1.50 the first time; reruns are served from the cache):

```bash
uv run python scripts/run_benchmarks.py
```

## Two-minute walkthrough

1. **Regulatory changes:** APL 26-001 reached both plans. Click **Run again** on Sunvale's policy gap review; it finishes in about 30 seconds.
2. **Gap review · Sunvale → R03:** a conflict. The regulation text sits on the left; on the right are the primary-care-only paragraph and the paragraph allowing urgent care and telehealth, with the quote highlighted. Accept it: the decision is saved as a label.
3. **Runs → that run:** each gateway call with its model, tokens, latency, cost, and whether it was cached.
4. **Benchmarks → Policy gaps:** retrieval-based Opus missed the conflicts (4 false "met"); Savant reading everything got 94% for 1/38 of the cost. Then open **SubQ Snap stress tests**.
5. **Routing → judge_gap → Change → "Opus 5.5 · retrieve" → Save.** Rerun the workflow and the conflicts disappear again. That's a one-line config change, and the benchmark shows why it's the wrong one.

## Repository layout

```
plumbline/        platform pieces, workflows, API
web/              console (React + Vite)
data/             APL text, reviewed requirements, fictional plan documents, labels
scripts/          ingest, data validation, benchmark runner
tests/            platform unit tests
DESIGN.md         console design system
```
