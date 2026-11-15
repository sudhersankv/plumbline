import { Link, useNavigate, useParams } from "react-router-dom";
import { dur, ms, PLANS, usd, when, WORKFLOWS } from "../api";
import { Badge, Elapsed, Empty, PageHead, usePoll } from "../ui";

export default function Runs() {
  const { data } = usePoll<any[]>("/api/runs", 3000);
  const nav = useNavigate();
  return (
    <div className="page">
      <PageHead eyebrow="Platform" title="Runs"
        lede="Every workflow run, its verdicts, and the model calls behind it. Cost counts only calls that were not served from the gateway cache." />
      {data && data.length === 0 && <Empty>No runs yet. Start one from Regulatory changes.</Empty>}
      {data && data.length > 0 && <table>
        <thead><tr><th>Started</th><th>Workflow</th><th>Plan</th><th>Status</th><th>Findings</th><th className="r">Calls</th><th className="r">Cost</th><th className="r">Time</th></tr></thead>
        <tbody>{data.map((r) => (
          <tr key={r.id} className="click" onClick={() => nav(`/runs/${r.id}`)}>
            <td className="num">{when(r.started_at)}</td>
            <td>{WORKFLOWS[r.workflow] ?? r.workflow}</td>
            <td>{PLANS[r.plan] ?? r.plan}</td>
            <td><Badge v={r.status} /></td>
            <td className="muted">{Object.entries(r.summary?.labels ?? {}).map(([k, n]) => `${n} ${k}`).join(" · ")}
              {r.summary?.needs_review ? ` · ${r.summary.needs_review} review` : ""}</td>
            <td className="r num">{r.summary?.calls ?? "—"}</td>
            <td className="r num">{usd(r.summary?.cost_usd)}</td>
            <td className="r num">{r.status === "running" ? <Elapsed from={r.started_at} /> : dur(r.started_at, r.finished_at)}</td>
          </tr>))}</tbody>
      </table>}
    </div>
  );
}

export function RunDetail() {
  const { id } = useParams();
  const { data: r } = usePoll<any>(`/api/runs/${id}`, 3000);
  if (!r) return <div className="page"><PageHead eyebrow="Run" title="Loading…" /></div>;
  const s = r.summary ?? {};
  const byModel: Record<string, { calls: number; cost: number; tin: number; tout: number; cached: number }> = {};
  for (const c of r.calls) {
    const k = `${c.kind} · ${c.model}`;
    byModel[k] ??= { calls: 0, cost: 0, tin: 0, tout: 0, cached: 0 };
    byModel[k].calls++; byModel[k].tin += c.input_tokens; byModel[k].tout += c.output_tokens;
    if (c.cached) byModel[k].cached++; else byModel[k].cost += c.cost_usd;
  }
  const review = r.workflow === "regulatory_change" ? `/gaps/${r.plan}` : `/audit/${r.plan}`;
  return (
    <div className="page">
      <PageHead eyebrow={`Run · ${when(r.started_at)}`} title={`${WORKFLOWS[r.workflow]} · ${PLANS[r.plan]}`}
        lede={<span className="mono">{r.id}</span>}>
        <Link className="btn primary" to={review}>Open review</Link>
      </PageHead>
      {r.error && <div className="callout warn"><div className="stat-label">Error</div><pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.error}</pre></div>}
      <div className="grid cols-4">
        <div className="rule-box"><div className="stat-label">Status</div><div style={{ marginTop: 12 }}><Badge v={r.status} /></div></div>
        <div className="rule-box"><div className="stat-label">Items judged</div><div className="stat">{s.items ?? 0}<small>{s.needs_review ?? 0} need review</small></div></div>
        <div className="rule-box"><div className="stat-label">Model calls</div><div className="stat">{s.calls ?? 0}<small>{s.cached_calls ?? 0} cached · {s.fallbacks ?? 0} fallback</small></div></div>
        <div className="rule-box"><div className="stat-label">Cost · time</div><div className="stat">{usd(s.cost_usd)}<small>{r.status === "running" ? <Elapsed from={r.started_at} /> : dur(r.started_at, r.finished_at)}</small></div></div>
      </div>

      <section className="section">
        <h2 className="section-title">Cost by model</h2>
        <table><thead><tr><th>Call</th><th className="r">Calls</th><th className="r">Cached</th><th className="r">Input tokens</th><th className="r">Output tokens</th><th className="r">Cost</th></tr></thead>
          <tbody>{Object.entries(byModel).map(([k, m]) => (
            <tr key={k}><td className="mono">{k}</td><td className="r num">{m.calls}</td><td className="r num">{m.cached}</td>
              <td className="r num">{m.tin.toLocaleString()}</td><td className="r num">{m.tout.toLocaleString()}</td><td className="r num">{usd(m.cost, 4)}</td></tr>))}
          </tbody></table>
      </section>

      <section className="section">
        <h2 className="section-title">Model calls</h2>
        <p className="section-note">Every call went through the gateway: routed by task, retried, cached, and logged here.</p>
        <table><thead><tr><th>#</th><th>Task</th><th>Kind</th><th>Model</th><th className="r">In</th><th className="r">Out</th><th className="r">Latency</th><th className="r">Cost</th><th>Notes</th></tr></thead>
          <tbody>{r.calls.map((c: any) => (
            <tr key={c.id}><td className="num faint">{c.id}</td><td className="mono">{c.task}</td><td>{c.kind}</td><td className="mono">{c.model}</td>
              <td className="r num">{c.input_tokens.toLocaleString()}</td><td className="r num">{c.output_tokens.toLocaleString()}</td>
              <td className="r num">{c.cached ? "cache" : ms(c.latency_ms)}</td><td className="r num">{c.cached ? "$0" : usd(c.cost_usd, 4)}</td>
              <td className="muted">{c.fallback_from && `fell back from ${c.fallback_from}`}{c.attempts > 1 && ` ${c.attempts} attempts`}{c.error && <span className="err">{c.error}</span>}</td></tr>))}
          </tbody></table>
      </section>
    </div>
  );
}
