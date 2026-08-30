// Prompt 构造与结果校验（纯函数，Node 可测）

import { truncate } from "./utils.js";
import type { Goal, AnalysisResult, NoteEntry, MatchEntry, KeyQuote } from "../types.js";

export const PRESET_ANALYSIS_PROMPT = `你是"拾知"分析器。下面有一份网页内容和用户的工作目标清单（目标→任务→子任务三级，每级都带说明）。你的任务是为每个相关分类写出完全不同的、有针对性的深度分析。只输出 JSON。

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
步骤1：阅读每个分类的标题和说明（prompt），在心里明确每个分类的关注角度是什么。注意：子任务的说明最具体，任务次之，目标最宽泛。分析时必须以最小分类（子任务>任务>目标）的说明为准。
步骤2：对每个分类，单独判断：这份网页与该分类有关吗？只看该分类的说明，不要想其他分类。有关则 relevance >= 50，无关则跳过。
步骤3：为每个相关分类，从头写一套全新的 title / findings / notes / keyQuotes。写的时候只关注该分类的角度，完全忘掉其他分类。两套分析之间不允许共享任何 finding、note 或 quote。
步骤4：输出前自检——如果某条 finding 或 note 贴到另一个 match 里也成立，说明你没有做到独立分析，必须重写。

[输出格式]
只输出 JSON（不要输出任何其他内容）：
{"summary":"80字以内页面摘要（通用，不偏向任何分类）","keywords":["关键词"],"findings":["通用关键发现1","通用关键发现2"],"notes":[{"topic":"通用主题","content":"详细笔记"}],"keyQuotes":[{"quote":"原文关键句","context":"上下文"}],"matches":[{"goalId":"g_xxx","taskId":"t_xxx或null","subtaskId":"s_xxx或null","title":"根据该分类主题重写的标题（15字以内）","relevance":0,"reasoning":"为什么与该分类相关","findings":["分类视角发现1","分类视角发现2"],"notes":[{"topic":"分类主题","content":"分类视角笔记"}],"keyQuotes":[{"quote":"原文关键句","context":"上下文"}]}]}

[规则]
1. 一个网页可以匹配 0 个、1 个或多个分类；与所有分类都无关时 matches 返回空数组 []。
2. 尽量归到最细层级：能确定到子任务就填 subtaskId（同时填 taskId、goalId），能确定到任务就填 taskId（同时填 goalId），否则只填 goalId。
3. relevance 表示网页与该分类的相关程度，0=完全无关，100=高度相关；低于 50 的不要放进 matches。
4. 【最关键】每个 match 的 title / findings / notes / keyQuotes 必须完全不同。不同分类的关注角度由各自的"说明"（prompt）定义，你应从该分类的视角审视网页。
5. title 必须根据该分类的主题重新提炼，不要直接复制网页原标题。标题要精准概括"这个网页对该分类有什么价值"，15字以内，超出用省略号。这是用户第一眼看到的内容，必须一针见血。
6. 判断"什么是有价值的信息"时，以该分类的说明为准。分类说明里写了关注什么主题、什么关键词——你就据此提取。不要写一个"通用版"然后复制给多个分类。
7. match 里的 findings 写该分类视角下的关键信息点。允许详细展开，1 条 finding 可以写 1-4 句话。信息量大的页面可以写到 8-10 条。禁止写"在不同领域有应用""具有重要价值"这类空话。
8. match 里的 notes 按主题拆分，每个主题一条。content 先引用原文关键句（用引号），紧接着写分析——这个信息在该分类视角下为什么有价值。允许详细展开，3-10 句话都可以。
9. match 里的 keyQuotes 尽量多提供，最多 6 条。quote 必须逐字来自网页正文，不得改写。
10. reasoning 必须引用网页里的具体内容说明为什么与该分类相关。
11. 【摸鱼场景通用分析】当 matches 为空时（页面与所有目标都不相关，归入"摸鱼"），必须在顶层输出 findings / notes / keyQuotes。这些是"不针对任何分类"的通用分析：
    - findings：从整页内容中提炼的关键信息点，写法同 match findings，必须写得充实完整
    - notes：按主题拆分的通用笔记，写法同 match notes
    - keyQuotes：页面中最有价值的关键引用
    当 matches 不为空时，顶层 findings / notes / keyQuotes 可选，以 match 里的内容为准。
12. 内容丰富的网页，请充分利用输出空间，不要刻意精简。
13. 拿不准是否相关时，宁可判定为不相关。

[错误示例——绝对禁止]
下面的输出是错误的，因为两个 match 的分析内容完全一样，只是把 goalId 换了：
{"matches":[
  {"goalId":"g1","taskId":null,"subtaskId":null,"title":"skill相关页面","relevance":85,"reasoning":"页面包含skill相关内容","findings":["页面讨论了skill的运营和推广"],"notes":[{"topic":"skill运营","content":"页面包含skill运营相关信息"}]},
  {"goalId":"g2","taskId":null,"subtaskId":null,"title":"skill相关页面","relevance":80,"reasoning":"页面包含skill相关内容","findings":["页面讨论了skill的运营和推广"],"notes":[{"topic":"skill运营","content":"页面包含skill运营相关信息"}]}
]}

[正确示例]
如果 g1 的说明是"skill白鼠鼠账号运营情况"，g2 的说明是"记录有趣的skill"：
- g1 的 match 应聚焦：白鼠鼠是谁、账号数据、运营策略、发布频率、互动效果
  title 示例："白鼠鼠账号运营数据盘点"
- g2 的 match 应聚焦：skill 本身的功能设计、有趣的使用场景、创新点、用户评价
  title 示例："Ace Studio 多模态创作功能亮点"
两者内容必须完全不同，不能互换。`;

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
  const matches: MatchEntry[] = [];
  for (const m of rawMatches) {
    const mo = (m ?? {}) as Record<string, unknown>;
    const goalId = typeof mo.goalId === "string" && goalById.has(mo.goalId) ? mo.goalId : null;
    if (!goalId) continue;
    const goal = goalById.get(goalId)!;
    const taskId = typeof mo.taskId === "string" && (goal.tasks || []).some((t) => t.id === mo.taskId) ? mo.taskId : null;
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

    matches.push({
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

  matches.sort((a, b) => b.relevance - a.relevance);
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
