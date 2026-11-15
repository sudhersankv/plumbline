import { useState } from "react";
import { when } from "../api";
import { Badge, PageHead, usePoll } from "../ui";

export default function Datasets() {
  const { data } = usePoll<any>("/api/datasets");
  const { data: reg } = usePoll<any>("/api/regulations/APL26-001");
  const [tab, setTab] = useState("requirements");
  const tabs: [string, string][] = [["requirements", "Requirements"], ["gap", "Gap labels"], ["evidence", "Audit items and labels"], ["review", "Reviewer labels"]];
  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <PageHead eyebrow="Platform" title="Datasets"
        lede="The saved requirements every plan shares, and the labelled items the benchmark scores against. Each label records what was planted and why it is tricky, so a wrong result traces to one item." />
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "requirements" && reg && <>
        <p className="section-note">Reviewed set: {reg.requirements.length} requirements. The model's draft ({reg.draft?.requirements.length ?? 0} rows, {reg.draft?.model}) is kept for comparison; a person added the one it missed (R13: the Staying Healthy Assessment is no longer required).</p>
        <table><thead><tr><th>ID</th><th>Topic</th><th>Obligation</th><th>Exact quote</th><th>Source</th></tr></thead>
          <tbody>{reg.requirements.map((r: any) => <tr key={r.id}><td className="mono">{r.id.replace("APL26-001-", "")}</td><td>{r.topic}</td><td>{r.obligation}</td>
            <td className="muted" style={{ fontFamily: "var(--font-display)", fontWeight: 300 }}>“{r.quote}”</td><td className="mono">{r.paragraph_id.split(":")[1]}</td></tr>)}</tbody></table>
      </>}

      {tab === "gap" && data && <table><thead><tr><th>Plan</th><th>Requirement</th><th>Label</th><th>Paragraphs</th><th>Why it's tricky</th></tr></thead>
        <tbody>{data.judge_gap.map((r: any) => <tr key={r.plan + r.item_id}><td>{r.plan}</td><td className="mono">{r.item_id.replace("APL26-001-", "")}</td><td><Badge v={r.truth} /></td>
          <td className="mono" style={{ fontSize: 12 }}>{r.paragraph_ids.join(" ")}</td><td className="muted">{r.why_tricky || "—"}</td></tr>)}</tbody></table>}

      {tab === "evidence" && data && <table><thead><tr><th>Item</th><th>Auditor asks</th><th>Label</th><th>Evidence</th><th>Why it's tricky</th></tr></thead>
        <tbody>{data.judge_evidence.map((r: any) => <tr key={r.item_id}><td className="mono">{r.item_id.replace("SUNVALE-", "")}</td>
          <td style={{ maxWidth: 380 }}>{r.question.split("\n")[0].replace(/^Audit item [^:]+: /, "")}</td><td><Badge v={r.truth} /></td>
          <td className="mono" style={{ fontSize: 12 }}>{r.paragraph_ids.join(" ")}</td><td className="muted">{r.why_tricky || "—"}</td></tr>)}</tbody></table>}

      {tab === "review" && data && (data.review_labels.length === 0
        ? <p className="muted">No reviewer decisions yet. Accepting or rejecting a finding in Gap review or Audit review adds a label here.</p>
        : <table><thead><tr><th>When</th><th>Task</th><th>Plan</th><th>Item</th><th>Label</th></tr></thead>
          <tbody>{data.review_labels.map((r: any) => <tr key={r.id}><td className="num muted">{when(r.created_at)}</td><td className="mono">{r.task}</td><td>{r.plan}</td><td className="mono">{r.item_id}</td><td><Badge v={r.label} /></td></tr>)}</tbody></table>)}
    </div>
  );
}
