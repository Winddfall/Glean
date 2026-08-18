// 纯工具函数：不触碰 DOM 与存储，Node 可直接单测

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function truncate(s: unknown, n: number): string {
  const str = String(s == null ? "" : s);
  return str.length > n ? str.slice(0, n) : str;
}

export function esc(s: unknown): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => map[c]);
}

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export function backoffMs(retries: number): number {
  return [5000, 15000, 60000][clamp(retries, 1, 3) - 1];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 容错解析 LLM 返回：对象直传、代码围栏、首尾杂音
export function parseJsonLoose(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  let s = String(raw == null ? "" : raw).trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}
