# Models, how they're called, and why

This note records what each provider's documentation says, how Plumbline calls each model, and where the two were checked against each other. Reviewed 2026-11-14.

## Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5) through the Neon AI Gateway

| Topic | What the docs say | What Plumbline does |
|---|---|---|
| Route | Neon: native Anthropic Messages at `{NEON_AI_GATEWAY_BASE_URL}/anthropic/v1/messages`, `Authorization: Bearer`, `anthropic-version` forwarded | Same |
| Model availability | Neon's Anthropic page lists Opus 5.5 but not Sonnet 5.5 or Haiku 5.5; its overview and model pages list all three | Verified by live calls: all three work on this route |
| Thinking | Claude 5.5 models think adaptively. Opus 5.5 rejects `thinking.disabled`, and every 5.5 model rejects `budget_tokens` | `thinking` is never sent (adaptive by default) |
| Effort | `output_config.effort`. Default is `medium` on Opus and Haiku 5.5 and `high` on Sonnet 5.5. Use at least `high` for intelligence-sensitive work; `low` suits classification and high-volume routes | Always set explicitly per route. **Model comparison: `high` for every LLM.** Production routes: `low` for explanations |
| Structured output | Forced `tool_choice` returns 400 on Opus and Sonnet 5.5. Use `output_config.format` (`json_schema`) instead | `output_config.format`. Neon doesn't document it, so it was verified live: the schema is enforced even when the prompt never mentions JSON |
| Long outputs | Stream requests with large `max_tokens`. Neon's timeout message says to "use streaming" | Requests with `max_tokens` > 16,000 stream over SSE |
| Prompt caching | Neon forwards `cache_control` unchanged. Cache writes cost more than input; reads cost less | On for long system prompts in workflows. **Off in the model comparison**, so one-shot cost isn't inflated by a write or discounted by an earlier read |
| Refusals and truncation | Check `stop_reason` (`refusal`, `max_tokens`) before reading content | A refusal is retried, then falls back. Running out of tokens raises a non-retryable error rather than retrying the same budget |
| Rate limits | Neon: 200K input and 200K output tokens per minute (upstream about 20K output TPM); $20/day default spend cap; 429 on limits | Five retries that honor `Retry-After`; up to 8 calls in parallel |
| Prices | Neon charges the provider's per-token rate. Opus $4/$20, Sonnet $2/$10, Haiku $0.10/$0.50 per 1M tokens | Cost is tokens from each response × these prices |

## SubQ Snap (decision model)

What it is, in SubQ's words: decision models "evaluate supplied context against defined questions and return structured answers". Instead of generating text, Snap scores a fixed set of allowed answers ("a single, non-autoregressive probability distribution over a discrete action space"). Nearly all compute is prefill, so speed and cost track input size, not output.

| Topic | What the docs say | What Plumbline does |
|---|---|---|
| Endpoint | `POST /v1/systemone` with `model`, `state`, and 1–128 named `questions` | Same; more than 128 questions are split across calls |
| Question types | `choice` (2–255 options, descriptions optional), `noul` (yes/no probability), `score` (2–10 ordered levels) | Verdicts and "which paragraph": `choice`. Severity: `score` |
| Documents | "Mark pages, sections, or passages … like `[P2]` … so options can name them"; add a `not_found` option | Each paragraph is prefixed with its ID, and the IDs are the options, plus `not_found` |
| Option names | Allowed characters are not documented | IDs such as `SUNVALE-POL-02:P12` work in live calls and come back unchanged |
| Context | 384K tokens; requests near the limit return 400 | The largest state used is about 20K tokens |
| Confidence | Returned for `choice` and `score`. Not defined, with no recommended thresholds; release notes say to "test any thresholds you rely on" | Calibration measured (ECE 0.10). The cascade threshold is tuned on half the items and reported on the other half |
| Option order | Snap 1.2 "eliminates order sensitivity for choice questions" | Measured: 100% of answers unchanged with the options reversed |
| Determinism | No temperature or seed; repeatability not documented | Not assumed |
| Billing | Input tokens only, $0.04 per 1M | Same |
| Use cases | "Routing, ranking, classifying, yes/no calls"; weak at "open-ended generation". No compliance-specific guidance | Used for triage, evidence location and severity. Explanations stay with an LLM |

## SubQ Savant (long-context LLM)

| Topic | What the docs say | What Plumbline does |
|---|---|---|
| Endpoint | OpenAI-compatible `POST /v1/chat/completions`; 4M-token context; early access | Same |
| Reasoning | `reasoning_effort`: `low`, `high` (default) or `max`. `low` for "short answers, extraction"; `high` for "most analysis"; reasoning can't be turned off | **Model comparison: `high`.** Production gap route: `high` |
| Output budget | `max_tokens` includes reasoning; content can be `null` with `finish_reason: "length"` | 64,000 for whole-corpus calls; a length stop raises a clear error |
| Temperature | Fixed at 1; any other value returns 400 | Never sent |
| Structured output | `response_format` `json_schema`, `strict`. Every property required, `additionalProperties: false`, root type object | Schemas are converted to this strict form |
| Prices | $0.10 in, $0.01 cached in, $0.50 out per 1M tokens | Same |

## Embeddings

Neon serves `qwen3-embedding-0-6b` at `/v1/embeddings`: 1024 dimensions by default, up to 150 inputs per request. Neon doesn't document a query instruction; the Qwen3 embedding convention of an `Instruct: … Query:` prefix on queries only is applied, and documents stay unprefixed.

## Sources

- SubQ: docs.subq.ai (Decisions API, Chat Completions, Structured outputs, Models, Release notes), subq.ai, subq.ai/introducing-subq-snap, subq.ai/subq-snap-1-1, subq.ai/subq-snap-1-2
- Neon: neon.com/docs/ai-gateway (anthropic-messages, overview, models, embeddings, troubleshooting, authentication, prepaid-credits), models.dev/providers/neon
- Anthropic: Claude API reference (Opus 5.5, Sonnet 5.5 and Haiku 5.5 migration notes; structured outputs; effort; prompt caching)
