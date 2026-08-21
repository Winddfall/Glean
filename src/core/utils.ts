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

import type { SearchTerm } from "../types.js";

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

/** 把 string 或 SearchTerm 统一归一化为 SearchTerm 对象 */
export function normalizeSearchTerm(term: string | SearchTerm): SearchTerm {
  if (typeof term === "string") return { display: term, query: term };
  return { display: String(term.display || "").trim() || term.query, query: String(term.query || "").trim() || term.display };
}

/** 从混合数组中提取所有 query（实际搜索用） */
export function getSearchQueries(terms: (string | SearchTerm)[]): string[] {
  return terms.map((t) => normalizeSearchTerm(t).query).filter(Boolean);
}

/** 从混合数组中提取所有 display（UI 显示用） */
export function getSearchDisplays(terms: (string | SearchTerm)[]): string[] {
  return terms.map((t) => normalizeSearchTerm(t).display).filter(Boolean);
}

/**
 * 后处理：把简单关键词扩展成学术搜索表达式。
 * - 已是复杂表达式（含引号/AND/OR/NOT/site:）→ 原样保留
 * - LLM 已生成明显更长的 query → 保留
 * - 英文短语 → `"full phrase" OR (word1 AND word2 ...)` 双路召回
 * - 中文/单词 → 引号包裹成精确短语，避免被搜索引擎拆词
 */
export function enrichSearchTerm(term: SearchTerm): SearchTerm {
  const display = (term.display || "").trim();
  const query = (term.query || "").trim();
  const fallback = display || query;

  // 已经是复杂布尔表达式，保留
  if (query && (/[\"']/.test(query) || /\b(AND|OR|NOT)\b/i.test(query) || /[()]/.test(query) || /site:/i.test(query))) {
    return { display: display || query, query };
  }
  // LLM 已生成明显更长的扩展 query，保留
  if (query && display && query !== display && query.length > display.length + 3) {
    return { display, query };
  }

  const core = fallback.replace(/["']/g, "").trim();
  if (!core) return { display: fallback, query: fallback };

  // 简单关键词 → 引号包裹成精确短语
  const quoted = `"${core}"`;
  // 纯英文多词短语：额外提供 AND 组合变体，扩大召回
  const words = core.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /^[\x00-\x7F\s]+$/.test(core)) {
    return { display: fallback, query: `${quoted} OR (${words.join(" AND ")})` };
  }
  return { display: fallback, query: quoted };
}
