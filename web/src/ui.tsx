import { ReactNode, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function usePoll<T>(path: string | null, every = 0): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then((d) => live && (setData(d), setError(null))).catch((e) => live && setError(String(e)));
    const t = every ? setInterval(() => setTick((x) => x + 1), every) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [path, tick, every]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}

export function PageHead({ eyebrow, title, lede, children }: { eyebrow: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="title">{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children && <div className="btn-row">{children}</div>}
    </header>
  );
}

const TONE: Record<string, string> = {
  met: "b-good", satisfied: "b-good", verified: "b-good", done: "b-good", accepted: "b-good",
  partial: "b-warn", gap: "b-warn", running: "b-warn", medium: "b-warn", high: "b-bad",
  conflict: "b-bad", missing: "b-bad", failed: "b-bad", critical: "b-bad", rejected: "b-bad", no_answer: "b-bad",
  needs_review: "b-review", low: "b-plain", pending: "b-plain",
};
export function Badge({ v, label }: { v?: string | null; label?: string }) {
  if (!v) return <span className="faint">—</span>;
  return <span className={`badge ${TONE[v] ?? "b-plain"}`}>{label ?? v.replace("_", " ")}</span>;
}

export function Chip({ id, on, onClick, missing }: { id: string; on?: boolean; onClick?: () => void; missing?: boolean }) {
  return (
    <button className={`chip${on ? " on" : ""}${missing ? " missing" : ""}`} onClick={onClick} title="Show this paragraph">
      {id}
    </button>
  );
}

export function Elapsed({ from }: { from: string }) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return <span className="num">{Math.max(0, Math.round((Date.now() - +new Date(from)) / 1000))}s</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Highlights `quote` inside `text`, forgiving whitespace and curly quotes. */
export function Highlight({ text, quote }: { text: string; quote?: string | null }) {
  if (!quote) return <>{text}</>;
  const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const q = norm(quote).trim().replace(/[.;:]$/, "");
  const i = q ? norm(text).indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function useScrollTop(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo?.({ top: 0 }); }, [dep]);
  return ref;
}
