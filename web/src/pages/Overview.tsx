import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PLANS, post, usd, when } from "../api";
import { Badge, Elapsed, PageHead, usePoll } from "../ui";

export default function Overview() {
  const { data, reload } = usePoll<any>("/api/overview", 4000);
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <div className="page"><PageHead eyebrow="Compliance workspace" title="Regulatory changes" /></div>;
  const reg = data.regulations[0];
  const latest = (wf: string, plan: string) => data.latest_runs.find((r: any) => r.workflow === wf && r.plan === plan);
  const daysLeft = Math.ceil((+new Date(reg.due) - +new Date("2026-11-14")) / 86400000);

  async function start(workflow: string, plan: string) {
    setBusy(workflow + plan);
    try { await post("/api/runs", { workflow, plan }); reload(); } finally { setBusy(null); }
  }

  return (
    <div className="page">
      <PageHead eyebrow="Compliance workspace" title="Regulatory changes"
        lede="New state letters, the plans they reach, and where each plan's review stands. Every finding links back to the exact regulation and policy text." />

      <article className="letter">
        <div className="letter-head">
          <div>
            <div className="eyebrow">{reg.agency} · All Plan Letter</div>
            <h2 className="title" style={{ fontSize: 30 }}>APL 26-001 · {reg.title}</h2>
            <p className="lede">Supersedes {reg.supersedes}. Plans must review their P&Ps and submit updates or an attestation
              within 90 calendar days. Extracted once into <Link to="/datasets">{reg.requirements} requirements</Link>, reviewed, and shared by every plan.</p>
          </div>
          <dl className="kv">
            <dt>Issued</dt><dd className="num">{reg.issued}</dd>
            <dt>P&P deadline</dt><dd className="num">{reg.due}{daysLeft < 0 && <span className="faint"> (passed)</span>}</dd>
            <dt>Plans affected</dt><dd>{reg.affects.length}</dd>
          </dl>
        </div>
        {Object.entries(PLANS).map(([plan, name]) => (
          <div key={plan}>
            {(["regulatory_change", "audit_review"] as const).map((wf) => {
              if (wf === "audit_review" && plan !== "sunvale") return null;
              const r = latest(wf, plan);
              const s = r?.summary ?? {};
              const href = wf === "regulatory_change" ? `/gaps/${plan}` : `/audit/${plan}`;
              return (
                <div className="letter-row" key={wf}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{name}</div>
                    <div className="muted">{wf === "regulatory_change" ? "Policy gap review" : "Audit evidence review"}</div>
                  </div>
                  <div className="muted">
                    {!r && "Not run yet."}
                    {r?.status === "running" && <>Running · <Elapsed from={r.started_at} /></>}
                    {r?.status === "failed" && <span className="err">Last run failed. Open it in Runs for the error.</span>}
                    {r?.status === "done" && (
                      <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {Object.entries(s.labels ?? {}).map(([k, n]) => <Badge key={k} v={k} label={`${n} ${k}`} />)}
                        {s.needs_review > 0 && <Badge v="needs_review" label={`${s.needs_review} needs review`} />}
                        <span className="faint">· {usd(s.cost_usd)} · {when(r.finished_at)}</span>
                      </span>
                    )}
                  </div>
                  <div className="btn-row">
                    {r?.status === "done" && <button className="btn primary" onClick={() => nav(href)}>Review findings</button>}
                    <button className="btn" disabled={busy === wf + plan || r?.status === "running"} onClick={() => start(wf, plan)}>
                      {r ? "Run again" : "Run"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </article>

      <section className="section grid cols-3">
        <div className="rule-box"><div className="stat-label">Model spend, all runs</div>
          <div className="stat">{usd(Number(data.spend.cost), 2)}</div></div>
        <div className="rule-box"><div className="stat-label">Model calls</div>
          <div className="stat">{data.spend.calls}<small>{data.spend.cached} from cache</small></div></div>
        <div className="rule-box"><div className="stat-label">How findings are made</div>
          <p className="muted" style={{ marginTop: 8 }}>Workflows call the platform gateway; the <Link to="/routing">routing table</Link> picks
            the model per task, and the <Link to="/benchmarks">benchmark</Link> decides the route.</p></div>
      </section>
    </div>
  );
}
