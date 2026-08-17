// 拾知入口：组装模块、启动监听

import { K } from "./core/constants.js";
import { Store } from "./store.js";
import { Panel } from "./panel.js";
import { hookHistory, onLocationChange } from "./watcher.js";
import { pumpQueue } from "./queue.js";

function boot(): void {
  hookHistory();
  Panel.mount();
  addEventListener("storage", (e) => {
    if (e.key && e.key.indexOf("shizhi.") === 0) Panel.render(); // 同源多标签联动
  });
  onLocationChange();
  pumpQueue();
  setInterval(pumpQueue, 10000);
}

// 防重复注入 + 非 Tabbit 环境静默退出
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (!window.__shizhiLoaded && typeof LLMBridge !== "undefined") {
    window.__shizhiLoaded = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }
}

// Node 测试导出
export { K, Store, Panel, onLocationChange, pumpQueue };
