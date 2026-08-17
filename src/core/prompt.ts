// Prompt 构造与结果校验（纯函数，Node 可测）

import { truncate } from "./utils.js";
import type { Goal, AnalysisResult } from "../types.js";

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
    '{"relevant": true或false, "goalId": "目标id或null", "summary": "80字以内页面摘要", "keywords": ["关键词"]}',
    "规则：goalId 只能从上方工作目标的 id 中选最相关的一个；与任何目标都无关时 relevant=false、goalId=null；拿不准时 relevant=false。",
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
  return {
    relevant,
    goalId,
    summary: truncate(typeof obj.summary === "string" ? obj.summary : "", 200),
    keywords: Array.isArray(obj.keywords) ? obj.keywords.slice(0, 8).map(String) : [],
  };
}
