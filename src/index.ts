// 拾知入口：组装模块、启动监听

import { K } from "./core/constants.js";
import { Store } from "./store.js";
import { Panel } from "./panel.js";
import { hookHistory, onLocationChange, captureCurrent } from "./watcher.js"; 
import { pumpQueue } from "./queue.js";

function boot(): void {
  hookHistory();
  Panel.mount();
  addEventListener("storage", (e) => {
    if (e.key && e.key.indexOf("shizhi.") === 0) Panel.render(); // 同源多标签联动
  });
  captureCurrent(); // 立即尝试记录当前页面
  onLocationChange();
  pumpQueue();
  setInterval(pumpQueue, 10000);
}

// 防重复注入。只要在浏览器环境就挂载 UI，不把 LLMBridge 作为启动门槛：
// Tabbit 可能异步注入 LLMBridge（脚本执行后才可用），若在此处判断会静默退出、
// 连入口按钮都不出现。队列分析依赖 LLMBridge，但 pumpQueue 内部有 try/catch
// 退避，LLMBridge 未就绪时只会退避重试，不会崩溃；就绪后由定时器自动恢复。
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
