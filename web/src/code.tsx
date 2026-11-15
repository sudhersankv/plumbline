import { useEffect, useState } from "react";
import { api } from "./api";

/** Read-only source viewer: fetches a repo file from the platform API, or shows given code. */
export function CodeView({ file, code: given, maxHeight = 520 }: { file?: string; code?: string; maxHeight?: number }) {
  const [code, setCode] = useState<string | null>(given ?? null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (given != null) { setCode(given); return; }
    if (!file) return;
    setCode(null);
    api(`/api/source?file=${encodeURIComponent(file)}`).then((d) => { setCode(d.code); setUrl(d.url); }).catch(() => setCode("// source not available"));
  }, [file, given]);
  const lines = (code ?? "").replace(/\s+$/, "").split("\n");
  return (
    <div className="code">
      {file && <div className="code-head"><span className="mono">{file}</span>{url && <a href={url} target="_blank" rel="noreferrer">GitHub ↗</a>}</div>}
      <pre style={{ maxHeight }}>{code == null ? "Loading…" : lines.map((l, i) => (
        <div key={i} className="code-line"><span className="ln">{i + 1}</span><span className={/^\s*(#|\/\/)/.test(l) ? "cm" : /^\s*("""|''')/.test(l) ? "cm" : ""}>{l || " "}</span></div>
      ))}</pre>
    </div>
  );
}
