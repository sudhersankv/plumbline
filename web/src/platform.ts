// Static description of the platform's moving parts, shared by the map, the drawer and the workflows page.

export type Step = { title: string; piece: string; task?: string; detail: string };

export const WORKFLOW_STEPS: Record<string, { title: string; question: string; output: string; steps: Step[]; review: string }> = {
  regulatory_change: {
    title: "Regulatory change",
    question: "The state changed the rule. Which of our policies now fall short?",
    output: "Each requirement marked met, gap or conflict, with cited policy paragraphs and a severity.",
    review: "/gaps/sunvale",
    steps: [
      { title: "Load the reviewed requirements", piece: "requirements", detail: "16 obligations from APL 26-001, extracted once by Opus, reviewed by a person, shared by every plan." },
      { title: "Judge every requirement against the plan's policies", piece: "judge", task: "judge_gap", detail: "The route decides model and shape. Current route reads the whole policy set in one call." },
      { title: "Verify each citation in code", piece: "cite", detail: "Paragraph must exist, belong to this plan, and contain the quote word for word; otherwise needs_review." },
      { title: "Rate the severity of each gap", piece: "judge", task: "rate_severity", detail: "One decision-model call: a typed score question per finding over the whole policy set." },
      { title: "Save the run, verdicts and model calls", piece: "runs", detail: "Reviewers accept or reject in the workspace; decisions become labels." },
    ],
  },
  audit_review: {
    title: "Audit review",
    question: "An auditor will check we follow the rule. Does our evidence satisfy each item?",
    output: "Each audit item marked satisfied, partial or missing, with cited evidence and a reviewer explanation.",
    review: "/audit/sunvale",
    steps: [
      { title: "Load audit items and the requirements they test", piece: "requirements", detail: "42 auditor requests, each tied to one of the 16 requirements." },
      { title: "Judge the evidence for every item", piece: "judge", task: "judge_evidence", detail: "Current route reads the whole evidence pack in one call; the benchmark chose it for zero false “satisfied”." },
      { title: "Verify each citation in code", piece: "cite", detail: "Same check as every other workflow." },
      { title: "Explain anything short of satisfied", piece: "judge", task: "explain_evidence", detail: "A cheap model writes 2–3 sentences for each item a reviewer will read." },
      { title: "Save the run", piece: "runs", detail: "Every model call is logged against the run." },
    ],
  },
};

export type NodeDef = { id: string; title: string; sub: string; layer: string; file?: string; kind: "piece" | "workflow" | "model" | "app" | "db" | "api" };

export const NODES: NodeDef[] = [
  { id: "compliance", title: "Compliance workspace", sub: "First app on the platform: gap and audit review for health plans", layer: "Apps", kind: "app" },
  { id: "console", title: "Platform console", sub: "Runs, gateway, evals, datasets", layer: "Apps", kind: "app", file: undefined },
  { id: "api", title: "Platform API", sub: "Reads results, triggers runs. No logic in the UI", layer: "API", kind: "api", file: "plumbline/api.py" },
  { id: "regulatory_change", title: "Regulatory change", sub: "Which policies fall short of a new rule?", layer: "Workflows", kind: "workflow", file: "plumbline/workflows.py" },
  { id: "audit_review", title: "Audit review", sub: "Does our evidence satisfy each audit item?", layer: "Workflows", kind: "workflow", file: "plumbline/workflows.py" },
  { id: "benchmark", title: "Eval harness", sub: "Same pieces, every model setup, scored against labels", layer: "Workflows", kind: "piece", file: "plumbline/benchmark.py" },
  { id: "documents", title: "documents", sub: "Stable paragraph IDs", layer: "Platform pieces", kind: "piece", file: "plumbline/documents.py" },
  { id: "requirements", title: "requirements", sub: "Regulation → obligations", layer: "Platform pieces", kind: "piece", file: "plumbline/requirements.py" },
  { id: "retrieve", title: "retrieve", sub: "Embeddings + pgvector", layer: "Platform pieces", kind: "piece", file: "plumbline/retrieve.py" },
  { id: "cite", title: "cite", sub: "Citations verified in code", layer: "Platform pieces", kind: "piece", file: "plumbline/cite.py" },
  { id: "judge", title: "judge", sub: "Any task, any shape the route names", layer: "Platform pieces", kind: "piece", file: "plumbline/judge.py" },
  { id: "runs", title: "runs", sub: "Run, verdict and call records", layer: "Platform pieces", kind: "piece", file: "plumbline/runs.py" },
  { id: "gateway", title: "Model gateway", sub: "complete() · decide() · embed()", layer: "Gateway", kind: "piece", file: "plumbline/gateway.py" },
  { id: "postgres", title: "Neon Postgres", sub: "pgvector · runs · calls · cache · routes · evals", layer: "side", kind: "db", file: "plumbline/db.py" },
];

export const MODEL_INFO: Record<string, { provider: string; role: string; note: string }> = {
  "claude-opus-5-5": { provider: "Neon AI Gateway", role: "Strong LLM", note: "Requirement extraction; audit evidence (whole pack). Structured output via output_config, effort set per route." },
  "claude-sonnet-5-5": { provider: "Neon AI Gateway", role: "Fallback", note: "Used automatically when the primary model fails after retries." },
  "claude-haiku-5-5": { provider: "Neon AI Gateway", role: "Cheap LLM", note: "Reviewer explanations; benchmarked as the cheap baseline." },
  "qwen3-embedding-0-6b": { provider: "Neon AI Gateway", role: "Embeddings", note: "1024-dim vectors for every paragraph, stored in pgvector." },
  "subq-snap-1.2": { provider: "SubQ", role: "Decision model", note: "Typed answers (choice, yes/no, score) with probabilities; up to 128 questions over a 384K-token context per call. Billed on input only." },
  "subq-savant-1.4": { provider: "SubQ", role: "Long-context LLM", note: "4M-token context, JSON-schema output. Reads a plan's whole policy set in one call." },
};
