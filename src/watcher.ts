// 页面监听：初始加载 + SPA 跳转 + 停留判定 + 去重落记录

import { K } from "./core/constants.js";
import { fnv1a, truncate, uid } from "./core/utils.js";
import { Store, settings, getState } from "./store.js";
import { extractPage } from "./extract.js";
import { Panel } from "./panel.js";
import { pumpQueue } from "./queue.js";
import type { BrowseRecord, Goal, QueueItem } from "./types.js";

let settleTimer: ReturnType<typeof setTimeout> | 0 = 0;
let dwellTimer: ReturnType<typeof setTimeout> | 0 = 0;
let visListener: (() => void) | null = null;

export function onLocationChange(): void {
  clearTimeout(settleTimer);
  clearTimeout(dwellTimer);
  settleTimer = setTimeout(armDwell, settings().settleMs);
}

function armDwell(): void {
  if (document.visibilityState !== "visible") {
    if (!visListener) {
      const cb = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", cb);
          visListener = null;
          dwellTimer = setTimeout(capture, settings().dwellMs);
        }
      };
      visListener = cb;
      document.addEventListener("visibilitychange", cb);
    }
    return;
  }
  dwellTimer = setTimeout(capture, settings().dwellMs);
}

function capture(): void {
  const st = getState();
  if (!st.workMode) return; // 模式闸
  const goals = Store.read<Goal[]>(K.goals, []).filter((g) => g.status === "active");
  if (!goals.length) return; // 目标闸
  if (settings().excludedSites.some((x) => location.href.includes(x))) return; // 站点闸
  if (document.visibilityState !== "visible") return;
  // 提取页面信息
  const page = extractPage();
  if (!page.text || page.text.length < 100) return;
  const hash = fnv1a(page.url.split("#")[0] + "|" + page.text.slice(0, 500));
  const recs = Store.read<BrowseRecord[]>(K.records, []);
  const now = Date.now();
  if (recs.some((r) => r.url === page.url)) return; // 去重闸
  const rec: BrowseRecord = {
    id: uid("r"),
    url: page.url,
    origin: page.origin,
    title: page.title,
    h1: page.h1,
    meta: page.meta,
    capturedAt: now,
    excerptHash: hash,
    preview: truncate(page.text.replace(/\s+/g, " "), 160),
    category: "pending", summary: "", keywords: [],
  };
  recs.unshift(rec);
  Store.write(K.records, recs.slice(0, settings().recordCap));
  const q = Store.read<QueueItem[]>(K.queue, []);
  q.push({ recordId: rec.id, excerpt: page.text, retries: 0, nextAt: 0 });
  Store.write(K.queue, q);
  Panel.render();
  pumpQueue();
}

export function captureCurrent(): void {
  const st = getState();
  if (!st.workMode) return;
  const goals = Store.read<Goal[]>(K.goals, []).filter((g) => g.status === "active");
  if (!goals.length) return;
  if (settings().excludedSites.some((x) => location.href.includes(x))) return;
  if (document.visibilityState !== "visible") return;
  const page = extractPage();
  if (!page.text || page.text.length < 100) return;
  const hash = fnv1a(page.url.split("#")[0] + "|" + page.text.slice(0, 500));
  const recs = Store.read<BrowseRecord[]>(K.records, []);
  const now = Date.now();
  if (recs.some((r) => r.url === page.url)) return;
  const rec: BrowseRecord = {
    id: uid("r"),
    url: page.url,
    origin: page.origin,
    title: page.title,
    h1: page.h1,
    meta: page.meta,
    capturedAt: now,
    excerptHash: hash,
    preview: truncate(page.text.replace(/\s+/g, " "), 160),
    category: "pending", summary: "", keywords: [],
  };
  recs.unshift(rec);
  Store.write(K.records, recs.slice(0, settings().recordCap));
  const q = Store.read<QueueItem[]>(K.queue, []);
  q.push({ recordId: rec.id, excerpt: page.text, retries: 0, nextAt: 0 });
  Store.write(K.queue, q);
  Panel.render();
  pumpQueue();
}

export function hookHistory(): void {
  try {
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m as "pushState" | "replaceState"];
      history[m as "pushState" | "replaceState"] = function (...args: any[]) {
        const r = (orig as Function).apply(this, args);
        onLocationChange();
        return r;
      };
    }
    addEventListener("popstate", onLocationChange);
    addEventListener("hashchange", onLocationChange);
    const t = document.querySelector("title");
    if (t) new MutationObserver(() => onLocationChange()).observe(t, { childList: true });
  } catch (e) { /* 页面冻结原型时静默降级：仅初始加载可记录 */ }
}
