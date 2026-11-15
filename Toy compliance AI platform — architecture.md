# Toy compliance AI platform — architecture

Nov 14, 2026 · @Sudhersan

A small platform that runs simulated health-plan compliance workflows on shared building blocks, and benchmarks a large language model against a decision model on the same tasks to show where routing cuts cost. Everything about the plans is fictional; the regulation is real.

## Scenario

Two fictional California Medi-Cal health plans, Sunvale and Bayline, receive a real state regulatory letter: [DHCS APL 26-001, Initial Health Appointment](https://www.dhcs.ca.gov/hm/formsandpubs/Documents/MMCDAPLsandPolicyLetters/APL%202026/APL26-001.pdf). Their compliance teams have two jobs, and each becomes a workflow on the platform:

- **Regulatory change:** "The state changed the rule. Which of our policies now fall short?" Each plan has 4–5 fictional policies with planted gaps.
- **Audit review:** "An auditor will check we follow the rule. For each audit item, does our evidence satisfy it?" Sunvale has about 40 audit items with fictional evidence (minutes, reports, logs), labelled satisfied, partial or missing.

A person reviews every output, as in a real compliance team. The platform's job is to make that review fast and trustworthy, and to do it at the lowest cost that keeps quality.

## At a glance

&#91;embedded content: architecture · console, 2 workflows, 6 pieces, 1 gateway, 2 model families\]

Workflows never call a model directly; the gateway picks an LLM or the decision model per task, and the benchmark (highlighted) decides which.

## Platform pieces

Seven pieces, each a small module with one job. Models appear in only two of them: the gateway (every model call) and the benchmark runner (which calls the gateway).

| Piece | What it does | Model or code | Used by |
| --- | --- | --- | --- |
| `documents` | Loads a PDF or markdown file and splits it into paragraphs with stable IDs, e.g. `SUNVALE-POL-02:P3` | Code | Both workflows |
| `requirements` | Turns a regulation into atomic obligations, each with an exact quote. Run once, reviewed by a person, saved, shared by every plan | LLM, once | Regulatory change, and audit items are built from it |
| `retrieve` | Finds the closest paragraphs or evidence for a query using embeddings | Embedding model + code | Both workflows |
| `cite` | Checks that a cited paragraph was retrieved and its quote exists word for word; failures become `needs_review`, never dropped | Code | Both workflows |
| `gateway` | The only door to models. Two kinds of call: `complete()` for LLMs, `decide()` for the decision model. Routes each task by a config table, retries on a fallback model, caches, logs cost and latency | Calls models | Everything |
| `runs` | Records every workflow run: inputs, outputs, verdicts, and the gateway calls it made | Code | Console, benchmark |
| `benchmark` | Runs one task's labelled dataset through several model setups and compares them | Code (calls the gateway) | Console, routing decisions |

## The two workflows

Both are short functions that only call platform pieces. The second exists to prove the pieces are reusable.

**Regulatory change**

1. Load the saved requirements for APL 26-001. They were extracted once and are shared by both plans.
2. Load the plan's policies as paragraphs.
3. For each requirement, retrieve the 5 closest policy paragraphs.
4. Ask the gateway for task `judge_gap`: met or gap, which paragraph, and a quote.
5. Run `cite.verify`. The regulation quote is attached from the saved requirement, never generated.
6. Save the run.

**Audit review**

1. Load the plan's audit items and evidence files.
2. Ask the gateway for task `judge_evidence` on all items. The route decides the shape of the call:
   - **Per item** (LLM routes): retrieve the 3 closest evidence passages for each item, one call per item.
   - **Batched** (decision model route): the whole evidence pack once as context, every audit item as a typed question, one call.
3. If the verdict is partial or missing, or confidence is below the route's threshold, ask for task `explain_evidence`: a short explanation for the reviewer.
4. Save the run.

The workflow doesn't know which shape ran; the gateway returns the same verdict records either way. Audit review should be about 20 lines. If it needs more, the missing piece belongs in the platform, not the workflow.

## Model routing and the benchmark

Every task has a route in one table, and the benchmark decides what goes in it. Changing a workflow's model is a one-line config change, not a code change.

| Task | Route to start with | Benchmarked? |
| --- | --- | --- |
| `extract_requirements` | Strong LLM | No, run once and reviewed |
| `judge_gap` | Strong LLM | Yes |
| `judge_evidence` | Strong LLM | Yes, the main comparison |
| `explain_evidence` | Cheap LLM | No |
| `screen_requirement` | Decision model (SubQ Snap), `noul` | Yes |
| `rate_severity` | Decision model (SubQ Snap), `score` | Yes, against labelled severity |
| `locate_paragraph` | Decision model (SubQ Snap), `choice` | Yes, against the citation labels |
| `cross_document_check` | Long-context model (SubQ Savant) | Yes, against retrieval-based `judge_gap` |

**Models behind the gateway.** Every call goes through the gateway. Claude models and embeddings are served by the Neon AI Gateway; SubQ is a second provider.

| Role | Model | Notes |
| --- | --- | --- |
| Strong LLM | `claude-opus-5-5` | Neon AI Gateway |
| Cheap LLM | `claude-haiku-5-5` | Neon AI Gateway |
| Fallback | `claude-sonnet-5-5` | Neon AI Gateway |
| Embeddings | `qwen3-embedding-0-6b` (1024 dims) | Neon AI Gateway, stored in Neon Postgres with pgvector |
| Decision model | `subq-snap-1.2` | SubQ `/systemone`. Picks from fixed options, returns per-option probabilities and a confidence; 384K-token context; billed on input only |
| Long-context model | `subq-savant-1.4` | SubQ, OpenAI-compatible chat, 4M-token context, JSON-schema output |

### Using SubQ as it was designed

Compliance checking is a long-context, typed-outcome problem: a lot of documents go in, and what comes out is a fixed label a reviewer can act on. That is what SubQ Snap is built for. Snap takes a large `state` (up to 384K tokens) and up to 128 named questions per call, and answers each with a typed result. It doesn't write text, so it never invents a quote.

**Batch, don't loop.** Snap's natural use is one call with the whole evidence pack as `state` and every audit item as a question. Sending it one item and three retrieved passages at a time, the way an LLM is called, discards both of its strengths. The gateway's `decide()` takes a list of questions and splits them into batches of 128.

**Compliance questions map onto Snap's three answer types:**

| Compliance question | Snap type | What comes back | Task |
| --- | --- | --- | --- |
| Does the evidence satisfy audit item 12? | `choice`: satisfied, partial, missing | Label, probability per label, confidence | `judge_evidence` |
| Is requirement R7 met by our policies? | `choice`: met, gap, conflict | Label, probabilities, confidence | `judge_gap` |
| Is this requirement addressed anywhere at all? | `noul` | Probability of yes | `screen_requirement` |
| How severe is this gap? | `score`: low, medium, high, critical | Weighted score, probability per level | `rate_severity` |
| Which paragraph covers requirement R7? | `choice` over paragraph IDs plus `not_found` | Paragraph ID, confidence | `locate_paragraph` |

**Citations by construction.** `locate_paragraph` returns a paragraph ID, not text. The quote shown to the reviewer is read from the stored paragraph, so it can't be invented. `cite.verify` still checks that the ID exists and belongs to the plan, and a low-confidence or `not_found` answer becomes `needs_review`.

**Where Savant fits.** SubQ Savant (4M-token context, JSON-schema output) handles `cross_document_check`: the whole APL and all of a plan's policies in one prompt. For each requirement it returns met, gap or conflict, with every paragraph ID involved and quotes that pass through `cite.verify`. This catches what top-5 retrieval misses: a requirement met in one policy but contradicted in another, a timeline split across two documents, or an exception buried in an appendix. Savant (or the cheap LLM) also writes `explain_evidence` for items that go to a reviewer, since Snap gives labels, not reasons.

**Split of work:** Snap decides every item cheaply. Savant or Claude explains only the items a person will read.

**Model setups compared** on each benchmarked task, using its labelled dataset:

| Setup | How it works |
| --- | --- |
| Strong LLM | Every item judged by the large model, with a written reason |
| Cheap LLM | Same prompt, smaller model |
| Snap, per item | One call per item with retrieved passages, the same input the LLMs get. A control, not how Snap is meant to run |
| Snap, batched | The whole evidence pack as `state`, every item as a question, one call. Snap as designed |
| Cascade | Snap batched first. Escalate to the strong LLM when confidence is below the threshold or the label is not "satisfied", since those go to a reviewer who needs an explanation |
| Long context (SubQ Savant) | No retrieval: the full document set in one call, judged for all requirements at once |

**What the benchmark reports** for each setup:

- Accuracy against the labels, overall and on deliberately tricky items (including planted cross-policy conflicts).
- **False "satisfied" (or false "met")**: the dangerous error, a gap the auditor finds and we didn't. Reported on its own.
- Share of items escalated to the LLM (cascade only).
- Total cost, cost per item, p50 and p95 latency, all read from the gateway log. Cost uses actual token usage from each response.
- 95% confidence intervals on every accuracy number; with about 40 items, a few points' difference may be noise.

**Stress tests for Snap.** These check how Snap is used in practice:

- **Questions per call:** the same items asked 1, 10, 40 and 128 at a time. Does accuracy hold as calls get denser?
- **Context depth:** the deciding evidence placed at the start, middle and end of a long `state`, with planted distractors such as an older policy version or a near-miss report.
- **Calibration:** does a confidence of 0.9 mean right about 90% of the time? Plotted as a reliability chart. The cascade threshold is only as good as this.
- **Option order:** the same question with its choice options shuffled. Answers should not change.

The cascade's confidence threshold is chosen on half the items and reported on the other half, so it isn't tuned on the data it is judged on.

Snap returns a `confidence` and per-label `probabilities` on choice questions (checked against the live API), so the cascade escalates on confidence and label together.

## Console UI

Two areas over one platform API, styled like a compliance product rather than a developer tool. The UI only reads results and triggers runs; all logic stays in the platform.

| Area | For | Pages |
| --- | --- | --- |
| Compliance workspace | Reviewers at a plan | **Regulatory changes:** new letters and which plans they affect. **Gap review:** requirement text and policy text side by side, `verified` or `needs_review`, accept or reject. **Audit review:** each item, its evidence, the verdict and the explanation |
| Platform | Engineers | **Runs:** each run and the model calls behind it, with cost and time. **Benchmarks:** setups compared, cost against accuracy. **Routing:** the task-to-model table. **Datasets:** requirements, audit items and labels |

A reviewer's accept or reject is saved as a label, so the benchmark grows from real review work instead of only planted cases.

## Data and state

Four kinds of data, kept apart because they change at different rates and have different scopes.

| Kind | Examples | Scope | Changes when |
| --- | --- | --- | --- |
| Sources | APL text, plan policies, evidence | Regulations shared; plan documents per plan | A new document arrives |
| Derived | Paragraph IDs, requirements, embeddings | Same as their source | The source changes; requirements also after human review |
| Operational | Runs, verdicts, model calls, benchmark results | Per plan; benchmarks platform-wide | Every run |
| Config and labels | Routing table, labelled datasets | Platform-wide | A benchmark result or a reviewer decision |

Every label records where a gap was planted and why it's tricky, so a wrong benchmark result can be traced to one item.

## Design choices

| Choice | Why |
| --- | --- |
| Requirements extracted once and shared by every plan | One state letter reaches every Medi-Cal plan. Doing the regulation side once cuts cost, and every plan cites the same requirement IDs |
| Every paragraph has a stable ID | A reviewer must find the cited text in seconds; IDs make citations checkable |
| Citations verified in code | A person signs every output, so a citation must be guaranteed, not just likely |
| Unverified verdicts become `needs_review`, never dropped | A missed gap costs more than an extra one |
| Regulation quotes come from saved requirements | The model never writes regulation text a reviewer sees |
| One gateway for every model call | Logging, cost, caching, fallback and future data controls apply everywhere at once |
| Long-context model alongside retrieval | Cross-policy conflicts and split timelines are invisible to top-5 retrieval; reading everything once catches them, and the benchmark shows when it's worth the cost |
| Routing by task, decided by benchmark | Each task gets the cheapest model that keeps quality; a decision model may be enough for labelling, while an LLM writes explanations |
| Workflows are plain functions | Two short pipelines don't need agent autonomy; functions are easier to test and explain |

## Adding a third workflow

A new workflow, such as checking a vendor contract against the same letter, needs only a new function, a task name in the routing table, and a labelled dataset if it should be benchmarked. It reuses `documents`, `requirements`, `retrieve`, `cite`, `gateway` and `runs` unchanged, and shows up in the console automatically.

## What a real version needs

- Real data handling: providers covered by a business associate agreement, scrubbing of protected health information before any model call, per-plan isolation in storage.
- Many regulations kept current, with versions tracked when a letter replaces an older one.
- Reviewer decisions from the workspace feeding labels continuously.
- Access control: reviewers see their own plan; engineers see the platform area.

## Build order

1. Data: APL text, both plans' policies, audit items and evidence, labels.
2. Platform pieces with unit tests (a made-up quote must become `needs_review`).
3. Regulatory change on both plans.
4. Audit review, then the benchmark across all setups, with the Snap stress tests.
5. Console.
6. A two-minute walkthrough: run a workflow, open a run, show the benchmark, change a route.
