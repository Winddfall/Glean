// Prompt 构造与结果校验（纯函数，Node 可测）

import { truncate } from "./utils.js";
import { normalizeMatches } from "./matches.js";
import type { Goal, AnalysisResult, NoteEntry, MatchEntry, KeyQuote } from "../types.js";

export const PRESET_ANALYSIS_PROMPT = `你是"拾知"分析器。下面有一份网页内容和用户的工作目标清单（目标→任务→子任务三级，每级都带说明）。你的任务是判断网页与哪些一级目标相关，并为每个相关一级目标只选择一条最具体的任务路径进行深度分析。只输出 JSON。

[工作目标清单]
{{GOALS}}

[网页]
URL: {{URL}}
标题: {{TITLE}}
{{H1}}
{{META}}
正文摘录:
{{EXCERPT}}

[分析流程——必须严格执行]
步骤1：逐个一级目标判断网页是否相关；不同一级目标可以同时相关。
步骤2：对每个相关一级目标，比较它下面的所有任务，只选择最相关的一个任务；如果该任务还有子任务，再最多选择一个最相关的子任务。禁止在同一个一级目标下输出两条路径。
步骤3：为每个相关一级目标，从头写一套全新的 title / findings / notes / keyQuotes，只关注所选路径的分类说明。不同一级目标的分析之间不允许共享任何 finding、note 或 quote。
步骤4：输出前自检——matches 中 goalId 不得重复；如果某条 finding 或 note 贴到另一个一级目标的 match 里也成立，必须重写。

[输出格式]
只输出 JSON（不要输出任何其他内容）：
{"summary":"80字以内页面摘要（通用，不偏向任何分类）","keywords":["关键词"],"findings":["通用关键发现1","通用关键发现2"],"notes":[{"topic":"通用主题","content":"详细笔记"}],"keyQuotes":[{"quote":"原文关键句","context":"上下文"}],"matches":[{"goalId":"g_xxx","taskId":"t_xxx或null","subtaskId":"s_xxx或null","title":"根据该分类主题重写的标题（15字以内）","relevance":0,"reasoning":"为什么与该分类相关","findings":["分类视角发现1","分类视角发现2"],"notes":[{"topic":"分类主题","content":"分类视角笔记"}],"keyQuotes":[{"quote":"原文关键句","context":"上下文"}]}]}

[规则]
1. 一个网页可以匹配 0 个、1 个或多个一级目标；与所有目标都无关时 matches 返回空数组 []。
2. 同一个 goalId 在 matches 中最多出现一次。一个一级目标下即使多个任务都相关，也必须比较后只选择最相关的一条路径。
3. 尽量归到最细层级：能确定到子任务就填 subtaskId（同时填 taskId、goalId），能确定到任务就填 taskId（同时填 goalId）；一级目标存在任务时不要只填 goalId。
4. relevance 表示网页与所选路径的相关程度，0=完全无关，100=高度相关；低于 50 的不要放进 matches。
5. 【最关键】每个 match 的 title / findings / notes / keyQuotes 必须完全不同。不同一级目标的关注角度由各自的说明定义，你应从所选路径的视角审视网页。
6. title 必须根据所选路径的主题重新提炼，不要直接复制网页原标题。标题要精准概括“这个网页对该目标有什么价值”，15字以内，超出用省略号。
7. 判断“什么是有价值的信息”时，以所选路径的说明为准。不要写一个通用版然后复制给多个一级目标。
8. match 里的 findings 写所选路径视角下的关键信息点。允许详细展开，信息量大的页面可以写到 8-10 条，禁止空话。
9. match 里的 notes 按主题拆分，每个主题一条。content 先引用原文关键句，紧接着写这个信息在所选路径视角下为什么有价值。
10. match 里的 keyQuotes 尽量多提供，最多 6 条。quote 必须逐字来自网页正文，不得改写。
11. reasoning 必须引用网页里的具体内容说明为什么与所选路径相关。
12. 【摸鱼场景通用分析】当 matches 为空时，必须在顶层输出 findings / notes / keyQuotes；当 matches 不为空时，以 match 里的内容为准。
13. 内容丰富的网页，请充分利用输出空间，不要刻意精简。
14. 拿不准是否相关时，宁可判定为不相关。

[错误示例——绝对禁止]
下面的输出是错误的，因为同一个一级目标 g1 出现了两次：
{"matches":[
  {"goalId":"g1","taskId":"t1","subtaskId":null,"relevance":85},
  {"goalId":"g1","taskId":"t2","subtaskId":"s2","relevance":80}
]}

[正确示例]
如果网页同时与 g1、g2 相关，可以各输出一条；但每个一级目标内部只能选择一个最相关任务路径：
{"matches":[
  {"goalId":"g1","taskId":"t1","subtaskId":null,"relevance":85},
  {"goalId":"g2","taskId":"t8","subtaskId":"s9","relevance":80}
]}`;

export function buildPagePrompt(
  page: {
    url: string;
    title: string;
    h1?: string;
    meta?: string;
    excerpt: string;
  },
  goals: Goal[],
  customPrompt?: string
): string {
  const goalLines = goals.map((g, gi) => {
    const lines: string[] = [`${gi + 1}. 目标 ${g.id}：${g.title}`];
    if (g.prompt) lines.push(`   目标说明：${g.prompt}`);
    (g.tasks || []).forEach((t, ti) => {
      lines.push(`   ${gi + 1}.${ti + 1} 任务 ${t.id}：${t.title}`);
      if (t.prompt) lines.push(`      任务说明：${t.prompt}`);
      (t.subtasks || []).forEach((s, si) => {
        lines.push(`      ${gi + 1}.${ti + 1}.${si + 1} 子任务 ${s.id}：${s.title}`);
        if (s.prompt) lines.push(`         子任务说明：${s.prompt}`);
      });
    });
    return lines.join("\n");
  }).join("\n");

  const template = (customPrompt || PRESET_ANALYSIS_PROMPT).trim();

  return template
    .replace(/{{GOALS}}/g, () => goalLines || "（无目标）")
    .replace(/{{URL}}/g, () => page.url)
    .replace(/{{TITLE}}/g, () => page.title)
    .replace(/{{H1}}/g, () => (page.h1 ? `章节: ${page.h1}` : ""))
    .replace(/{{META}}/g, () => (page.meta ? `简介: ${page.meta}` : ""))
    .replace(/{{EXCERPT}}/g, () => page.excerpt);
}

// 结构校验与归一化：id 必须属于现有目标层级，主分类取相关度最高的一项
export function validateAnalysis(json: unknown, goals: Goal[]): AnalysisResult {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bad analysis json");
  const obj = json as Record<string, unknown>;

  const goalById = new Map(goals.map((g) => [g.id, g]));

  const rawMatches = Array.isArray(obj.matches) ? obj.matches : [];
  const parsedMatches: MatchEntry[] = [];
  for (const m of rawMatches) {
    const mo = (m ?? {}) as Record<string, unknown>;
    const goalId = typeof mo.goalId === "string" && goalById.has(mo.goalId) ? mo.goalId : null;
    if (!goalId) continue;
    const goal = goalById.get(goalId)!;
    const taskId = typeof mo.taskId === "string" && (goal.tasks || []).some((t) => t.id === mo.taskId) ? mo.taskId : null;
    if ((goal.tasks || []).length > 0 && !taskId) continue;
    const task = taskId ? (goal.tasks || []).find((t) => t.id === taskId) : undefined;
    const subtaskId = task && typeof mo.subtaskId === "string" && (task.subtasks || []).some((s) => s.id === mo.subtaskId) ? mo.subtaskId : null;

    const relevanceRaw = Number(mo.relevance);
    const relevance = Number.isFinite(relevanceRaw) ? Math.max(0, Math.min(100, Math.round(relevanceRaw))) : 0;
    if (relevance < 50) continue; // 低相关不进 matches

    const findings = Array.isArray(mo.findings)
      ? mo.findings.slice(0, 12).map((f) => truncate(String(f), 600))
      : [];
    const notes = Array.isArray(mo.notes)
      ? mo.notes.slice(0, 10).map((n): NoteEntry => {
          const no = (n ?? {}) as Record<string, unknown>;
          return {
            topic: truncate(typeof no.topic === "string" ? no.topic : "", 60),
            content: truncate(typeof no.content === "string" ? no.content : "", 2000),
            relevance,
          };
        }).filter((n) => n.topic && n.content)
      : [];
    const keyQuotes = Array.isArray(mo.keyQuotes)
      ? mo.keyQuotes.slice(0, 6).map((q): KeyQuote => {
          const qo = (q ?? {}) as Record<string, unknown>;
          return {
            quote: truncate(typeof qo.quote === "string" ? qo.quote : "", 800),
            context: truncate(typeof qo.context === "string" ? qo.context : "", 300),
          };
        }).filter((q) => q.quote)
      : [];

    parsedMatches.push({
      goalId,
      taskId,
      subtaskId,
      title: truncate(typeof mo.title === "string" ? mo.title : "", 30) || undefined,
      relevance,
      reasoning: truncate(typeof mo.reasoning === "string" ? mo.reasoning : "", 200),
      findings,
      notes,
      keyQuotes,
    });
  }

  const matches = normalizeMatches(parsedMatches);
  const main = matches[0] || null;

  // 解析顶层通用 findings / notes（当 matches 为空时用作摸鱼记录的通用分析）
  const generalFindings = Array.isArray(obj.findings)
    ? obj.findings.slice(0, 12).map((f) => truncate(String(f), 600))
    : [];
  const generalNotes = Array.isArray(obj.notes)
    ? obj.notes.slice(0, 10).map((n): NoteEntry => {
        const no = (n ?? {}) as Record<string, unknown>;
        return {
          topic: truncate(typeof no.topic === "string" ? no.topic : "", 60),
          content: truncate(typeof no.content === "string" ? no.content : "", 2000),
          relevance: 0,
        };
      }).filter((n) => n.topic && n.content)
    : [];

  return {
    relevant: matches.length > 0,
    goalId: main ? main.goalId : null,
    summary: truncate(typeof obj.summary === "string" ? obj.summary : "", 200),
    keywords: Array.isArray(obj.keywords) ? obj.keywords.slice(0, 8).map(String) : [],
    relevance: main ? main.relevance : 0,
    findings: main ? main.findings : generalFindings,
    notes: main ? main.notes : generalNotes,
    matches,
  };
}
