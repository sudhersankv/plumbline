import { useState } from "react";
import { pct, post, usd, when } from "../api";
import { Elapsed, Empty } from "../ui";

const TASKS: Record<string, { title: string; danger: string; n: string }> = {
  judge_gap: { title: "Policy gaps", danger: "false “met”", n: "16 requirements × 2 plans" },
  judge_evidence: { title: "Audit evidence", danger: "false “satisfied”", n: "42 audit items" },
};
const CONDS: Record<string, { title: string; note: string }> = {
  whole: { title: "Same full document set", note: "Every model gets the plan's entire document set and all items at once. The LLMs generate a structured answer for each item; Snap answers every item as a typed question in one forward pass. This is the condition Snap is designed for." },
  retrieve: { title: "Same retrieved passages", note: "Every model gets the same top-k retrieved passages, one item per call, 8 calls in parallel. The common RAG setup; included as the control." },
};

const signed = (n: number, digits = 0) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(digits)}`;
const secs = (s: number) => (s >= 60 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(1)}s`);

export function Compare({ data, reload }: { data: any[] | null; reload: () => void }) {
  const [task, setTask] = useState("judge_gap");
  const [cond, setCond] = useState("whole");
  const b = data?.find((x) => x.task === task && x.kind === "models");
  const ms: Record<string, any> | undefined = b?.results?.conditions?.[cond];
  const t = TASKS[task];

  async function start() {
    if (!confirm("Runs every model on this task with the cache off, so time and cost are real. About $0.75 per task. Run it?")) return;
    await post("/api/benchmarks", { task, kind: "models" });
    reload();
  }

  const ORDER = ["opus_long", "sonnet_long", "haiku_long", "savant_long", "snap_batched", "opus_retrieve", "sonnet_retrieve", "haiku_retrieve", "snap_per_item"];
  const rows = ms ? Object.entries<any>(ms).sort(([a], [b2]) => ORDER.indexOf(a) - ORDER.indexOf(b2)) : [];
  const opus = rows.find(([k]) => k.startsWith("opus"))?.[1];
  const st = b?.results?.settings;
  const maxCost = Math.max(...rows.map(([, m]) => m.cost_usd), 1e-9);
  const maxTime = Math.max(...rows.map(([, m]) => m.wall_s), 1e-9);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 15, maxWidth: "80ch" }}>The same task, the same labels and the same documents; only the model changes. Every number is measured against <strong>Opus 5.5</strong> on fresh calls with the cache off.</p>
          <div className="btn-row" style={{ marginTop: 14 }}>
            {Object.entries(TASKS).map(([k, x]) => <button key={k} className={`btn small${task === k ? " primary" : ""}`} onClick={() => setTask(k)}>{x.title} · {x.n}</button>)}
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            {Object.entries(CONDS).map(([k, x]) => <button key={k} className={`btn small${cond === k ? " primary" : ""}`} onClick={() => setCond(k)}>{x.title}</button>)}
          </div>
        </div>
        <button className="btn" onClick={start} disabled={b?.status === "running"}>{b?.status === "running" ? "Running…" : "Run fresh"}</button>
      </div>
      <p className="muted" style={{ maxWidth: "100ch", marginBottom: 24 }}>{CONDS[cond].note}</p>

      {!b && <Empty>No comparison yet for this task. Use “Run fresh”.</Empty>}
      {b?.status === "running" && <p className="muted" style={{ marginBottom: 16 }}>Running for <Elapsed from={b.started_at} />. Models fill in as they finish.</p>}
      {b?.status === "failed" && <div className="callout warn">Last run failed: {b.error}</div>}

      {opus && <>
        <div className="findings" style={{ gridTemplateColumns: `repeat(${rows.length - 1}, 1fr)` }}>
          {rows.slice(1).map(([k, m]) => { const v = m.vs_opus; return (
            <div className="finding" key={k}>
              <div className="stat-label">{m.name} vs Opus</div>
              <div className="big" style={{ fontSize: 26 }}>{v.cost_ratio ? `${v.cost_ratio >= 10 ? Math.round(v.cost_ratio) : v.cost_ratio.toFixed(1)}× cheaper` : "—"}</div>
              <p className="num" style={{ fontSize: 13 }}>
                {v.speedup ? (v.speedup >= 1 ? `${v.speedup.toFixed(1)}× faster` : `${(1 / v.speedup).toFixed(1)}× slower`) : "—"}<br />
                accuracy <span style={{ color: v.accuracy_delta < -0.001 ? "var(--clay)" : "var(--meadow)" }}>{signed(v.accuracy_delta)} pts</span><br />
                {t.danger} <span style={{ color: v.false_positive_delta > 0 ? "var(--clay)" : "var(--meadow)" }}>{m.false_positive} ({v.false_positive_delta >= 0 ? "+" : ""}{v.false_positive_delta})</span><br />
                agrees with Opus on {pct(v.agreement)}
              </p>
            </div>); })}
        </div>

        <table>
          <thead><tr>
            <th>Model</th><th>How it answers</th><th className="r">Accuracy</th><th className="r">vs Opus</th><th className="r">Dangerous</th>
            <th className="r">Cost</th><th className="r">Saved</th><th className="r">Time to finish</th><th className="r">Saved</th><th className="r">Tokens in · out</th><th className="r">Calls</th>
          </tr></thead>
          <tbody>{rows.map(([k, m], i) => { const v = m.vs_opus; return (
            <tr key={k} className={i === 0 ? "sel" : ""}>
              <td><div style={{ fontWeight: 600 }}>{m.name}</div><div className="mono faint">{m.model}</div><div className="faint">{m.provider}</div></td>
              <td className="muted" style={{ maxWidth: 240, fontSize: 12 }}>{m.answers}</td>
              <td className="r num">{pct(m.accuracy)}<div className="faint">{pct(m.accuracy_ci[0])}–{pct(m.accuracy_ci[1])}</div></td>
              <td className="r num" style={{ color: i === 0 ? undefined : v.accuracy_delta < -0.001 ? "var(--clay)" : "var(--meadow)" }}>{i === 0 ? "baseline" : `${signed(v.accuracy_delta)} pts`}</td>
              <td className="r num" style={{ color: m.false_positive ? "var(--clay)" : undefined }}>{m.false_positive} of {m.false_positive_of}</td>
              <td className="r num">{usd(m.cost_usd, 4)}</td>
              <td className="r num">{i === 0 ? "—" : v.cost_saved_pct >= 0 ? pct(v.cost_saved_pct) : `costs ${pct(-v.cost_saved_pct)} more`}</td>
              <td className="r num">{secs(m.wall_s)}</td>
              <td className="r num">{i === 0 ? "—" : v.time_saved_pct >= 0 ? pct(v.time_saved_pct) : `${pct(-v.time_saved_pct)} slower`}</td>
              <td className="r num">{Number(m.input_tokens).toLocaleString()} · {Number(m.output_tokens).toLocaleString()}</td>
              <td className="r num">{m.calls}</td>
            </tr>); })}</tbody>
        </table>

        <section className="section grid cols-3" style={{ alignItems: "start" }}>
          <Bars title="Accuracy" rows={rows} value={(m) => m.accuracy} max={1} fmt={(m) => pct(m.accuracy)} good="high" />
          <Bars title={`Cost for all ${b.results.n} items`} rows={rows} value={(m) => m.cost_usd} max={maxCost} fmt={(m) => usd(m.cost_usd, 4)} good="low" />
          <Bars title="Wall-clock time to finish" rows={rows} value={(m) => m.wall_s} max={maxTime} fmt={(m) => secs(m.wall_s)} good="low" />
        </section>

        <section className="section">
          <h2 className="section-title">Reading these numbers</h2>
          <table><tbody>
            <tr><td style={{ fontWeight: 500, width: 220 }}>Accuracy</td><td className="muted">Exact label match against the answer key; 95% interval underneath. With {b.results.n} items a few points is within noise.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Dangerous</td><td className="muted">Items the model called compliant that aren't ({t.danger}). The error that matters most in an audit.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Cost</td><td className="muted">Real token usage from each response × list price, summed from the gateway log. Snap bills input only.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Time to finish</td><td className="muted">Wall-clock from first call to last answer for the whole task, measured fresh with the cache off.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Not a drop-in swap</td><td className="muted">Snap returns a label and a paragraph choice with probabilities, but no written reason. The workflow adds a cheap explanation call only for items a reviewer reads, so a Snap route is a different pipeline shape, not just a different model name.</td></tr>
          </tbody></table>
          <p className="faint" style={{ marginTop: 8 }}>Measured {when(b.finished_at ?? b.started_at)}.
            {st && <> Settings: LLM effort <span className="mono">{st.llm_effort}</span> for every LLM (Claude docs: at least high for intelligence-sensitive work; SubQ docs: high for “most analysis”), provider prompt caching off, no fallback model, up to {st.concurrency} calls in parallel, retrieval k={st.retrieve_k}, decision model <span className="mono">{st.snap_model}</span>. Same instructions and output schema for every LLM.</>}</p>
        </section>

        <section className="section grid cols-2" style={{ alignItems: "start" }}>
          <div>
            <h2 className="section-title">How a decision model differs</h2>
            <table><tbody>
              <tr><td style={{ fontWeight: 500, width: 150 }}>LLM (Opus, Sonnet, Haiku, Savant)</td><td className="muted">Reads the documents, thinks, then generates an answer token by token: label, cited paragraph IDs, an exact quote and a reason. Time and cost grow with what it writes, thinking included.</td></tr>
              <tr><td style={{ fontWeight: 500 }}>Decision model (SubQ Snap)</td><td className="muted">Reads the documents once and scores a fixed set of allowed answers in a single forward pass, with no generation. Returns a choice, yes/no or ordinal score per question with probabilities. Up to 128 questions per call over up to 384K tokens; billed on input only. It cannot write a reason or a quote.</td></tr>
            </tbody></table>
          </div>
          <div>
            <h2 className="section-title">Where it fits in compliance work</h2>
            <table><tbody>
              <tr><td className="muted">Triage every item cheaply in one pass: met / gap / conflict, satisfied / partial / missing.</td></tr>
              <tr><td className="muted">Point to evidence: “which paragraph decides this?” as a choice over paragraph IDs plus <span className="mono">not_found</span>. The quote is then read from storage, so it can't be invented.</td></tr>
              <tr><td className="muted">Score severity on an ordered scale for each finding.</td></tr>
              <tr><td className="muted">Escalate: send the items it isn't sure of, and every non-compliant finding, to an LLM that writes the reviewer's explanation.</td></tr>
              <tr><td className="muted">Not for the final word on its own: SubQ asks users to test any thresholds they rely on, and our calibration test agrees.</td></tr>
            </tbody></table>
          </div>
        </section>
      </>}
    </>
  );
}

function Bars({ title, rows, value, max, fmt, good }: { title: string; rows: [string, any][]; value: (m: any) => number; max: number; fmt: (m: any) => string; good: "high" | "low" }) {
  return (
    <div>
      <h3 className="section-title" style={{ fontSize: 18 }}>{title}</h3>
      <p className="faint" style={{ marginBottom: 10 }}>{good === "high" ? "Longer is better" : "Shorter is better"}</p>
      {rows.map(([k, m]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr 72px", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span>{m.name}</span>
          <div className="bar" style={{ height: 14 }}><span style={{ width: `${Math.max(1, (value(m) / max) * 100)}%`, background: k.startsWith("opus") ? "var(--fg)" : "var(--muted)" }} /></div>
          <span className="num" style={{ textAlign: "right", fontSize: 12 }}>{fmt(m)}</span>
        </div>))}
    </div>
  );
}
