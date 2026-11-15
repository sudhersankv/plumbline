import { useState } from "react";
import { Link } from "react-router-dom";
import { ms, pct, usd, when } from "../api";
import { CodeView } from "../code";
import { MODEL_INFO, NODES, NodeDef, WORKFLOW_STEPS } from "../platform";
import { usePoll } from "../ui";

function routeLabel(r: any): string {
  if (!r) return "—";
  if (r.shape === "cascade") return `cascade → ${r.then?.model}`;
  const shape = r.shape === "long_context" ? "whole corpus" : r.shape === "batched" ? "batched" : r.shape === "per_item" ? `retrieve ${r.k ?? ""}` : "";
  return [r.model, shape].filter(Boolean).join(" · ");
}

export default function Platform() {
  const { data: p } = usePoll<any>("/api/platform");
  const [open, setOpen] = useState<string | null>(null);
  if (!p) return <div className="page"><div className="eyebrow">AI platform</div><h1 className="title">Plumbline</h1></div>;

  const routes: Record<string, any> = Object.fromEntries(p.routes.map((r: any) => [r.task, r.route]));
  const layers = ["Apps", "API", "Workflows", "Platform pieces", "Gateway"];
  const node = (n: NodeDef) => (
    <button key={n.id} className={`node${open === n.id ? " on" : ""}`} onClick={() => setOpen(n.id)}>
      <span className="n-title">{n.title}</span><span className="n-sub">{n.sub}</span>
      {n.file && <span className="n-meta">{n.file.replace("plumbline/", "")}</span>}
    </button>
  );
  const s = p.stats;
  const tests = p.tests.length;

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="eyebrow">AI platform</div>
      <h1 className="title" style={{ fontSize: 43 }}>Plumbline</h1>
      <p className="lede" style={{ fontSize: 15, maxWidth: "78ch", marginBottom: 28 }}>
        The shared layer AI features ship on: one model gateway, retrieval, verified citations, run records and evals.
        Routing is decided by measurement. The compliance workspace is the first app built on it. Select any component.
      </p>

      <div className="strip">
        <div><div className="stat-label">Model calls</div><div className="v">{Number(s.calls).toLocaleString()}</div><div className="s">{pct(s.cached / s.calls)} served from cache</div></div>
        <div><div className="stat-label">Model spend</div><div className="v">{usd(Number(s.spend), 2)}</div><div className="s">all runs and evals</div></div>
        <div><div className="stat-label">Providers</div><div className="v">2</div><div className="s">Neon AI Gateway · SubQ</div></div>
        <div><div className="stat-label">Workflows</div><div className="v">2</div><div className="s">{p.counts.runs} runs recorded</div></div>
        <div><div className="stat-label">Eval sets</div><div className="v">{p.counts.gap_labels + p.counts.evidence_labels}</div><div className="s">labelled items · {p.counts.benchmarks} eval runs</div></div>
        <div><div className="stat-label">Unit tests</div><div className="v">{tests}</div><div className="s">offline, no model calls</div></div>
      </div>

      <div className="arch">
        <div className="arch-stack">
          {layers.map((L) => (
            <div className="layer" key={L}>
              <div className="layer-name">{L}</div>
              <div className="layer-row">
                {L !== "Gateway" && NODES.filter((n) => n.layer === L).map(node)}
                {L === "Gateway" && (
                  <button className={`node${open === "gateway" ? " on" : ""}`} style={{ flexBasis: "100%" }} onClick={() => setOpen("gateway")}>
                    <span className="n-title">Model gateway</span>
                    <span className="n-sub">The only door to models: routing by task, retries, fallback, cache, cost and latency logged per call</span>
                    <span className="gw-routes">{p.routes.map((r: any) => <><span className="mono" key={r.task}>{r.task}</span><span key={r.task + "v"}>{routeLabel(r.route)}</span></>)}</span>
                  </button>)}
              </div>
            </div>
          ))}
          <div className="layer">
            <div className="layer-name">Models</div>
            <div className="layer-row">
              {[["Neon AI Gateway", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "qwen3-embedding-0-6b"]],
                ["SubQ", ["subq-snap-1.2", "subq-savant-1.4"]]].map(([prov, ms_]) => (
                <div key={prov as string} className="node group" style={{ flexBasis: prov === "SubQ" ? "30%" : "60%", flexGrow: prov === "SubQ" ? 1 : 2 }}>
                  <span className="n-title">{prov as string}</span>
                  <div className="inner">{(ms_ as string[]).map((m) => (
                    <button key={m} className={`node${open === m ? " on" : ""}`} onClick={() => setOpen(m)}>
                      <span className="n-title mono" style={{ fontSize: 12 }}>{m}</span><span className="n-sub">{MODEL_INFO[m].role}</span>
                    </button>))}</div>
                </div>))}
            </div>
          </div>
        </div>
        <div style={{ paddingTop: 0 }}>
          <button className={`node side-node${open === "postgres" ? " on" : ""}`} onClick={() => setOpen("postgres")} style={{ width: "100%" }}>
            <span className="n-title">Neon Postgres</span>
            <span className="n-sub">Paragraphs + pgvector embeddings, runs, verdicts, model calls, gateway cache, routing table, eval results, reviewer labels</span>
            <span className="n-meta">db.py</span>
          </button>
        </div>
      </div>

      {open && <Drawer id={open} p={p} routes={routes} go={setOpen} close={() => setOpen(null)} />}
    </div>
  );
}

function Drawer({ id, p, routes, go, close }: { id: string; p: any; routes: Record<string, any>; go: (id: string) => void; close: () => void }) {
  const [tab, setTab] = useState("overview");
  const n = NODES.find((x) => x.id === id);
  const piece = p.pieces.find((x: any) => x.id === id);
  const model = MODEL_INFO[id];
  const wf = WORKFLOW_STEPS[id];
  const file = n?.file;
  const hasSource = !!file || !!wf;

  return (
    <>
      <div className="drawer-wrap" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={n?.title ?? id}>
        <button className="btn small close" onClick={close}>Close</button>
        <div className="eyebrow">{model ? model.provider : n?.layer === "side" ? "Storage" : n?.layer}</div>
        <h2 className="title" style={{ fontSize: 30 }}>{n?.title ?? id}</h2>
        {piece && <p className="muted" style={{ marginTop: 4 }}>{piece.kind}</p>}
        {hasSource && <div className="tabs" style={{ marginTop: 16 }}>
          <button className={`tab${tab === "overview" ? " on" : ""}`} onClick={() => setTab("overview")}>Overview</button>
          <button className={`tab${tab === "source" ? " on" : ""}`} onClick={() => setTab("source")}>Source</button>
        </div>}
        {!hasSource && <div style={{ height: 16 }} />}

        {tab === "source" && (wf ? <CodeView code={p.sources[id]} file="plumbline/workflows.py" /> : <CodeView file={file} maxHeight={9999} />)}

        {tab === "overview" && <>
          {piece && <>
            <p style={{ fontSize: 15 }}>{piece.does}</p>
            <div className="callout"><div className="stat-label">Why it's built this way</div><p style={{ marginTop: 4 }}>{piece.why}</p></div>
          </>}

          {id === "gateway" && <GatewayLive p={p} />}
          {id === "judge" && <div className="section" style={{ marginTop: 24 }}><h3 className="section-title">Shapes a route can ask for</h3>
            <table><tbody>
              <tr><td className="mono">per_item</td><td>Retrieve k paragraphs per item, one model call per item. The usual RAG pattern.</td></tr>
              <tr><td className="mono">batched</td><td>Decision model: whole corpus as context, every item as a typed question, one call per 128 questions.</td></tr>
              <tr><td className="mono">long_context</td><td>Whole corpus in the prompt, every item answered in one call.</td></tr>
              <tr><td className="mono">cascade</td><td>Run a cheap route first; escalate low-confidence or non-positive items to a strong route.</td></tr>
            </tbody></table></div>}
          {id === "benchmark" && <p style={{ marginTop: 16 }}><Link className="btn primary" to="/evals" onClick={close}>Open evals</Link></p>}
          {id === "retrieve" && <Corpus p={p} />}
          {id === "postgres" && <><p style={{ fontSize: 15 }}>One database for sources, derived data, operational records and config: they change at different rates, so they live in separate tables, but one place keeps joins and audits simple.</p><Corpus p={p} />
            <div className="section" style={{ marginTop: 24 }}><h3 className="section-title">Tables</h3>
              <table><tbody>{[["documents, paragraphs", "Sources and derived data: text, stable IDs, 1024-dim embeddings"], ["runs, verdicts", "Every workflow run and every finding, with review status"],
                ["model_calls", "One row per gateway call: model, tokens, cost, latency, cache, fallback"], ["cache", "Gateway response cache, keyed by request hash"],
                ["routes, route_history", "The task → model table the gateway reads on every call"], ["benchmarks", "Eval results per task and setup"], ["review_labels", "Reviewer accept/reject decisions, as labels"]]
                .map(([a, b]) => <tr key={a}><td className="mono">{a}</td><td>{b}</td></tr>)}</tbody></table></div></>}
          {id === "requirements" && <p style={{ marginTop: 16 }}><Link to="/datasets" onClick={close}>See the 16 reviewed requirements →</Link></p>}

          {wf && <WorkflowPanel id={id} p={p} routes={routes} go={go} close={close} />}

          {model && <ModelPanel id={id} p={p} />}

          {id === "compliance" && <>
            <p style={{ fontSize: 15 }}>A compliance team's view of the platform's output. Two fictional Medi-Cal plans respond to a real state letter (DHCS APL 26-001). Reviewers see each finding with the regulation and the cited policy text side by side, and accept or reject it.</p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Link className="btn primary" to="/changes" onClick={close}>Regulatory changes</Link>
              <Link className="btn" to="/gaps/sunvale" onClick={close}>Gap review</Link>
              <Link className="btn" to="/audit/sunvale" onClick={close}>Audit review</Link>
            </div></>}
          {id === "console" && <>
            <p style={{ fontSize: 15 }}>The engineer-facing side: runs with every model call, the gateway and routing table, evals, and datasets. React + Vite, served by the platform API.</p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Link className="btn" to="/runs" onClick={close}>Runs</Link><Link className="btn" to="/gateway" onClick={close}>Gateway</Link><Link className="btn" to="/evals" onClick={close}>Evals</Link>
            </div></>}
          {id === "api" && <p style={{ fontSize: 15 }}>FastAPI. The console only reads results and triggers runs through it; workflows run in the background and record everything in Postgres. See the Source tab for every endpoint.</p>}
        </>}
      </aside>
    </>
  );
}

function WorkflowPanel({ id, p, routes, go, close }: { id: string; p: any; routes: Record<string, any>; go: (id: string) => void; close: () => void }) {
  const wf = WORKFLOW_STEPS[id];
  const run = p.latest[id];
  return (
    <>
      <p style={{ fontSize: 15 }}>“{wf.question}”</p>
      <p className="muted" style={{ marginTop: 4 }}>{wf.output}</p>
      <div className="section" style={{ marginTop: 24 }}>
        <h3 className="section-title">Steps</h3>
        <div className="steps">{wf.steps.map((s) => (
          <div className="step" key={s.title}>
            <div><div style={{ fontWeight: 500 }}>{s.title}</div><div className="muted">{s.detail}</div>
              {s.task && <div className="faint" style={{ marginTop: 4 }}>route: <span className="mono">{routeLabel(routes[s.task])}</span></div>}</div>
            <button className="pill" onClick={() => go(s.piece)}>{s.piece}</button>
          </div>))}</div>
      </div>
      {run && <div className="section" style={{ marginTop: 24 }}>
        <h3 className="section-title">Latest run</h3>
        <p className="muted" style={{ marginBottom: 8 }}>{run.plan} · {when(run.finished_at)} · {run.summary.items} items · {usd(run.summary.cost_usd, 4)}</p>
        <table><thead><tr><th>Task</th><th>Model</th><th className="r">Calls</th><th className="r">Cost</th><th className="r">Slowest</th></tr></thead>
          <tbody>{run.calls.map((c: any, i: number) => <tr key={i}><td className="mono">{c.task}</td><td className="mono">{c.model}</td>
            <td className="r num">{c.n}{c.cached ? ` (${c.cached} cached)` : ""}</td><td className="r num">{usd(c.cost, 5)}</td><td className="r num">{ms(c.latency)}</td></tr>)}</tbody></table>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <Link className="btn primary" to={wf.review} onClick={close}>See its findings</Link>
          <Link className="btn" to={`/runs/${run.id}`} onClick={close}>Run record</Link>
        </div>
      </div>}
    </>
  );
}

export function GatewayLive({ p }: { p: any }) {
  const s = p.stats;
  return (
    <div className="section" style={{ marginTop: 24 }}>
      <h3 className="section-title">Live</h3>
      <p className="muted" style={{ marginBottom: 8 }}>{Number(s.calls).toLocaleString()} calls · {pct(s.cached / s.calls)} from cache · {s.fallbacks} fallbacks · {s.errors} errors · {usd(Number(s.spend), 2)} spent</p>
      <table><thead><tr><th>Model</th><th>Call</th><th className="r">Calls</th><th className="r">p50</th><th className="r">Spend</th></tr></thead>
        <tbody>{p.by_model.map((m: any) => <tr key={m.model + m.kind}><td className="mono">{m.model}</td><td>{m.kind}</td><td className="r num">{m.calls}</td>
          <td className="r num">{ms(m.p50)}</td><td className="r num">{usd(Number(m.spend), 4)}</td></tr>)}</tbody></table>
      
    </div>
  );
}

function ModelPanel({ id, p }: { id: string; p: any }) {
  const info = MODEL_INFO[id];
  const price = p.prices[id];
  const rows = p.by_model.filter((m: any) => m.model.startsWith(id) || id.startsWith(m.model));
  const tasks = p.routes.filter((r: any) => JSON.stringify(r.route).includes(id)).map((r: any) => r.task);
  return (
    <>
      <p style={{ fontSize: 15 }}><strong>{info.role}.</strong> {info.note}</p>
      <dl className="kv" style={{ marginTop: 16 }}>
        <dt>Provider</dt><dd>{info.provider}</dd>
        {price && <><dt>Price</dt><dd className="num">${price.input} in · ${price.output} out per 1M tokens</dd></>}
        <dt>Routed tasks</dt><dd>{tasks.length ? tasks.map((t: string) => <span key={t} className="mono" style={{ marginRight: 8 }}>{t}</span>) : <span className="muted">none right now (benchmarked)</span>}</dd>
      </dl>
      {rows.length > 0 && <table style={{ marginTop: 16 }}><thead><tr><th>Call</th><th className="r">Calls</th><th className="r">Cached</th><th className="r">Tokens in</th><th className="r">p50</th><th className="r">Spend</th></tr></thead>
        <tbody>{rows.map((m: any) => <tr key={m.kind}><td>{m.kind}</td><td className="r num">{m.calls}</td><td className="r num">{m.cached}</td>
          <td className="r num">{Number(m.tin).toLocaleString()}</td><td className="r num">{ms(m.p50)}</td><td className="r num">{usd(Number(m.spend), 4)}</td></tr>)}</tbody></table>}
    </>
  );
}

function Corpus({ p }: { p: any }) {
  return (
    <div className="section" style={{ marginTop: 24 }}><h3 className="section-title">Indexed corpus</h3>
      <table><thead><tr><th>Scope</th><th>Kind</th><th className="r">Documents</th><th className="r">Paragraphs</th></tr></thead>
        <tbody>{p.corpus.map((c: any) => <tr key={c.plan + c.kind}><td>{c.plan}</td><td>{c.kind}</td><td className="r num">{c.docs}</td><td className="r num">{c.paragraphs}</td></tr>)}</tbody></table></div>
  );
}
