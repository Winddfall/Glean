// 分析队列（串行/退避/持久化）与单次 LLM 合并调用

import { K } from "./core/constants.js";
import { backoffMs, sleep, parseJsonLoose, uid, normalizeSearchTerm } from "./core/utils.js";
import { buildPagePrompt, validateAnalysis } from "./core/prompt.js";
import { Store, settings } from "./store.js";
import { Panel } from "./panel/panel.js";
import type { QueueItem, BrowseRecord, Goal, Todo } from "./types.js";

let pumping = false;

export async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const q = Store.read<QueueItem[]>(K.queue, []);
      const now = Date.now();
      const item = q.find((i) => (i.nextAt || 0) <= now);
      if (!item) break;
      const recs = Store.read<BrowseRecord[]>(K.records, []);
      const rec = recs.find((r) => r.id === item.recordId);
      if (!rec) {
        Store.write(K.queue, q.filter((i) => i.recordId !== item.recordId));
        continue;
      }
      try {
        await analyze(rec, item);
        Store.write(K.records, recs);
        Store.write(K.queue, Store.read<QueueItem[]>(K.queue, []).filter((i) => i.recordId !== item.recordId));
        Panel.render();
        await sleep(settings().queueGapMs);
      } catch (e) {
        item.retries = (item.retries || 0) + 1;
        if (item.retries > 3) {
          rec.category = "error";
          rec.excerpt = item.excerpt; // 留存摘录供手动重试
          Store.write(K.records, recs);
          Store.write(K.queue, Store.read<QueueItem[]>(K.queue, []).filter((i) => i.recordId !== item.recordId));
          Panel.render();
        } else {
          item.nextAt = Date.now() + backoffMs(item.retries);
          Store.write(K.queue, q);
          break; // 交给定时器续泵，避免限流时连打
        }
      }
    }
  } finally {
    pumping = false;
  }
}

async function analyze(rec: BrowseRecord, item: QueueItem): Promise<void> {
  const allGoals = Store.read<Goal[]>(K.goals, []);
  const goals = allGoals.filter((g) => g.status === "active");
  const prompt = buildPagePrompt(
    { url: rec.url, title: rec.title, h1: rec.h1, meta: rec.meta, excerpt: item.excerpt },
    goals,
    settings().analysisPrompt || undefined
  );
  const raw = await LLMBridge!.chat(prompt, "json");
  const res = validateAnalysis(parseJsonLoose(raw), goals);
  rec.summary = res.summary;
  rec.keywords = res.keywords;
  rec.relevance = res.relevance;
  rec.findings = res.findings;
  rec.notes = res.notes;
  rec.matches = res.matches;
  rec.category = res.relevant && res.goalId ? "goal:" + res.goalId : "slacking";
  const g = goals.find((x) => x.id === res.goalId);
  if (res.relevant && g) {
    const extra = res.matches.length > 1 ? "（共命中 " + res.matches.length + " 个分类）" : "";
    Panel.toast("已归档至：" + g.title + extra, "ok");
    // 一条记录可命中多个目标：逐目标同步 todo、更新 coverage 与搜索词
    const matchedGoalIds = [...new Set(res.matches.map((m) => m.goalId).filter(Boolean))];
    for (const goalId of matchedGoalIds) {
      const goal = goals.find((x) => x.id === goalId);
      if (!goal) continue;
      // 先给没有 todo 的旧 task 自动补齐 todo
      syncTodos(goal);
      // 更新各命中 task 的 todo coverage
      updateTodoCoverage(goal, rec);
      // 更新搜索词：将记录关键词补充到该 goal 下最需资料的 open todo
      updateSearchTerms(goal, rec);
    }
    Store.write(K.goals, allGoals);
  } else {
    Panel.toast("已归入摸鱼", "idle");
  }
}

function updateSearchTerms(goal: Goal, rec: BrowseRecord): void {
  const todos = goal.todos || [];
  if (!todos.length) return;
  // 把 rec.keywords 包装成 SearchTerm 对象（display=query=关键词）
  const newTerms = (rec.keywords || []).map((k) => {
    const q = String(k).trim();
    return { display: q, query: q };
  }).filter((t) => t.query);

  // 只处理 open 状态的 todo
  const openTodos = todos.filter((t) => t.status === "open");
  if (!openTodos.length) return;

  // 先确保每个 open todo 至少有基础搜索词（即使 newTerms 为空也保底）
  for (const todo of openTodos) {
    const arr = (todo.searchTerms || []).filter((s) => normalizeSearchTerm(s).query);
    if (!arr.length) {
      const base = (newTerms[0] && newTerms[0].query) || todo.text || goal.title || "搜索";
      arr.push({ display: base, query: base });
    }
    todo.searchTerms = arr;
  }

  // 如果 newTerms 为空，到此为止
  if (!newTerms.length) return;

  // 然后把新关键词补充给 coverage 最低的 todo（保持原有"聚焦最需要资料的 todo"策略）
  openTodos.sort((a, b) => (a.coverage || 0) - (b.coverage || 0));
  const target = openTodos[0];
  const existing = new Set((target.searchTerms || []).map((s) => normalizeSearchTerm(s).query));
  const arr = target.searchTerms || [];
  for (const term of newTerms) {
    if (!existing.has(term.query)) {
      arr.push(term);
      existing.add(term.query);
    }
  }
  // 限制最多保留 6 个，保留最新的
  target.searchTerms = arr.length > 6 ? arr.slice(-6) : arr;
}

function syncTodos(goal: Goal): void {
  if (!goal.tasks?.length) return;
  const existing = new Set((goal.todos || []).map((t) => t.taskId).filter(Boolean));
  for (const task of goal.tasks) {
    if (existing.has(task.id)) continue;
    goal.todos = goal.todos || [];
    const todo: Todo = {
      id: uid("todo"),
      text: task.title,
      taskId: task.id,
      contrib: {},
      coverage: 0,
      status: "open",
      manual: false,
      searchTerms: (task.searchTerms || []).slice(0, 3),
    };
    goal.todos.push(todo);
  }
  // 给已有但缺少 searchTerms 的 open todo 补充保底词（兼容旧数据）
  for (const todo of goal.todos || []) {
    const validTerms = (todo.searchTerms || []).filter((s) => normalizeSearchTerm(s).query);
    // 持久化过滤结果，清除空 term 对象，避免脏数据残留
    todo.searchTerms = validTerms;
    if (todo.status === "open" && !validTerms.length) {
      const task = goal.tasks.find((t) => t.id === todo.taskId);
      const taskTerms = (task?.searchTerms || []).filter((s) => normalizeSearchTerm(s).query);
      if (taskTerms.length) {
        todo.searchTerms = taskTerms.slice(0, 3);
      } else {
        const base = todo.text || goal.title || "搜索";
        todo.searchTerms = [{ display: base, query: base }];
      }
    }
  }
}

function updateTodoCoverage(goal: Goal, rec: BrowseRecord): void {
  if (!rec.matches?.length) return;
  for (const m of rec.matches) {
    if (!m.taskId) continue;
    const todo = goal.todos?.find((t) => t.taskId === m.taskId);
    if (!todo) continue;
    const inc = (m.relevance / 100) * 0.15; // 每次命中最多增加 15%
    todo.coverage = Math.min(1, (todo.coverage || 0) + inc);
    // coverage 达到 90% 自动标记为完成，让后续搜索词替补给下一个 todo
    if (todo.coverage >= 0.9) todo.status = "done";
  }
  // 额外：遍历所有 open todo，coverage 已 >= 0.9 的也一并标记（兜底，防止遗漏）
  for (const t of goal.todos || []) {
    if (t.status === "open" && t.coverage >= 0.9) t.status = "done";
  }
}
