// 拾知入口：组装模块、启动监听

import { K } from "./core/constants.js";
import { Store } from "./store.js";
import { Panel } from "./panel/panel.js";
import { hookHistory, onLocationChange } from "./watcher.js";
import { pumpQueue } from "./queue.js";
import { initDshAskReceiver } from "./dsh.js";
import { initTabbitAutocomplete } from "./autocomplete/homeInput.js";
import { normalizeMatches, syncRecordPrimaryMatch } from "./core/matches.js";
import type { BrowseRecord } from "./types.js";

function migrateStoredRecordMatches(): void {
  const records = Store.read<BrowseRecord[]>(K.records, []);
  let changed = false;
  for (const record of records) {
    if (!record.matches?.length) continue;
    const previous = record.matches;
    const normalized = normalizeMatches(previous);
    const same = normalized.length === previous.length && normalized.every((match, index) => match === previous[index]);
    if (same) continue;
    record.matches = normalized;
    if (record.category !== "pending" && record.category !== "error") syncRecordPrimaryMatch(record);
    changed = true;
  }
  if (changed) Store.write(K.records, records);
}

function boot(): void {
  migrateStoredRecordMatches();
  hookHistory();
  Panel.mount();
  addEventListener("storage", (e) => {
    if (e.key && e.key.indexOf("shizhi.") === 0) Panel.render(); // 同源多标签联动
  });
  onLocationChange();
  pumpQueue();
  setInterval(pumpQueue, 10000);
}

// 防重复注入。LLMBridge 就绪后才挂载 UI（Tabbit 注入 LLMBridge 后再加载本脚本）；
// 若 LLMBridge 缺失则静默退出，连入口按钮都不出现。
// 例外：「问问 DeepSeek Harness」的 hash 接收逻辑在 dsh 页面也要工作，
// 而 dsh 页面（127.0.0.1:3080）可能没有 LLMBridge，故独立于面板启动。
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (!window.__shizhiLoaded) {
    window.__shizhiLoaded = true;
    initDshAskReceiver();
    if (typeof LLMBridge !== "undefined") {
      const start = () => {
        boot();
        initTabbitAutocomplete();
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
      } else {
        start();
      }
    }
  }
}

// Node 测试导出
export { K, Store, Panel, onLocationChange, pumpQueue };
