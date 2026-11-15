import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, PLANS, post, usd, when } from "../api";
import { Badge, Chip, Empty, Highlight, PageHead, usePoll } from "../ui";

type V = {
  id: number; item_id: string; label: string; confidence: number | null; severity: string | null;
  paragraph_ids: string[]; quote: string | null; regulation_quote: string | null; reason: string | null;
  explanation: string | null; citation_status: string; citation_notes: string[]; setup: string;
  review_status: string; review_label: string | null;
};

const ORDER: Record<string, number> = { conflict: 0, gap: 1, missing: 0, partial: 1, no_answer: -1, met: 3, satisfied: 3 };

export default function Review({ kind }: { kind: "gap" | "audit" }) {
  const { plan = "sunvale" } = useParams();
  const wf = kind === "gap" ? "regulatory_change" : "audit_review";
  const { data: runs } = usePoll<any[]>("/api/runs", 5000);
  const run = runs?.find((r) => r.workflow === wf && r.plan === plan && r.status === "done");
  const { data: detail, reload } = usePoll<any>(run ? `/api/runs/${run.id}` : null);
  const { data: reg } = usePoll<any>("/api/regulations/APL26-001");
  const { data: datasets } = usePoll<any>(kind === "audit" ? "/api/datasets" : null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  const verdicts: V[] = useMemo(() => {
    const vs: V[] = detail?.verdicts ?? [];
    return [...vs].sort((a, b) =>
      (a.citation_status === "needs_review" ? -1 : 0) - (b.citation_status === "needs_review" ? -1 : 0) ||
      (ORDER[a.label] ?? 2) - (ORDER[b.label] ?? 2) || a.item_id.localeCompare(b.item_id));
  }, [detail]);
  const shown = verdicts.filter((v) => filter === "all" || (filter === "open" ? !["met", "satisfied"].includes(v.label) : v.review_status === "pending"));
  const cur = verdicts.find((v) => v.item_id === sel) ?? shown[0];

  const reqs: Record<string, any> = Object.fromEntries((reg?.requirements ?? []).map((r: any) => [r.id, r]));
  const items: Record<string, any> = Object.fromEntries((datasets?.judge_evidence ?? []).map((r: any) => [r.item_id, r]));
  const title = kind === "gap" ? "Gap review" : "Audit review";

  if (runs && !run) return (
    <div className="page"><PageHead eyebrow={PLANS[plan]} title={title} />
      <Empty>No finished {kind === "gap" ? "regulatory change" : "audit review"} run for {PLANS[plan]} yet. Start one from <Link to="/">Regulatory changes</Link>.</Empty>
    </div>);

  const s = detail?.summary;
  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <PageHead eyebrow={`${PLANS[plan]} · APL 26-001`} title={title}
        lede={kind === "gap"
          ? "Each requirement from the state letter, judged against this plan's policies. The regulation text on the left is the saved requirement, never model-written; the policy text on the right is what the model cited."
          : "Each auditor request, the evidence the model relied on, its verdict, and an explanation for anything short of satisfied."}>
        {run && <Link className="btn" to={`/runs/${run.id}`}>Run details</Link>}
      </PageHead>
      {s && <p className="muted" style={{ marginTop: -16, marginBottom: 16 }}>
        {s.items} items · {Object.entries(s.labels).map(([k, n]) => `${n} ${k}`).join(" · ")} · {s.needs_review} need review ·
        {" "}{usd(s.cost_usd)} · route <span className="mono">{verdicts[0]?.setup}</span> · {when(run?.finished_at)}</p>}

      <div className="split">
        <div className="list">
          <div className="tabs" style={{ margin: 0, padding: "0 8px" }}>
            {[["all", "All"], ["open", "Findings"], ["pending", "Unreviewed"]].map(([k, l]) =>
              <button key={k} className={`tab${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          {shown.map((v) => (
            <button key={v.id} className={`list-item${cur?.id === v.id ? " sel" : ""}`} onClick={() => setSel(v.item_id)}>
              <span className="id">{v.item_id.replace("APL26-001-", "").replace("SUNVALE-", "")}
                {v.review_status !== "pending" && <span> · {v.review_status}</span>}</span>
              <span style={{ display: "flex", gap: 4 }}>
                {v.citation_status === "needs_review" && <Badge v="needs_review" label="review" />}
                <Badge v={v.label} />
              </span>
              <span className="txt">{kind === "gap" ? reqs[v.item_id]?.obligation : items[v.item_id]?.question.split("\n")[0].replace(/^Audit item [^:]+: /, "")}</span>
            </button>
          ))}
          {shown.length === 0 && <Empty>Nothing here.</Empty>}
        </div>
        {cur ? <Detail key={cur.id} v={cur} kind={kind} req={kind === "gap" ? reqs[cur.item_id] : reqs[items[cur.item_id]?.question.match(/APL26-001-R\d+/)?.[0] ?? ""]}
          item={items[cur.item_id]} onReviewed={reload} /> : <div className="detail"><Empty>Loading findings…</Empty></div>}
      </div>
    </div>
  );
}

function Detail({ v, kind, req, item, onReviewed }: { v: V; kind: "gap" | "audit"; req: any; item: any; onReviewed: () => void }) {
  const [paras, setParas] = useState<Record<string, any>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const ids = v.paragraph_ids ?? [];
  useEffect(() => { if (ids.length) api(`/api/paragraphs?ids=${ids.join(",")}`).then(setParas); }, [v.id]);
  const labels = kind === "gap" ? ["met", "gap", "conflict"] : ["satisfied", "partial", "missing"];

  async function review(decision: "accept" | "reject") {
    await post(`/api/verdicts/${v.id}/review`, { decision, label: decision === "reject" ? label || null : null });
    onReviewed();
  }

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="eyebrow mono">{v.item_id}{req && kind === "audit" ? ` · tests ${req.id.replace("APL26-001-", "")}` : ""}</div>
          <h2 className="detail-title">{kind === "gap" ? req?.obligation : item?.question.split("\n")[0].replace(/^Audit item [^:]+: /, "")}</h2>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge v={v.label} />
          {v.severity && <Badge v={v.severity} label={`${v.severity} severity`} />}
          <Badge v={v.citation_status} />
        </div>
      </div>

      <div className="reader">
        <div>
          <div className="reader-label"><span>Regulation · DHCS APL 26-001</span>{req && <span className="mono">{req.paragraph_id}</span>}</div>
          <p className="quote">“{v.regulation_quote ?? req?.quote}”</p>
          {kind === "audit" && item && <div className="callout"><div className="stat-label">Auditor asks</div>{item.question.split("\n")[0].replace(/^Audit item [^:]+: /, "")}</div>}
        </div>
        <div>
          <div className="reader-label"><span>{kind === "gap" ? "Plan policy" : "Plan evidence"} · cited by the model</span></div>
          {ids.length === 0 && <p className="muted">No paragraph cited. The model found nothing in the {kind === "gap" ? "policies" : "evidence"} that addresses this.</p>}
          {ids.length > 0 && <div className="chips" style={{ marginBottom: 12 }}>
            {ids.map((id) => <Chip key={id} id={id} on={focus === id} missing={!paras[id]} onClick={() => setFocus(focus === id ? null : id)} />)}
          </div>}
          {ids.filter((id) => !focus || id === focus).map((id) => paras[id] && (
            <div className="para" key={id}>
              <span className="pid">{id} · {paras[id].title}{paras[id].section ? ` · ${paras[id].section}` : ""}</span>
              <Highlight text={paras[id].text} quote={v.quote} />
            </div>
          ))}
        </div>
      </div>

      {(v.reason || v.explanation) && <div className="callout">
        <div className="stat-label">{v.explanation ? "Explanation for reviewer" : "Model's reason"}</div>
        <p style={{ marginTop: 4 }}>{v.explanation ?? v.reason}</p>
        {v.explanation && v.reason && <p className="muted" style={{ marginTop: 8 }}>Verdict reason: {v.reason}</p>}
      </div>}
      {v.confidence != null && <p className="muted" style={{ marginTop: 12 }}>Decision model confidence <span className="num">{v.confidence.toFixed(2)}</span>
        {v.confidence < 0.8 && " · below the 0.80 threshold, so it was explained for review"}</p>}
      {v.citation_notes?.length > 0 && <div className="callout warn"><div className="stat-label">Why this needs review</div>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{v.citation_notes.map((n) => <li key={n}>{n}</li>)}</ul></div>}

      <div className="reviewbar">
        <span className="muted">{v.review_status === "pending" ? "Your decision is saved as a label and joins the benchmark dataset."
          : <>Reviewed: <Badge v={v.review_status} />{v.review_label && <> as <Badge v={v.review_label} /></>}</>}</span>
        <div className="btn-row">
          <select value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Correct label">
            <option value="">Correct label…</option>
            {labels.filter((l) => l !== v.label).map((l) => <option key={l}>{l}</option>)}
          </select>
          <button className="btn" disabled={!label} onClick={() => review("reject")}>Reject</button>
          <button className="btn primary" onClick={() => review("accept")}>Accept finding</button>
        </div>
      </div>
    </div>
  );
}
