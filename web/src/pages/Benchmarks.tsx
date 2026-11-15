import { useState } from "react";
import { ms, pct, post, usd, when } from "../api";
import { Badge, Elapsed, Empty, PageHead, usePoll } from "../ui";

const TASKS: Record<string, { title: string; pos: string; danger: string }> = {
  judge_evidence: { title: "Audit evidence", pos: "satisfied", danger: "False “satisfied”" },
  judge_gap: { title: "Policy gaps", pos: "met", danger: "False “met”" },
};

export default function Benchmarks() {
  const { data, reload } = usePoll<any[]>("/api/benchmarks", 5000);
  const [tab, setTab] = useState("judge_evidence");
  const get = (task: string, kind: string) => data?.find((b) => b.task === task && b.kind === kind);
  const cur = tab === "stress" ? get("judge_evidence", "snap_stress") : get(tab, "setups");

  async function start() {
    if (!confirm("This calls every model setup on the whole dataset (roughly $1–3 the first time; cached answers are reused). Run it?")) return;
    await post("/api/benchmarks", tab === "stress" ? { task: "judge_evidence", kind: "snap_stress" } : { task: tab });
    reload();
  }

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <PageHead eyebrow="Platform" title="Benchmarks"
        lede="Each benchmarked task's labelled dataset, run through every model setup. Cost and latency come from the gateway log. The route table should follow these results.">
        <button className="btn" onClick={start} disabled={cur?.status === "running"}>{cur?.status === "running" ? "Running…" : "Run again"}</button>
      </PageHead>
      <div className="tabs">
        {Object.entries(TASKS).map(([k, t]) => <button key={k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{t.title}</button>)}
        <button className={`tab${tab === "stress" ? " on" : ""}`} onClick={() => setTab("stress")}>SubQ Snap stress tests</button>
      </div>
      {!data && <Empty>Loading…</Empty>}
      {data && !cur && <Empty>No benchmark yet for this task. Use “Run again” to start one.</Empty>}
      {cur?.status === "running" && <p className="muted">Running for <Elapsed from={cur.started_at} />. Results fill in as each setup finishes.</p>}
      {cur?.status === "failed" && <div className="callout warn">Last run failed: {cur.error}</div>}
      {cur && tab !== "stress" && cur.results?.setups && <Setups b={cur} task={tab} />}
      {cur && tab === "stress" && cur.results && <Stress r={cur.results} />}
    </div>
  );
}

function Setups({ b, task }: { b: any; task: string }) {
  const r = b.results;
  const t = TASKS[task];
  const ORDER = ["opus_retrieve", "haiku_retrieve", "snap_per_item", "snap_batched", "savant_long", "opus_long", "cascade", "cascade_long"];
  const entries = Object.entries<any>(r.setups).sort(([a], [b2]) => ORDER.indexOf(a) - ORDER.indexOf(b2));
  const opus = r.setups.opus_retrieve;
  // Recommend only setups scored on every item with zero dangerous errors; cheapest wins a tie.
  const safe = entries.filter(([k, s]) => !k.startsWith("cascade") && s.false_positive === 0);
  const best = [...safe].sort(([, a], [, b2]) => b2.accuracy - a.accuracy || a.cost_per_item - b2.cost_per_item)[0];
  const cheapest = [...entries].filter(([k]) => !k.startsWith("cascade"))
    .filter(([, s]) => best && s.accuracy >= best[1].accuracy - 0.08 && s.cost_per_item < best[1].cost_per_item)
    .sort(([, a], [, b2]) => a.cost_per_item - b2.cost_per_item)[0];
  return (
    <>
      <p className="muted" style={{ marginBottom: 20, maxWidth: "110ch" }}>{r.n} labelled items · finished {when(b.finished_at)}.
        {best && <> Most accurate with no {t.danger.toLowerCase()} errors: <strong style={{ color: "var(--fg)" }}>{best[1].name}</strong>, {pct(best[1].accuracy)} at {usd(best[1].cost_per_item, 4)} an item
          {best[0] !== "opus_retrieve" && opus && <> (Opus with retrieval: {pct(opus.accuracy)} at {usd(opus.cost_per_item, 4)})</>}.</>}
        {cheapest && <> Within 8 points for {Math.round(best![1].cost_per_item / Math.max(cheapest[1].cost_per_item, 1e-9))}× less: {cheapest[1].name}, {pct(cheapest[1].accuracy)}
          {cheapest[1].false_positive > 0 && <>, but with {cheapest[1].false_positive} {t.danger.toLowerCase()}</>}.</>}</p>
      <table>
        <thead><tr>
          <th>Setup</th><th style={{ width: 200 }}>Accuracy · 95% CI</th>
          {task === "judge_gap" && <th className="r">Met vs not</th>}
          <th className="r">Tricky</th><th className="r">{t.danger}</th><th className="r">Needs review</th><th className="r">Cites right ¶</th>
          <th className="r">Cost</th><th className="r">Per item</th><th className="r">p50 · p95</th><th className="r">Escalated</th>
        </tr></thead>
        <tbody>{entries.map(([k, s]) => (
          <tr key={k} className={best?.[0] === k ? "best" : ""}>
            <td><div style={{ fontWeight: 500 }}>{s.name}</div><div className="mono faint">{s.shape} · {s.model}</div>
              {s.threshold != null && <div className="faint">confidence ≥ {s.threshold} · scored on held-out half</div>}</td>
            <td><div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="num" style={{ width: 36 }}>{pct(s.accuracy)}</span>
              <div className="bar" style={{ flex: 1 }}><span style={{ width: pct(s.accuracy) }} />
                <i className="ci" style={{ left: pct(s.accuracy_ci[0]), width: `${(s.accuracy_ci[1] - s.accuracy_ci[0]) * 100}%` }} /></div></div></td>
            {task === "judge_gap" && <td className="r num">{pct(s.binary_accuracy)}</td>}
            <td className="r num">{pct(s.tricky_accuracy)}</td>
            <td className="r">{s.false_positive === 0 ? <span className="num">0</span> : <Badge v="conflict" label={`${s.false_positive} of ${s.false_positive_of}`} />}</td>
            <td className="r num">{s.needs_review}</td>
            <td className="r num">{pct(s.citation_hit_rate)}</td>
            <td className="r num">{usd(s.cost_usd, 4)}</td>
            <td className="r num">{usd(s.cost_per_item, 5)}</td>
            <td className="r num">{ms(s.p50_ms)} · {ms(s.p95_ms)}</td>
            <td className="r num">{s.escalation_rate != null ? pct(s.escalation_rate) : "—"}</td>
          </tr>))}</tbody>
      </table>
      <p className="faint" style={{ marginTop: 8 }}>Latency is per item: for batched and long-context setups every item waits for the one shared call.
        The cascade's threshold is tuned on half the items and reported on the other half.</p>

      <section className="section grid cols-2" style={{ alignItems: "start" }}>
        <div><h2 className="section-title">Cost against accuracy</h2>
          <p className="section-note">Up and to the left is better. A ringed point made at least one {t.danger.toLowerCase()} error.</p>
          <Scatter setups={entries} /></div>
        <div><h2 className="section-title">Where setups disagree</h2>
          <p className="section-note">Items at least one setup got wrong. Green is right, red is wrong; the label shown is what the setup said.</p>
          <Matrix r={r} /></div>
      </section>
    </>
  );
}

function Scatter({ setups }: { setups: [string, any][] }) {
  const W = 560, H = 340, P = { l: 52, r: 24, t: 16, b: 44 };
  const xs = setups.map(([, s]) => Math.max(s.cost_per_item, 1e-6));
  const lo = Math.log10(Math.min(...xs)) - 0.3, hi = Math.log10(Math.max(...xs)) + 0.3;
  const ymin = Math.max(0, Math.min(...setups.map(([, s]) => s.accuracy)) - 0.15);
  const x = (v: number) => P.l + ((Math.log10(Math.max(v, 1e-6)) - lo) / (hi - lo)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - ((v - ymin) / (1 - ymin)) * (H - P.t - P.b);
  const ticks = []; for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) ticks.push(10 ** e);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cost per item against accuracy">
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--fg)" />
      {ticks.map((tk) => <g key={tk}><line x1={x(tk)} x2={x(tk)} y1={P.t} y2={H - P.b} stroke="var(--border)" />
        <text x={x(tk)} y={H - P.b + 16} fontSize="11" textAnchor="middle" fill="var(--muted)">{tk >= 0.01 ? `$${tk}` : `$${tk.toExponential(0)}`}</text></g>)}
      {[0.25, 0.5, 0.75, 1].filter((v) => v >= ymin).map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
        <text x={P.l - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{pct(v)}</text></g>)}
      <text x={(W + P.l) / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="var(--muted)">cost per item (log scale)</text>
      {setups.map(([k, s]) => {
        const cx = x(s.cost_per_item), cy = y(s.accuracy);
        return <g key={k}>
          {s.false_positive > 0 && <circle cx={cx} cy={cy} r={10} fill="none" stroke="var(--clay)" strokeWidth={1.5} />}
          <rect x={cx - 4} y={cy - 4} width={8} height={8} fill="var(--fg)" />
          <text x={cx + 14} y={cy + 4} fontSize="12" fill="var(--fg)">{s.name}</text>
        </g>;
      })}
    </svg>
  );
}

function Matrix({ r }: { r: any }) {
  const keys = Object.keys(r.setups).filter((k) => !k.startsWith("cascade"));
  const rows = Object.values<any>(r.items).filter((it) => keys.some((k) => it.preds[k]?.label !== it.truth));
  if (!rows.length) return <Empty>Every setup got every item right.</Empty>;
  return (
    <div style={{ maxHeight: 420, overflow: "auto", borderTop: "1px solid var(--fg)" }}>
      <table style={{ fontSize: 12 }}>
        <thead><tr><th>Item</th><th>Truth</th>{keys.map((k) => <th key={k} title={r.setups[k].name}>{r.setups[k].name.split(" · ")[0]}<br />{r.setups[k].name.split(" · ")[1]}</th>)}</tr></thead>
        <tbody>{rows.map((it) => (
          <tr key={it.plan + it.item_id}>
            <td><span className="mono">{it.item_id.replace("APL26-001-", "").replace("SUNVALE-", "")}</span>{r.task === "judge_gap" && <span className="faint"> {it.plan}</span>}
              {it.tricky && <div className="faint" style={{ maxWidth: 220 }} title={it.why_tricky}>tricky: {it.why_tricky.slice(0, 70)}{it.why_tricky.length > 70 ? "…" : ""}</div>}</td>
            <td><Badge v={it.truth} /></td>
            {keys.map((k) => { const p = it.preds[k]; const ok = p?.label === it.truth;
              return <td key={k} style={{ background: ok ? "var(--meadow-tint)" : "var(--clay-tint)", color: ok ? "var(--meadow)" : "var(--clay)" }}>{p?.label ?? "—"}</td>; })}
          </tr>))}</tbody>
      </table>
    </div>
  );
}

function Stress({ r }: { r: any }) {
  return (
    <>
      <p className="muted" style={{ marginBottom: 8 }}>Tests of how SubQ Snap behaves when used as designed: many typed questions over one large context.
        Audit evidence task, {r.n} items. {r.total_cost_usd != null && <>All four tests cost {usd(r.total_cost_usd, 3)} together.</>}</p>
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <section className="section" style={{ marginTop: 24 }}>
          <h2 className="section-title">Questions per call</h2>
          <p className="section-note">The same items over the same evidence pack, asked one at a time, ten at a time, or all at once.</p>
          {r.questions_per_call ? <table><thead><tr><th className="r">Questions / call</th><th className="r">Calls</th><th>Accuracy</th><th className="r">Input tokens</th><th className="r">Cost</th></tr></thead>
            <tbody>{r.questions_per_call.map((q: any) => <tr key={q.questions_per_call}><td className="r num">{q.questions_per_call}</td><td className="r num">{q.calls}</td>
              <td className="num">{pct(q.accuracy)} <span className="faint">({pct(q.accuracy_ci[0])}–{pct(q.accuracy_ci[1])})</span></td>
              <td className="r num">{q.input_tokens.toLocaleString()}</td><td className="r num">{usd(q.cost_usd, 4)}</td></tr>)}</tbody></table> : <Empty>Pending.</Empty>}
        </section>
        <section className="section" style={{ marginTop: 24 }}>
          <h2 className="section-title">Context depth</h2>
          <p className="section-note">The deciding evidence placed at the start, middle or end of a long state padded with both plans' policies as distractors.</p>
          {r.context_depth ? <table><thead><tr><th>Position</th><th className="r">Items</th><th>Accuracy</th><th className="r">Avg input tokens</th><th className="r">Cost</th></tr></thead>
            <tbody>{r.context_depth.map((d: any) => <tr key={d.position}><td>{d.position}</td><td className="r num">{d.n}</td>
              <td className="num">{pct(d.accuracy)} <span className="faint">({pct(d.accuracy_ci[0])}–{pct(d.accuracy_ci[1])})</span></td>
              <td className="r num">{Math.round(d.avg_input_tokens).toLocaleString()}</td><td className="r num">{usd(d.cost_usd, 4)}</td></tr>)}</tbody></table> : <Empty>Pending.</Empty>}
        </section>
        <section className="section" style={{ marginTop: 24 }}>
          <h2 className="section-title">Calibration</h2>
          <p className="section-note">Does a confidence of 0.9 mean right about 90% of the time? Points on the diagonal are well calibrated.
            {r.calibration && <> Expected calibration error: <span className="num">{r.calibration.ece.toFixed(3)}</span>.</>}</p>
          {r.calibration ? <Calib bins={r.calibration.bins} /> : <Empty>Pending.</Empty>}
        </section>
        <section className="section" style={{ marginTop: 24 }}>
          <h2 className="section-title">Option order</h2>
          <p className="section-note">The same questions with the answer options reversed. Answers should not change.</p>
          {r.option_order ? <><div className="stat">{pct(r.option_order.agreement)}<small>of answers unchanged</small></div>
            {r.option_order.changed_items.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Changed: <span className="mono">{r.option_order.changed_items.join(", ")}</span></p>}</> : <Empty>Pending.</Empty>}
        </section>
      </div>
    </>
  );
}

function Calib({ bins }: { bins: any[] }) {
  const S = 300, P = 40;
  const p = (v: number) => P + v * (S - 2 * P);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width="100%" style={{ maxWidth: 380 }} role="img" aria-label="Calibration plot">
      <rect x={P} y={P} width={S - 2 * P} height={S - 2 * P} fill="none" stroke="var(--border)" />
      <line x1={p(0)} y1={S - p(0)} x2={p(1)} y2={S - p(1)} stroke="var(--muted)" strokeDasharray="3 3" />
      {[0, 0.5, 1].map((v) => <g key={v}><text x={p(v)} y={S - P + 16} fontSize="10" textAnchor="middle" fill="var(--muted)">{v}</text>
        <text x={P - 8} y={S - p(v) + 3} fontSize="10" textAnchor="end" fill="var(--muted)">{v}</text></g>)}
      <text x={S / 2} y={S - 6} fontSize="11" textAnchor="middle" fill="var(--muted)">confidence</text>
      <text x={10} y={S / 2} fontSize="11" textAnchor="middle" fill="var(--muted)" transform={`rotate(-90 10 ${S / 2})`}>accuracy</text>
      {bins.map((b) => <g key={b.range[0]}>
        <rect x={p(b.mean_confidence) - 4} y={S - p(b.accuracy) - 4} width={8} height={8} fill="var(--fg)" />
        <text x={p(b.mean_confidence) - 8} y={S - p(b.accuracy) - 8} fontSize="10" textAnchor="end" fill="var(--muted)">n={b.n}</text></g>)}
    </svg>
  );
}
