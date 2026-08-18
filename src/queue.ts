// 分析队列（串行/退避/持久化）与单次 LLM 合并调用

import { K } from "./core/constants.js";
import { backoffMs, sleep, parseJsonLoose } from "./core/utils.js";
import { buildPagePrompt, validateAnalysis } from "./core/prompt.js";
import { Store, settings } from "./store.js";
import { Panel } from "./panel.js";
import type { QueueItem, BrowseRecord, Goal } from "./types.js";

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
        Store.write(K.queue, Store.read(K.queue, []).filter((i) => i.recordId !== item.recordId));
        Panel.render();
        await sleep(settings().queueGapMs);
      } catch (e) {
        item.retries = (item.retries || 0) + 1;
        if (item.retries > 3) {
          rec.category = "error";
          rec.excerpt = item.excerpt; // 留存摘录供手动重试
          Store.write(K.records, recs);
          Store.write(K.queue, Store.read(K.queue, []).filter((i) => i.recordId !== item.recordId));
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
  const goals = Store.read<Goal[]>(K.goals, []).filter((g) => g.status === "active");
  const prompt = buildPagePrompt(
    { url: rec.url, title: rec.title, h1: rec.h1, meta: rec.meta, excerpt: item.excerpt },
    goals
  );
  const raw = await LLMBridge!.chat(prompt, "json");
  const res = validateAnalysis(parseJsonLoose(raw), goals);
  rec.summary = res.summary;
  rec.keywords = res.keywords;
  rec.relevance = res.relevance;
  rec.findings = res.findings;
  rec.notes = res.notes;
  rec.category = res.relevant && res.goalId ? "goal:" + res.goalId : "slacking";
  const g = goals.find((x) => x.id === res.goalId);
  Panel.toast(res.relevant && g ? "已归档至：" + g.title : "已归入摸鱼", res.relevant && g ? "ok" : "idle");
}
