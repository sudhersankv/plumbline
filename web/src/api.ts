export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
export const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });
export const put = (path: string, body: unknown) => api(path, { method: "PUT", body: JSON.stringify(body) });

export const PLANS: Record<string, string> = { sunvale: "Sunvale Health Plan", bayline: "Bayline Community Health" };
export const WORKFLOWS: Record<string, string> = { regulatory_change: "Regulatory change", audit_review: "Audit review" };

export const usd = (n?: number | null, digits = 3) =>
  n == null ? "—" : n < 0.001 && n > 0 ? `$${n.toFixed(5)}` : `$${n.toFixed(digits)}`;
export const pct = (n?: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const ms = (n?: number | null) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
export const when = (s?: string) => (s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const dur = (a?: string, b?: string) => (a && b ? `${((+new Date(b) - +new Date(a)) / 1000).toFixed(0)}s` : "—");
