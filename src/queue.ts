// 分析队列（串行/退避/持久化）与单次 LLM 合并调用

import { K } from "./core/constants.js";
import { backoffMs, sleep, parseJsonLoose, uid } from "./core/utils.js";
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
    // 先给没有 todo 的旧 task 自动补齐 todo
    syncTodos(g);
    // 更新各命中 task 的 todo coverage
    updateTodoCoverage(g, rec);
    // 更新搜索词：将记录关键词补充到该 goal 下最需资料的 open todo
    updateSearchTerms(g, rec);
    Store.write(K.goals, allGoals);
  } else {
    Panel.toast("已归入摸鱼", "idle");
  }
}

function updateSearchTerms(goal: Goal, rec: BrowseRecord): void {
  const todos = goal.todos || [];
  if (!todos.length) return;
  // 找 coverage 最低且 open 的 todo
  const candidates = todos.filter((t) => t.status === "open").sort((a, b) => (a.coverage || 0) - (b.coverage || 0));
  const target = candidates[0];
  if (!target) return;
  const newTerms = (rec.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (!newTerms.length) return;
  const existing = new Set((target.searchTerms || []).map((s) => String(s).trim()));
  const arr = target.searchTerms || [];
  for (const term of newTerms) {
    if (!existing.has(term)) {
      arr.push(term);
      existing.add(term);
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
    };
    goal.todos.push(todo);
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
