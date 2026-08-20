// Prompt 构造与结果校验（纯函数，Node 可测）

import { truncate } from "./utils.js";
import type { Goal, AnalysisResult, NoteEntry } from "../types.js";

// 单次合并调用的 prompt：分类 + 摘要 + 关键词
export function buildPagePrompt(page: {
  url: string;
  title: string;
  h1?: string;
  meta?: string;
  excerpt: string;
}, goals: Goal[]): string {
  const goalLines = goals.map((g, i) => `${i + 1}. ${g.id}：${g.title}`).join("\n");
  return [
    '你是"拾知"分析器。判断网页内容与用户工作目标的关系，只输出 JSON。',
    "",
    "[工作目标]",
    goalLines,
    "",
    "[网页]",
    `URL: ${page.url}`,
    `标题: ${page.title}`,
    page.h1 ? `章节: ${page.h1}` : "",
    page.meta ? `简介: ${page.meta}` : "",
    "正文摘录:",
    page.excerpt,
    "",
    "输出 JSON（不要输出任何其他内容）：",
    '{"relevant": true或false, "goalId": "目标id或null", "relevance": 0-100整数, "summary": "80字以内页面摘要", "keywords": ["关键词"], "findings": ["关键发现1", "关键发现2"], "notes": [{"topic": "主题", "content": "该主题下的笔记内容", "relevance": 0-100}]}',
    "规则：goalId 只能从上方工作目标的 id 中选最相关的一个；与任何目标都无关时 relevant=false、goalId=null、relevance 为0-60；拿不准时 relevant=false；relevance 表示该页面内容与工作目标的相关程度，0=完全无关，100=高度相关。",
    "findings 为2-5条关键发现，每条一句话概括页面中有价值的信息点；notes 为按主题拆分的结构化笔记，每个主题包含 topic(主题名称)、content(该主题下的详细笔记，2-3句话) 和 relevance(该主题与工作目标的相关度0-100)；notes 最多4个主题。",
  ].filter(Boolean).join("\n");
}

// 结构校验与归一化：goalId 必须属于现有目标，否则按摸鱼处理
export function validateAnalysis(json: unknown, goals: Goal[]): AnalysisResult {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bad analysis json");
  const obj = json as Record<string, unknown>;
  const ids = new Set(goals.map((g) => g.id));
  let relevant = obj.relevant === true || obj.relevant === "true";
  const goalId = typeof obj.goalId === "string" && ids.has(obj.goalId) ? obj.goalId : null;
  if (!goalId) relevant = false;
  const relevanceRaw = Number(obj.relevance);
  const relevance = Number.isFinite(relevanceRaw) ? Math.max(0, Math.min(100, Math.round(relevanceRaw))) : (relevant ? 60 : 0);
  const findings = Array.isArray(obj.findings)
    ? obj.findings.slice(0, 5).map((f) => truncate(String(f), 120))
    : [];
  const notes = Array.isArray(obj.notes)
    ? obj.notes.slice(0, 4).map((n): NoteEntry => {
        const no = (n ?? {}) as Record<string, unknown>;
        const nr = Number(no.relevance);
        return {
          topic: truncate(typeof no.topic === "string" ? no.topic : "", 30),
          content: truncate(typeof no.content === "string" ? no.content : "", 300),
          relevance: Number.isFinite(nr) ? Math.max(0, Math.min(100, Math.round(nr))) : 0,
        };
      }).filter((n) => n.topic && n.content)
    : [];
  return {
    relevant,
    goalId,
    relevance,
    summary: truncate(typeof obj.summary === "string" ? obj.summary : "", 200),
    keywords: Array.isArray(obj.keywords) ? obj.keywords.slice(0, 8).map(String) : [],
    findings,
    notes,
  };
}
