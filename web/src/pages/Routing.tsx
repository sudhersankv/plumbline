import { useState } from "react";
import { put, when } from "../api";
import { PageHead, usePoll } from "../ui";

const TASK_NOTES: Record<string, string> = {
  extract_requirements: "Regulation → atomic obligations. Run once, reviewed by a person.",
  judge_gap: "Requirement vs a plan's policies: met, gap or conflict.",
  judge_evidence: "Audit item vs evidence: satisfied, partial or missing.",
  explain_evidence: "Short explanation for items a reviewer will read.",
  rate_severity: "Severity score for each gap.",
};

function describe(r: any): string {
  if (r.shape === "cascade") return `${describe(r.first)}, then ${describe(r.then)} below confidence ${r.threshold}`;
  const shape = r.shape === "batched" ? "all items in one call" : r.shape === "long_context" ? "whole document set, one call" :
    r.shape === "per_item" ? `retrieve ${r.k ?? 5}, one call per item` : "";
  return [r.model, shape].filter(Boolean).join(" · ");
}

export default function Routing() {
  const { data, reload } = usePoll<any>("/api/routes");
  const [edit, setEdit] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function open(task: string, route: any) { setEdit(task); setText(JSON.stringify(route, null, 2)); setErr(null); }
  async function save(task: string, route?: any) {
    try {
      const r = route ?? JSON.parse(text);
      await put(`/api/routes/${task}`, { route: r });
      setEdit(null); reload();
    } catch (e) { setErr(String(e)); }
  }
  function preset(task: string, key: string) {
    const s = data.setups[key];
    const k = task === "judge_gap" ? 5 : 3;
    if (key === "cascade") return { shape: "cascade", threshold: 0.8, first: { ...data.setups.snap_batched, k }, then: { ...data.setups.opus_retrieve, k } };
    return { ...s, k };
  }

  return (
    <div className="page">
      <PageHead eyebrow="Platform" title="Routing"
        lede="One row per task. Workflows never name a model; the gateway reads this table on every call. Changing a model is a config change, not a code change, and the next run picks it up." />
      {data && <table>
        <thead><tr><th style={{ width: 190 }}>Task</th><th>Route</th><th>Provider</th><th>Updated</th><th /></tr></thead>
        <tbody>{data.routes.map((r: any) => (
          <tr key={r.task} className={edit === r.task ? "sel" : ""}>
            <td><div className="mono">{r.task}</div><div className="faint">{TASK_NOTES[r.task]}</div></td>
            <td>
              <div style={{ fontWeight: 500 }}>{r.route.name ?? describe(r.route)}</div>
              {r.route.name && <div className="muted">{describe(r.route)}</div>}
              {r.route.fallback && <div className="faint">falls back to <span className="mono">{r.route.fallback}</span></div>}
              {edit === r.task && <div style={{ marginTop: 12 }}>
                {(r.task === "judge_gap" || r.task === "judge_evidence") && <div className="btn-row" style={{ marginBottom: 8 }}>
                  {[...Object.keys(data.setups), "cascade"].map((k) =>
                    <button key={k} className="btn small" onClick={() => setText(JSON.stringify(preset(r.task, k), null, 2))}>{k === "cascade" ? "Cascade · Snap → Opus" : data.setups[k].name}</button>)}
                </div>}
                <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Route JSON" />
                {err && <p className="err">{err}</p>}
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn primary" onClick={() => save(r.task)}>Save route</button>
                  <button className="btn quiet" onClick={() => setEdit(null)}>Cancel</button>
                </div>
              </div>}
            </td>
            <td className="muted">{r.route.shape === "cascade" ? "SubQ → Neon AI Gateway" : r.route.provider === "anthropic" ? "Neon AI Gateway" : "SubQ"}</td>
            <td className="num muted">{when(r.updated_at)}</td>
            <td className="r">{edit !== r.task && <button className="btn small" onClick={() => open(r.task, r.route)}>Change</button>}</td>
          </tr>))}</tbody>
      </table>}

      {data && <section className="section grid cols-2">
        <div>
          <h2 className="section-title">Models</h2>
          <dl className="kv">{Object.entries<string>(data.models).map(([k, v]) => <><dt key={k}>{k}</dt><dd className="mono">{v}</dd></>)}</dl>
        </div>
        <div>
          <h2 className="section-title">Change history</h2>
          {data.history.length === 0 ? <p className="muted">No changes since the defaults were seeded.</p> :
            <table><tbody>{data.history.map((h: any, i: number) => <tr key={i}><td className="num muted">{when(h.changed_at)}</td><td className="mono">{h.task}</td><td>{h.route.name ?? describe(h.route)}</td></tr>)}</tbody></table>}
        </div>
      </section>}
    </div>
  );
}
