import { useState } from "react";
import { Link } from "react-router-dom";
import { post, usd, when } from "../api";
import { CodeView } from "../code";
import { WORKFLOW_STEPS } from "../platform";
import { Badge, PageHead, usePoll } from "../ui";

function routeLabel(r: any): string {
  if (!r) return "—";
  const shape = r.shape === "long_context" ? "whole corpus, one call" : r.shape === "batched" ? "batched questions" : r.shape === "per_item" ? `retrieve ${r.k ?? ""} per item` : "";
  return [r.model, shape].filter(Boolean).join(" · ");
}

export default function Workflows() {
  const { data: p } = usePoll<any>("/api/platform");
  const { data: runs, reload } = usePoll<any[]>("/api/runs", 4000);
  const [code, setCode] = useState<Record<string, boolean>>({});
  if (!p) return <div className="page"><PageHead eyebrow="Platform" title="Workflows" /></div>;
  const routes: Record<string, any> = Object.fromEntries(p.routes.map((r: any) => [r.task, r.route]));

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <PageHead eyebrow="Platform" title="Workflows"
        lede="Each workflow is a short function that only calls platform pieces. Neither names a model: the gateway's routing table does. A third workflow would be a new function, a task name in the routing table, and a labelled dataset." />

      <div className="wf-grid">
        {Object.entries(WORKFLOW_STEPS).map(([id, wf]) => {
          const mine = (runs ?? []).filter((r) => r.workflow === id).slice(0, 4);
          const plans = id === "audit_review" ? ["sunvale"] : ["sunvale", "bayline"];
          return (
            <section key={id}>
              <div className="eyebrow mono">{id}()</div>
              <h2 className="title" style={{ fontSize: 30 }}>{wf.title}</h2>
              <p style={{ fontSize: 15, marginTop: 8 }}>“{wf.question}”</p>
              <p className="muted" style={{ marginTop: 4 }}>{wf.output}</p>

              <div className="steps" style={{ marginTop: 20 }}>{wf.steps.map((s) => (
                <div className="step" key={s.title}>
                  <div><div style={{ fontWeight: 500 }}>{s.title}</div><div className="muted">{s.detail}</div>
                    {s.task && <div className="faint" style={{ marginTop: 4 }}>task <span className="mono">{s.task}</span> → <span className="mono">{routeLabel(routes[s.task])}</span></div>}</div>
                  <span className="pill" style={{ cursor: "default" }}>{s.piece}</span>
                </div>))}</div>

              <div className="btn-row" style={{ margin: "16px 0" }}>
                <button className="btn quiet" onClick={() => setCode({ ...code, [id]: !code[id] })}>{code[id] ? "Hide code" : "Show the code"}</button>
              </div>
              {code[id] && <CodeView code={p.sources[id]} file="plumbline/workflows.py" />}

              <h3 className="section-title" style={{ marginTop: 24 }}>Runs</h3>
              <table><tbody>
                {mine.map((r) => <tr key={r.id}><td className="num muted">{when(r.started_at)}</td><td>{r.plan}</td><td><Badge v={r.status} /></td>
                  <td className="muted">{Object.entries(r.summary?.labels ?? {}).map(([k, n]) => `${n} ${k}`).join(" · ")}</td>
                  <td className="r num">{usd(r.summary?.cost_usd, 4)}</td><td className="r"><Link to={`/runs/${r.id}`}>Record</Link></td></tr>)}
              </tbody></table>
              <div className="btn-row" style={{ marginTop: 12 }}>
                {plans.map((pl) => <button key={pl} className="btn" onClick={async () => { await post("/api/runs", { workflow: id, plan: pl }); reload(); }}>Run on {pl}</button>)}
                <Link className="btn primary" to={wf.review}>See findings</Link>
              </div>
            </section>);
        })}
      </div>

      <section className="section">
        <h2 className="section-title">How it's tested</h2>
        <p className="section-note">Four layers, from fast and free to slow and paid. The eval harness calls the same <span className="mono">judge</span> piece the workflows call, with a different route per setup, so what's measured is what ships.</p>
        <div className="grid cols-4" style={{ alignItems: "start" }}>
          <div className="rule-box"><div className="stat-label">1 · Unit tests</div><div className="stat">{p.tests.length}<small>offline</small></div>
            <p className="muted" style={{ marginTop: 8 }}>Paragraph IDs, every citation rule, requirement quotes against the regulation, schema and cost helpers.</p></div>
          <div className="rule-box"><div className="stat-label">2 · Data validation</div><div className="stat">{p.counts.gap_labels + p.counts.evidence_labels}<small>labels checked</small></div>
            <p className="muted" style={{ marginTop: 8 }}>Every label points at a paragraph that exists; conflicts cite both sides; every requirement covered.</p></div>
          <div className="rule-box"><div className="stat-label">3 · Live runs</div><div className="stat">{p.counts.runs}<small>runs</small></div>
            <p className="muted" style={{ marginTop: 8 }}>Both workflows on real models, every call logged; findings reviewed in the workspace.</p></div>
          <div className="rule-box"><div className="stat-label">4 · Evals</div><div className="stat">8<small>setups</small></div>
            <p className="muted" style={{ marginTop: 8 }}>Labelled items through every model setup; accuracy, dangerous errors, cost, latency. <Link to="/evals">Open evals →</Link></p></div>
        </div>
        <table style={{ marginTop: 24 }}>
          <thead><tr><th>Unit test</th><th>File</th></tr></thead>
          <tbody>{p.tests.map((t: any) => <tr key={t.name}><td>{t.readable}</td><td className="mono faint">tests/test_platform.py::{t.name}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
