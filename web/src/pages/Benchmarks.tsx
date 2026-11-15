import { useState } from "react";
import { ms, pct, post, usd, when } from "../api";
import { Badge, Elapsed, Empty, PageHead, usePoll } from "../ui";
import { Compare } from "./Compare";

const TASKS: Record<string, { title: string; pos: string; danger: string }> = {
  judge_evidence: { title: "Audit evidence", pos: "satisfied", danger: "False “satisfied”" },
  judge_gap: { title: "Policy gaps", pos: "met", danger: "False “met”" },
};

const SETUP_INFO: Record<string, { sees: "retrieve" | "batched" | "all" | "cascade"; how: string; provider: string }> = {
  opus_retrieve: { sees: "retrieve", provider: "Neon AI Gateway", how: "Retrieve the top 5 (gaps) or 3 (evidence) paragraphs per item, then one Opus call per item. The usual RAG baseline." },
  haiku_retrieve: { sees: "retrieve", provider: "Neon AI Gateway", how: "Same prompt and retrieval, cheapest Claude model." },
  snap_per_item: { sees: "retrieve", provider: "SubQ", how: "Decision model given the same retrieved passages, one item per call. Not how Snap is meant to run; a control." },
  snap_batched: { sees: "batched", provider: "SubQ", how: "Snap as designed: the whole document set as context, every item as a typed question, plus a 'which paragraph' question per item, in one call." },
  savant_long: { sees: "all", provider: "SubQ", how: "Long-context LLM reads the plan's entire document set and answers every item in one call." },
  opus_long: { sees: "all", provider: "Neon AI Gateway", how: "Opus reads the entire document set and answers every item in one call." },
  cascade: { sees: "cascade", provider: "both", how: "Snap batched first; items Snap is unsure of, or not marked positive, go to Opus with retrieval." },
  cascade_long: { sees: "cascade", provider: "both", how: "Snap batched first; escalations go to Opus reading the whole document set." },
};

function Sees({ kind }: { kind: string }) {
  const n = 22;
  return <div className="sees" aria-hidden>{Array.from({ length: n }).map((_, i) =>
    <i key={i} className={kind === "all" || kind === "batched" ? "on" : kind === "retrieve" ? ([3, 9, 14].includes(i) ? "on" : "") : i < 11 ? "on" : ([15, 19].includes(i) ? "on" : "")} />)}
    {kind === "batched" && <><i className="q" /><i className="q" /><i className="q" /></>}</div>;
}

export default function Benchmarks() {
  const { data, reload } = usePoll<any[]>("/api/benchmarks", 5000);
  const { data: ds } = usePoll<any>("/api/datasets");
  const [tab, setTab] = useState("models");
  const get = (task: string, kind: string) => data?.find((b) => b.task === task && b.kind === kind);
  const cur = tab === "stress" ? get("judge_evidence", "snap_stress") : TASKS[tab] ? get(tab, "setups") : null;

  async function start() {
    if (!confirm("This calls every model setup on the whole dataset (roughly $1–3 the first time; cached answers are reused). Run it?")) return;
    await post("/api/benchmarks", tab === "stress" ? { task: "judge_evidence", kind: "snap_stress" } : { task: tab });
    reload();
  }
  const tabs: [string, string][] = [["models", "Model comparison"], ["summary", "Summary & method"], ["judge_gap", "Policy gaps"], ["judge_evidence", "Audit evidence"], ["stress", "Decision-model stress"], ["decision", "Routing decision"]];

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <PageHead eyebrow="Platform" title="Evals"
        lede="Every benchmarked task has a labelled dataset. Each model setup runs it through the same judge piece the workflows use; only the route changes. Cost and latency are read from the gateway log. The routing table follows these results.">
        {(TASKS[tab] || tab === "stress") && <button className="btn" onClick={start} disabled={cur?.status === "running"}>{cur?.status === "running" ? "Running…" : "Run again"}</button>}
      </PageHead>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {!data && <Empty>Loading…</Empty>}
      {data && tab === "models" && <Compare data={data} reload={reload} />}
      {data && tab === "summary" && <Summary gap={get("judge_gap", "setups")} ev={get("judge_evidence", "setups")} stress={get("judge_evidence", "snap_stress")} ds={ds} />}
      {data && tab === "decision" && <Decision gap={get("judge_gap", "setups")} ev={get("judge_evidence", "setups")} />}
      {data && (TASKS[tab] || tab === "stress") && !cur && <Empty>No eval yet for this task. Use “Run again” to start one.</Empty>}
      {cur?.status === "running" && <p className="muted">Running for <Elapsed from={cur.started_at} />. Results fill in as each setup finishes.</p>}
      {cur?.status === "failed" && <div className="callout warn">Last run failed: {cur.error}</div>}
      {cur && TASKS[tab] && cur.results?.setups && <Setups b={cur} task={tab} ds={ds} />}
      {cur && tab === "stress" && cur.results && <Stress r={cur.results} />}
    </div>
  );
}

function Summary({ gap, ev, stress, ds }: { gap: any; ev: any; stress: any; ds: any }) {
  const g = gap?.results?.setups ?? {}, e = ev?.results?.setups ?? {}, s = stress?.results;
  const ratio = (a?: any, b?: any) => (a && b ? Math.round(a.cost_usd / Math.max(b.cost_usd, 1e-9)) : 0);
  const q = s?.questions_per_call;
  const planted = (ds?.judge_gap ?? []).filter((r: any) => r.truth !== "met");
  const dist = (rows: any[], labels: string[], tones: string[]) => (
    <div className="dist">{labels.map((l, i) => { const n = rows.filter((r) => r.truth === l).length;
      return n ? <span key={l} style={{ flex: n, background: `var(--${tones[i]}-tint)`, color: `var(--${tones[i]})` }}>{n} {l}</span> : null; })}</div>);
  return (
    <>
      <div className="findings">
        {g.savant_long && g.opus_retrieve && <div className="finding">
          <div className="stat-label">Policy gaps</div>
          <div className="big">{pct(g.savant_long.accuracy)} vs {pct(g.opus_retrieve.accuracy)}</div>
          <p>Reading the whole policy set (Savant) beat retrieve-then-judge (Opus), with <strong>0</strong> false “met” against <strong>{g.opus_retrieve.false_positive}</strong>, at 1/{ratio(g.opus_retrieve, g.savant_long)} of the cost. Retrieval never showed the model both sides of a cross-policy conflict.</p></div>}
        {e.opus_long && e.savant_long && <div className="finding">
          <div className="stat-label">Audit evidence</div>
          <div className="big">{pct(e.opus_long.accuracy)} · 0 false</div>
          <p>Opus reading the whole evidence pack was the only setup with no false “satisfied”. Savant was {ratio(e.opus_long, e.savant_long)}× cheaper at {pct(e.savant_long.accuracy)}, but with {e.savant_long.false_positive} false “satisfied”. Safety wins this route.</p></div>}
        {e.snap_batched && e.snap_per_item && <div className="finding">
          <div className="stat-label">Decision model, used as designed</div>
          <div className="big">{pct(e.snap_per_item.accuracy)} → {pct(e.snap_batched.accuracy)}</div>
          <p>Snap one-item-per-call vs all items over the whole pack in one call.{q && <> Batching all questions was {Math.round(q[0].cost_usd / q[q.length - 1].cost_usd)}× cheaper than one call per question at the same accuracy.</>} Its confidence isn't reliable enough to skip review alone.</p></div>}
      </div>

      <section className="section" style={{ marginTop: 16 }}>
        <h2 className="section-title">What's being measured</h2>
        <p className="section-note">Two compliance tasks, each with an answer key. Problems were planted in fictional policies and evidence on purpose, including ones designed to beat retrieval.</p>
        <div className="grid cols-2">
          <div className="rule-box"><div className="stat-label">Policy gaps · judge_gap</div>
            <p style={{ margin: "6px 0 10px" }}>Does this plan's policy set meet requirement R? <span className="mono">met · gap · conflict</span>. 16 requirements × 2 plans.</p>
            {ds && dist(ds.judge_gap, ["met", "gap", "conflict"], ["meadow", "amber", "clay"])}</div>
          <div className="rule-box"><div className="stat-label">Audit evidence · judge_evidence</div>
            <p style={{ margin: "6px 0 10px" }}>Does the evidence satisfy audit item A? <span className="mono">satisfied · partial · missing</span>. 42 items, Sunvale.</p>
            {ds && dist(ds.judge_evidence, ["satisfied", "partial", "missing"], ["meadow", "amber", "clay"])}</div>
        </div>
        {planted.length > 0 && <>
          <h3 className="section-title" style={{ marginTop: 32, fontSize: 18 }}>Planted policy problems</h3>
          <table><thead><tr><th>Plan</th><th>Req</th><th>Truth</th><th>What was planted</th></tr></thead>
            <tbody>{planted.map((r: any) => <tr key={r.plan + r.item_id}><td>{r.plan}</td><td className="mono">{r.item_id.replace("APL26-001-", "")}</td><td><Badge v={r.truth} /></td><td className="muted">{r.planted || r.why_tricky}</td></tr>)}</tbody></table>
        </>}
      </section>

      <section className="section">
        <h2 className="section-title">Setups compared</h2>
        <p className="section-note">The bars show what the model sees: dark is a document paragraph in view, green is a typed question.</p>
        <div className="setup-cards">{Object.entries(SETUP_INFO).map(([k, info]) => {
          const name = g[k]?.name ?? e[k]?.name ?? k;
          return <div className="setup-card" key={k}>
            <div style={{ fontWeight: 600 }}>{name}</div><div className="faint">{info.provider}</div>
            <Sees kind={info.sees} />
            <p className="muted">{info.how}</p></div>; })}</div>
      </section>

      <section className="section grid cols-2" style={{ alignItems: "start" }}>
        <div><h2 className="section-title">Metrics</h2>
          <table><tbody>
            <tr><td style={{ fontWeight: 500 }}>Accuracy</td><td className="muted">Exact label match, with a 95% Wilson confidence interval.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Dangerous error</td><td className="muted">False “met” or false “satisfied”: a gap the auditor finds and we didn't. Reported on its own.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Tricky accuracy</td><td className="muted">Accuracy on items labelled tricky (cross-document conflicts, wrong period, too-small sample…).</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Cites right ¶</td><td className="muted">Share of cited verdicts whose paragraph is one the label names.</td></tr>
            <tr><td style={{ fontWeight: 500 }}>Cost, latency</td><td className="muted">From the gateway log: real token usage × price; p50/p95 per item.</td></tr>
          </tbody></table></div>
        <div><h2 className="section-title">Protocol</h2>
          <table><tbody>
            <tr><td className="muted">Every setup gets the same items, instructions and labels, through the same judge piece.</td></tr>
            <tr><td className="muted">Cascade thresholds are tuned on one half of the items and reported on the other half.</td></tr>
            <tr><td className="muted">Reruns are served from the gateway cache; cost and latency always reflect the original call.</td></tr>
            <tr><td className="muted">Small, author-planted datasets: intervals are wide, so read differences of a few points as noise.</td></tr>
          </tbody></table></div>
      </section>
    </>
  );
}

function Decision({ gap, ev }: { gap: any; ev: any }) {
  const { data: rt } = usePoll<any>("/api/routes");
  const g = gap?.results?.setups ?? {}, e = ev?.results?.setups ?? {};
  const row = (task: string, chosen: any, base: any, why: string) => (
    <tr key={task}><td className="mono">{task}</td><td style={{ fontWeight: 500 }}>{chosen?.name}</td>
      <td className="num">{pct(chosen?.accuracy)} · {chosen?.false_positive} dangerous · {usd(chosen?.cost_usd, 4)}</td>
      <td className="num muted">{base?.name}: {pct(base?.accuracy)} · {base?.false_positive} · {usd(base?.cost_usd, 4)}</td><td className="muted">{why}</td></tr>);
  return (
    <>
      <p className="section-note" style={{ marginTop: 0 }}>The routing table started with every judging task on Opus with retrieval. After the evals, two rows changed. No workflow code changed.</p>
      <table><thead><tr><th>Task</th><th>Route now</th><th>Its result</th><th>Starting route</th><th>Why</th></tr></thead>
        <tbody>
          {row("judge_gap", g.savant_long, g.opus_retrieve, "Same accuracy as Opus reading everything, zero false “met”, about 1/24 of its cost. Retrieval missed cross-policy conflicts.")}
          {row("judge_evidence", e.opus_long, e.opus_retrieve, "Only setup with zero false “satisfied”. Cheaper options made dangerous errors.")}
        </tbody></table>
      <p className="muted" style={{ marginTop: 12 }}>Unchanged: <span className="mono">extract_requirements</span> (Opus, run once and reviewed), <span className="mono">explain_evidence</span> (Haiku), <span className="mono">rate_severity</span> (Snap score question).</p>
      {rt && <section className="section"><h2 className="section-title">Route history</h2>
        <table><tbody>{rt.history.map((h: any, i: number) => <tr key={i}><td className="num muted">{when(h.changed_at)}</td><td className="mono">{h.task}</td><td>{h.route.name ?? h.route.model}</td></tr>)}</tbody></table></section>}
    </>
  );
}

function Setups({ b, task, ds }: { b: any; task: string; ds: any }) {
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
          <Scatter setups={entries.filter(([k]) => !k.startsWith("cascade"))} /></div>
        <div><h2 className="section-title">Confusion</h2>
          <p className="section-note">Truth → what the setup said, for the two strongest setups and the starting route.</p>
          {["opus_retrieve", task === "judge_gap" ? "savant_long" : "opus_long", "snap_batched"].filter((k) => r.setups[k]).map((k) => (
            <div key={k} style={{ marginBottom: 14 }}><div style={{ fontWeight: 500 }}>{r.setups[k].name}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{Object.entries<number>(r.setups[k].confusion).sort().map(([c, n]) =>
                <span key={c} style={{ marginRight: 12, color: c.split("→")[0] === c.split("→")[1] ? "var(--meadow)" : "var(--clay)" }}>{c} {n}</span>)}</div></div>))}
        </div>
      </section>
      <section className="section">
        <h2 className="section-title">Item by item</h2>
        <p className="section-note">Every item at least one setup got wrong. Green is right, red is wrong. Select a row to see the question, why it's tricky, and each setup's citations.</p>
        <Matrix r={r} ds={ds} task={task} />
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

function Matrix({ r, ds, task }: { r: any; ds: any; task: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const keys = ["opus_retrieve", "haiku_retrieve", "snap_per_item", "snap_batched", "savant_long", "opus_long"].filter((k) => r.setups[k]);
  const rows = Object.values<any>(r.items).filter((it) => keys.some((k) => it.preds[k]?.label !== it.truth));
  const meta: Record<string, any> = Object.fromEntries((ds?.[task] ?? []).map((d: any) => [`${d.plan}|${d.item_id}`, d]));
  if (!rows.length) return <Empty>Every setup got every item right.</Empty>;
  return (
    <div style={{ borderTop: "1px solid var(--fg)" }}>
      <table style={{ fontSize: 12 }}>
        <thead><tr><th>Item</th><th>Truth</th>{keys.map((k) => <th key={k} title={r.setups[k].name}>{r.setups[k].name.split(" · ")[0]}<br />{r.setups[k].name.split(" · ")[1]}</th>)}</tr></thead>
        <tbody>{rows.map((it) => {
          const key = `${it.plan}|${it.item_id}`, m = meta[key];
          return [
            <tr key={key} className={`click${open === key ? " sel" : ""}`} onClick={() => setOpen(open === key ? null : key)}>
              <td><span className="mono">{it.item_id.replace("APL26-001-", "").replace("SUNVALE-", "")}</span>{task === "judge_gap" && <span className="faint"> {it.plan}</span>}
                {it.tricky && <span className="faint"> · tricky</span>}</td>
              <td><Badge v={it.truth} /></td>
              {keys.map((k) => { const p = it.preds[k]; const ok = p?.label === it.truth;
                return <td key={k} style={{ background: ok ? "var(--meadow-tint)" : "var(--clay-tint)", color: ok ? "var(--meadow)" : "var(--clay)" }}>{p?.label ?? "—"}</td>; })}
            </tr>,
            open === key && <tr key={key + "-d"}><td colSpan={keys.length + 2} style={{ background: "var(--surface)", padding: 20 }}>
              <div className="grid cols-2" style={{ gap: 24 }}>
                <div>
                  <div className="stat-label">Question</div><p style={{ marginTop: 4, whiteSpace: "pre-line" }}>{m?.question}</p>
                  {(m?.planted || it.why_tricky) && <><div className="stat-label" style={{ marginTop: 12 }}>{m?.planted ? "Planted" : "Why it's tricky"}</div>
                    <p style={{ marginTop: 4 }}>{m?.planted || it.why_tricky}</p></>}
                  {m?.planted && it.why_tricky && <p className="muted" style={{ marginTop: 6 }}>Tricky because: {it.why_tricky}</p>}
                  <div className="stat-label" style={{ marginTop: 12 }}>Label's paragraphs</div>
                  <p className="mono" style={{ marginTop: 4 }}>{it.label_paragraphs.join("  ") || "none: nothing addresses it"}</p>
                </div>
                <table style={{ fontSize: 12, background: "var(--bg)" }}><thead><tr><th>Setup</th><th>Said</th><th>Cited</th><th>Check</th></tr></thead>
                  <tbody>{keys.map((k) => { const p = it.preds[k]; const hit = (p?.paragraph_ids ?? []).filter((x: string) => it.label_paragraphs.includes(x));
                    return <tr key={k}><td>{r.setups[k].name}</td><td><Badge v={p?.label} />{p?.confidence != null && <span className="faint num"> {p.confidence.toFixed(2)}</span>}</td>
                      <td className="mono">{(p?.paragraph_ids ?? []).map((x: string) => <span key={x} style={{ display: "block", color: hit.includes(x) ? "var(--meadow)" : undefined }}>{x}</span>)}</td>
                      <td>{p?.citation === "verified" ? <span className="faint">verified</span> : <Badge v="needs_review" label="review" />}</td></tr>; })}</tbody></table>
              </div>
            </td></tr>,
          ];
        })}</tbody>
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
