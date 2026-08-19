// 面板 UI（Shadow DOM）：目标/记录/画像/设置 四 Tab + 独立 todo 气泡 + 面板 resize
// 说明：本模块只做前端交互与视觉，不修改后端（采集/分析/队列）逻辑。

import { K } from "./core/constants.js";
import { esc, uid } from "./core/utils.js";
import { Store, getState, settings } from "./store.js";
import { onLocationChange } from "./watcher.js";
import { pumpQueue } from "./queue.js";
import { PRESET_ANALYSIS_PROMPT } from "./core/prompt.js";
import type { Goal, Task, Subtask, Todo, BrowseRecord, MatchEntry, NoteEntry, KeyQuote, Profile, Settings, QueueItem } from "./types.js";

// 内置站点搜索 URL 模板：用户填裸域名（无 {q} 且无路径）时，自动映射到该站点的搜索结果页，实现一键跳转并搜索。
// 模板按域名匹配，命中后 {q} 会被搜索词替换。
const SEARCH_TEMPLATES: { hosts: string[]; template: string }[] = [
  { hosts: ["zhihu.com", "www.zhihu.com"], template: "https://www.zhihu.com/search?type=content&q={q}" },
  { hosts: ["wikipedia.org", "zh.wikipedia.org", "en.wikipedia.org"], template: "https://zh.wikipedia.org/w/index.php?search={q}" },
  { hosts: ["csdn.net", "so.csdn.net"], template: "https://so.csdn.net/so/search?q={q}" },
  { hosts: ["juejin.cn"], template: "https://juejin.cn/search?query={q}" },
  { hosts: ["read.douban.com"], template: "https://read.douban.com/search?q={q}" },
  { hosts: ["medium.com"], template: "https://medium.com/search?q={q}" },
  { hosts: ["weixin.sogou.com"], template: "https://weixin.sogou.com/weixin?type=2&query={q}" },
];

// 根据关联网址解析出最终跳转 URL：优先用 {q} 占位符，其次匹配内置站点模板，最后回退到原网址。
function resolveLinkedUrl(raw: string): { url: string; usedTemplate: boolean } {
  let url = (raw || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  if (!url) return { url: "", usedTemplate: false };
  // 已带占位符：直接使用
  if (url.includes("{q}")) return { url, usedTemplate: false };
  // 裸域名匹配内置模板（仅当没有路径，即 / 之后为空，避免误伤带路径的用户自定义网址）
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { url, usedTemplate: false }; }
  const hasPath = new URL(url).pathname !== "/";
  if (!hasPath) {
    const tpl = SEARCH_TEMPLATES.find((t) => t.hosts.includes(host));
    if (tpl) return { url: tpl.template, usedTemplate: true };
  }
  return { url, usedTemplate: false };
}

const ICONS = {
  bulb: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  drag: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  todo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m3 6 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 18 1 1 2-2"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};

// 去 AI 味的设计语言：中性暖灰 + 单一墨绿强调色，系统字体，极简阴影
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
:host {
  --bg: #fafaf9;
  --surface: #ffffff;
  --fg: #1c1917;
  --muted: #78716c;
  --faint: #a8a29e;
  --border: #e7e5e4;
  --border-strong: #d6d3d1;
  --accent: #0f766e;
  --accent-soft: #f0fdfa;
  --high: #16a34a;
  --med: #d97706;
  --low: #dc2626;
  --radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.5;
}
button { font-family: inherit; }

.sz-fab { position: fixed; right: 16px; bottom: 16px; width: 40px; height: 40px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 1px 3px rgba(0,0,0,.08); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483000; color: var(--muted); padding: 0; transition: color .15s, border-color .15s; }
.sz-fab:hover { color: var(--fg); border-color: var(--muted); }
.sz-fab.on { color: var(--accent); border-color: var(--accent); }

.sz-panel { position: fixed; right: 16px; bottom: 64px; width: 380px; max-width: 90vw; max-height: 72vh; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.12); display: none; flex-direction: column; z-index: 2147483000; overflow: hidden; }
.sz-panel.open { display: flex; }

.sz-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.sz-title { font-size: 14px; font-weight: 650; flex: 1; letter-spacing: .2px; }
.sz-mode { color: var(--muted); font-size: 12px; }
.sz-switch { position: relative; width: 32px; height: 18px; appearance: none; -webkit-appearance: none; background: var(--border-strong); border-radius: 999px; cursor: pointer; transition: background .15s; margin: 0; flex: none; }
.sz-switch:checked { background: var(--accent); }
.sz-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
.sz-switch:checked::after { left: 16px; }

.sz-tabs { display: flex; padding: 6px 8px 0; border-bottom: 1px solid var(--border); }
.sz-tab { flex: 1; padding: 6px 0; text-align: center; cursor: pointer; color: var(--muted); background: none; border: none; font-size: 13px; position: relative; }
.sz-tab.act { color: var(--fg); font-weight: 600; }
.sz-tab.act::after { content: ""; position: absolute; left: 50%; transform: translateX(-50%); bottom: -1px; width: 22px; height: 2px; background: var(--accent); border-radius: 2px; }

.sz-body { padding: 10px 12px; overflow-y: auto; flex: 1; min-height: 140px; }

.sz-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
.sz-foot-label { color: var(--muted); font-size: 11px; flex: none; }

.sz-input { flex: 1; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius); font-size: 13px; outline: none; min-width: 0; color: var(--fg); background: #fff; }
.sz-input:focus { border-color: var(--accent); }
.sz-input::placeholder { color: var(--faint); }

.sz-ibtn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: var(--radius); color: var(--muted); cursor: pointer; padding: 0; flex: none; }
.sz-ibtn:hover { background: #f5f5f4; color: var(--fg); }
.sz-ibtn.danger:hover { background: #fef2f2; color: var(--low); }

.sz-empty { color: var(--faint); text-align: center; padding: 28px 12px; font-size: 12px; }
.sz-sec { display: flex; align-items: center; gap: 6px; font-weight: 600; margin: 12px 0 4px; font-size: 12px; color: var(--muted); }
.sz-sec:first-child { margin-top: 0; }
.sz-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sz-count { color: var(--faint); font-weight: 400; }

/* 目标三级树 */
.sz-node { border-bottom: 1px solid #f5f5f4; }
.sz-node:last-child { border-bottom: none; }
.sz-row { display: flex; align-items: center; gap: 4px; padding: 5px 2px; }
.sz-row:hover { background: #fafaf9; }
.sz-row.dragover { background: var(--accent-soft); outline: 1px dashed var(--accent); outline-offset: -1px; }
.sz-grip { color: var(--faint); cursor: grab; display: flex; flex: none; opacity: 0; }
.sz-row:hover .sz-grip { opacity: 1; }
.sz-grip:active { cursor: grabbing; }
.sz-ntitle { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-ntitle.done { color: var(--faint); text-decoration: line-through; }
.sz-children { margin-left: 18px; padding-left: 10px; border-left: 1px solid var(--border); }
.sz-caret { width: 14px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--faint); cursor: pointer; padding: 0; flex: none; transition: transform .15s; }
.sz-caret:hover { color: var(--muted); }
.sz-caret { transform: rotate(-90deg); }
.sz-caret.open { transform: rotate(0deg); }
.sz-caret-spacer { width: 14px; flex: none; }
.sz-prompt { display: flex; align-items: center; gap: 4px; margin: -2px 0 4px 18px; padding: 2px 6px; font-size: 11px; color: var(--muted); cursor: pointer; border-radius: 4px; }
.sz-prompt:hover { background: var(--accent-soft); color: var(--accent); }
.sz-prompt.empty { color: var(--faint); font-style: italic; }
.sz-prompt svg { flex: none; opacity: .7; }
.sz-prompt-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-prompt-edit { margin: 0 0 6px 18px; }
.sz-prompt-actions { display: flex; gap: 6px; margin-top: 4px; }
.sz-ai-confirm { border: 1px solid var(--accent); background: var(--accent-soft); border-radius: 10px; padding: 10px; margin-bottom: 10px; }
.sz-ai-head { font-size: 13px; font-weight: 600; color: var(--accent); margin-bottom: 8px; }
.sz-ai-confirm .sz-input, .sz-ai-confirm .sz-textarea { margin-bottom: 6px; }
.sz-ai-tasks { margin-top: 8px; }
.sz-ai-task { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px; margin-bottom: 6px; }
.sz-ai-task-head { margin-bottom: 4px; }
.sz-ai-num { font-size: 11px; font-weight: 600; color: var(--muted); }
.sz-ai-ta { min-height: 44px; }
.sz-ai-sub { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
.sz-ai-sub-dot { color: var(--accent); flex: none; }
.sz-ai-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.sz-ai-actions .sz-btn { padding: 4px 10px; font-size: 11px; }
.sz-ai-actions .sz-btn.primary { background: var(--high); border-color: var(--high); }
.sz-ai-actions .sz-btn.primary:hover { background: #15803d; }

/* 记录列表 */
.sz-rec { border-bottom: 1px solid #f5f5f4; }
.sz-rec:last-child { border-bottom: none; }
.sz-rechead { display: flex; align-items: center; gap: 6px; padding: 7px 2px; cursor: pointer; }
.sz-rel { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sz-rel.high { background: var(--high); }
.sz-rel.med { background: var(--med); }
.sz-rel.low { background: var(--low); }
.sz-rel.none { background: var(--border-strong); }
.sz-rel.none.breath { animation: szBreath 1.6s ease-in-out infinite; }
@keyframes szBreath { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.sz-rurl { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); font-size: 12px; }
.sz-rtime { color: var(--faint); font-size: 11px; flex: none; }
.sz-rcaret { color: var(--faint); flex: none; transition: transform .15s; display: flex; }
.sz-rec.open .sz-rcaret { transform: rotate(180deg); }
.sz-rbody { display: none; padding: 2px 2px 10px 16px; }
.sz-rec.open .sz-rbody { display: block; }
.sz-rtitle { color: var(--fg); font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.sz-rsum { color: var(--muted); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.sz-rsum.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.sz-kw { display: inline-block; font-size: 11px; color: var(--muted); background: #f5f5f4; border-radius: 4px; padding: 1px 6px; margin: 6px 4px 0 0; }
.sz-findings { margin-top: 8px; }
.sz-findings .h { font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 3px; }
.sz-finding { display: flex; gap: 5px; font-size: 12px; color: var(--fg); margin-bottom: 2px; }
.sz-finding::before { content: "·"; color: var(--accent); flex: none; }
.sz-note { margin-top: 8px; padding: 6px 8px; background: #fafaf9; border: 1px solid #f0f0ee; border-radius: var(--radius); }
.sz-note .t { font-size: 12px; font-weight: 600; color: var(--fg); margin-bottom: 2px; }
.sz-note .c { font-size: 12px; color: var(--muted); white-space: pre-wrap; word-break: break-word; }
.sz-racting { display: flex; gap: 12px; margin-top: 8px; }
.sz-rlink { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); font-size: 12px; text-decoration: none; cursor: pointer; }
.sz-rlink:hover { text-decoration: underline; }
.sz-rbtn { display: inline-flex; align-items: center; gap: 3px; color: var(--muted); font-size: 12px; background: none; border: none; cursor: pointer; padding: 0; }
.sz-rbtn:hover { color: var(--low); }
.sz-pending-hint { color: var(--faint); font-size: 12px; padding: 6px 0; }
.sz-retry { font-size: 11px; color: var(--low); border: 1px solid #fecaca; border-radius: 4px; background: #fff; cursor: pointer; padding: 1px 8px; margin-top: 6px; }
.sz-retry:hover { background: #fef2f2; }

.sz-toolbar { display: flex; gap: 6px; margin-bottom: 8px; }
.sz-search { flex: 1; }
.sz-seg { display: flex; border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; flex: none; }
.sz-seg button { background: #fff; border: none; padding: 4px 10px; font-size: 12px; color: var(--muted); cursor: pointer; }
.sz-seg button.act { background: #f5f5f4; color: var(--fg); font-weight: 600; }
.sz-seg button + button { border-left: 1px solid var(--border-strong); }
.sz-filterbar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding: 6px 10px; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: var(--radius); }
.sz-filter-name { flex: 1; font-size: 12px; color: var(--accent); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-ntitle.clickable { cursor: pointer; }
.sz-ntitle.clickable:hover { color: var(--accent); }

/* 导出浮层 */
.sz-pop { position: absolute; right: 0; top: calc(100% + 6px); background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0,0,0,.12); z-index: 10; min-width: 160px; padding: 4px; }
.sz-pop-item { display: block; width: 100%; text-align: left; background: none; border: none; padding: 7px 10px; font-size: 13px; color: var(--fg); cursor: pointer; border-radius: 4px; }
.sz-pop-item:hover { background: #f5f5f4; }

/* todo 独立气泡 */
.sz-todo { position: fixed; right: 64px; bottom: 16px; z-index: 2147482999; }
.sz-todo-bar { display: flex; align-items: center; gap: 6px; max-width: 300px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 999px; box-shadow: 0 1px 4px rgba(0,0,0,.1); padding: 7px 12px; cursor: pointer; color: var(--fg); font-size: 12px; }
.sz-todo-bar:hover { border-color: var(--accent); }
.sz-todo-bar .sz-dot { width: 7px; height: 7px; }
.sz-todo-bar .txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-todo-pop { position: absolute; right: 0; bottom: calc(100% + 8px); width: 300px; max-height: 300px; overflow-y: auto; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.14); display: none; }
.sz-todo-pop.open { display: block; }
.sz-todo-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.sz-todo-list { padding: 6px 12px 10px; }
.sz-todo-item { padding: 8px 0; border-bottom: 1px solid #f5f5f4; }
.sz-todo-item:last-child { border-bottom: none; }
.sz-todo-text { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px; }
.sz-todo-text .t { flex: 1; }
.sz-bar { height: 4px; background: #f5f5f4; border-radius: 2px; overflow: hidden; }
.sz-bar > i { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
.sz-todo-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 3px; font-size: 11px; color: var(--faint); }
.sz-copy { display: inline-flex; align-items: center; gap: 3px; background: none; border: none; color: var(--accent); font-size: 11px; cursor: pointer; padding: 0; }
.sz-copy:hover { text-decoration: underline; }

.sz-ctxmenu { position: fixed; z-index: 2147483002; min-width: 140px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0,0,0,.14); padding: 4px; display: none; }
.sz-ctxmenu.open { display: block; }
.sz-ctxmenu-item { display: block; width: 100%; text-align: left; background: none; border: none; padding: 7px 10px; font-size: 13px; color: var(--fg); cursor: pointer; border-radius: 4px; }
.sz-ctxmenu-item:hover { background: #f5f5f4; }
.sz-ctxmenu-item:disabled { color: var(--faint); cursor: not-allowed; }

.sz-autocomplete { position: fixed; z-index: 2147483001; display: none; }
.sz-autocomplete.open { display: block; }
.sz-ac-tip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); color: #fff; border: none; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
.sz-ac-tip:hover { background: #0b5f59; }

.sz-toasts { position: fixed; left: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 2147483001; pointer-events: none; }
.sz-toast { background: #0f766e; color: #fff; padding: 8px 12px; border-radius: var(--radius); font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.18); max-width: 300px; }
.sz-toast.idle { background: #92400e; }
.sz-toast.err { background: #b91c1c; }

/* 设置 */
.sz-field { margin-bottom: 14px; }
.sz-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.sz-textarea { width: 100%; min-height: 90px; padding: 8px; border: 1px solid var(--border-strong); border-radius: var(--radius); font-size: 12px; font-family: inherit; resize: vertical; outline: none; color: var(--fg); }
.sz-textarea:focus { border-color: var(--accent); }
.sz-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-strong); background: #fff; border-radius: var(--radius); padding: 5px 12px; font-size: 12px; color: var(--fg); cursor: pointer; white-space: nowrap; }
.sz-btn:hover { background: #f5f5f4; }
.sz-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.sz-btn.primary:hover { background: #0b5f59; }
.sz-btn.danger { color: var(--low); }
.sz-btn.danger:hover { background: #fef2f2; border-color: #fecaca; }
.sz-note { font-size: 11px; color: var(--faint); line-height: 1.6; }
.sz-note a { color: var(--accent); }

.sz-hl { background: #fde68a; color: #92400e; padding: 0 1px; border-radius: 2px; }
.sz-search-hint { font-size: 11px; color: var(--faint); padding: 0 4px 4px; }

.sz-resize { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: ew-resize; }
.sz-resize:hover { background: rgba(15,118,110,.15); }
`;

// 当前聚焦的宿主页面输入框（用于输入自动补全）
let focusedInput: HTMLInputElement | HTMLTextAreaElement | null = null;

// 面板 UI 状态（模块级，随渲染保留）
const UI = {
  tab: "goals",
  recSort: "time" as "time" | "relevance",
  recQuery: "",
  recFilter: null as string | null,
  expanded: new Set<string>(),
  expandedFull: new Set<string>(),
  collapsed: new Set<string>(), // 折叠的分类节点（"g:{id}" | "t:{id}"）
  editingPrompt: null as null | string, // 正在编辑分类提示词的节点 id
  aiDraft: null as null | { title: string; prompt: string; tasks: Task[]; questions: string[]; originalText: string }, // AI 拆解待确认结果
  todoOpen: false,
  exportOpen: false,
  exportGoalId: null as string | null,
  drag: null as null | { kind: "goal" | "task" | "subtask"; id: string; parent: string },
  cloneTab: "https" as "https" | "ssh" | "ghcli",
};

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return hh + ":" + mm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hh + ":" + mm;
}

function highlightText(text: string, query: string): string {
  if (!text || !query) return esc(text);
  const q = query.toLowerCase();
  const str = String(text);
  let result = "";
  let last = 0;
  for (let i = 0; i <= str.length - q.length; i++) {
    if (str.substring(i, i + q.length).toLowerCase() === q) {
      result += esc(str.substring(last, i)) + '<span class="sz-hl">' + esc(str.substring(i, i + q.length)) + "</span>";
      last = i + q.length;
      i = last - 1;
    }
  }
  result += esc(str.substring(last));
  return result;
}

// 相关度：优先后端数值（0-100），缺省时前端推断（归档=高，摸鱼=低）
function relevanceOf(r: BrowseRecord): "high" | "med" | "low" | "none" {
  const num = r.relevance;
  if (typeof num === "number") {
    if (num >= 70) return "high";
    if (num >= 40) return "med";
    return "low";
  }
  if (String(r.category).startsWith("goal:")) return "high";
  if (r.category === "slacking") return "low";
  return "none";
}

const REL_RANK: Record<string, number> = { high: 0, med: 1, low: 2, none: 3 };

// 记录过滤器格式：null | "slacking" | "goal:{id}" | "task:{id}" | "subtask:{id}"
function matchMatchesFilter(m: MatchEntry, filter: string): boolean {
  if (filter.startsWith("subtask:")) return m.subtaskId === filter.slice(8);
  if (filter.startsWith("task:")) return m.taskId === filter.slice(5);
  if (filter.startsWith("goal:")) return m.goalId === filter.slice(5);
  return false;
}

function getFilterLabel(filter: string, goals: Goal[]): string {
  if (filter === "slacking") return "摸鱼";
  if (filter.startsWith("goal:")) {
    const id = filter.slice(5);
    return goals.find((g) => g.id === id)?.title || "未知目标";
  }
  if (filter.startsWith("task:")) {
    const id = filter.slice(5);
    for (const g of goals) {
      const t = (g.tasks || []).find((x) => x.id === id);
      if (t) return g.title + " → " + t.title;
    }
    return "未知任务";
  }
  if (filter.startsWith("subtask:")) {
    const id = filter.slice(8);
    for (const g of goals) {
      for (const t of g.tasks || []) {
        const s = (t.subtasks || []).find((x) => x.id === id);
        if (s) return g.title + " → " + t.title + " → " + s.title;
      }
    }
    return "未知子任务";
  }
  return filter;
}

function matchPath(m: MatchEntry, goals: Goal[]): string {
  const g = goals.find((x) => x.id === m.goalId);
  const t = g?.tasks?.find((x) => x.id === m.taskId);
  const s = t?.subtasks?.find((x) => x.id === m.subtaskId);
  const parts = [g?.title, t?.title, s?.title].filter(Boolean);
  return parts.join(" → ") || "未分类";
}

function currentSuggestion(goals: Goal[]): { todo: Todo; goal: Goal } | null {
  for (const g of goals) {
    if (g.status !== "active") continue;
    for (const t of g.todos || []) {
      if (t.status === "open" && (t.coverage || 0) < 0.9) return { todo: t, goal: g };
    }
  }
  return null;
}

function reorder<T extends { id: string }>(arr: T[], fromId: string, toId: string): void {
  const from = arr.findIndex((x) => x.id === fromId);
  const to = arr.findIndex((x) => x.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

function seedDemoData(): void {
  const goals = Store.read<Goal[]>(K.goals, []);
  const records = Store.read<BrowseRecord[]>(K.records, []);
  if (goals.length || records.length) return; // 已有数据不覆盖

  const g1: Goal = {
    id: "demo-g1",
    title: "写季度报告",
    status: "active",
    createdAt: Date.now() - 86400000 * 3,
    tasks: [
      {
        id: "demo-t1",
        title: "整理数据",
        subtasks: [
          { id: "demo-s1", title: "导出报表" },
          { id: "demo-s2", title: "核对数字" },
        ],
      },
      { id: "demo-t2", title: "撰写正文" },
    ],
    todos: [
      {
        id: "demo-todo1",
        text: "收集季度数据",
        contrib: {},
        coverage: 40,
        status: "open",
        manual: false,
        searchTerms: ["季度财务数据", "营收统计", "业务报表"],
      },
      {
        id: "demo-todo2",
        text: "校对排版",
        contrib: {},
        coverage: 0,
        status: "open",
        manual: false,
        searchTerms: ["文档排版规范", "报告格式要求"],
      },
    ],
  };
  const g2: Goal = {
    id: "demo-g2",
    title: "学习 React",
    status: "active",
    createdAt: Date.now() - 86400000 * 5,
    tasks: [],
    todos: [
      {
        id: "demo-todo3",
        text: "看完官方文档 Hooks 章节",
        contrib: {},
        coverage: 10,
        status: "open",
        manual: false,
        searchTerms: ["React Hooks 官方文档", "useEffect useState 教程"],
      },
    ],
  };
  Store.write(K.goals, [g1, g2]);

  const longSummary =
    "这是一条用于测试「查看全文/收起」功能的长摘要。正文摘录会被截断并显示展开按钮，点击后可查看完整内容。" +
    "季度报告需要汇总各部门 KPI、营收增速、用户留存等核心指标，并与去年同期进行环比分析。".repeat(3);

  Store.write(K.records, [
    {
      id: "demo-r1",
      url: "https://example.com/report-template",
      origin: "example.com",
      title: "季度报告模板",
      h1: "季度报告模板",
      meta: "report",
      capturedAt: Date.now() - 3600000 * 2,
      excerptHash: "h1",
      preview: "预览内容",
      category: "goal:demo-g1",
      relevance: 85,
      findings: ["模板结构完整，可直接套用"],
      notes: [{ topic: "报告结构", content: "包含 KPI、增速、留存三个核心模块。", relevance: 90 }],
      summary: longSummary,
      keywords: ["报告", "季度", "模板"],
    },
    {
      id: "demo-r2",
      url: "https://example.com/data-source",
      origin: "example.com",
      title: "数据中心",
      h1: "数据中心",
      meta: "data",
      capturedAt: Date.now() - 3600000 * 4,
      excerptHash: "h2",
      preview: "预览",
      category: "goal:demo-g1",
      relevance: 55,
      summary: "各部门数据汇总页面，可导出 CSV 和 Excel。",
      keywords: ["数据", "导出"],
    },
    {
      id: "demo-r3",
      url: "https://example.com/slacking",
      origin: "example.com",
      title: "摸鱼网页",
      h1: "娱乐",
      meta: "fun",
      capturedAt: Date.now() - 3600000 * 6,
      excerptHash: "h3",
      preview: "预览",
      category: "slacking",
      summary: "无关的娱乐内容。",
      keywords: ["娱乐"],
    },
  ]);

  Store.write(K.state, { workMode: true, activeSince: Date.now() });
}

export const Panel = {
  root: null as ShadowRoot | null,
  els: {} as {
    fab: HTMLButtonElement;
    panel: HTMLDivElement;
    body: HTMLDivElement;
    toasts: HTMLDivElement;
    workmode: HTMLInputElement;
    todoBar: HTMLButtonElement;
    todoPop: HTMLDivElement;
    ctxmenu: HTMLDivElement;
    autocomplete: HTMLDivElement;
    tabs: HTMLButtonElement[];
  },

  mount(): void {
    seedDemoData();
    const host = document.createElement("div");
    host.id = "shizhi-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
<style>${CSS}</style>
<div class="sz-toasts"></div>
<button class="sz-fab" data-act="fab" title="拾知">${ICONS.bulb}</button>
<div class="sz-todo">
  <button class="sz-todo-bar" data-act="todo-bar" title="待办建议">
    <span class="sz-dot" style="background:var(--accent)"></span>
    <span class="txt" data-role="todo-txt">待办</span>
  </button>
  <div class="sz-todo-pop" data-role="todo-pop">
    <div class="sz-todo-head"><span>待办建议</span><button class="sz-ibtn" data-act="todo-close" title="关闭">${ICONS.x}</button></div>
    <div class="sz-todo-list" data-role="todo-list"></div>
  </div>
</div>
<div class="sz-ctxmenu" data-role="ctxmenu"></div>
<div class="sz-autocomplete" data-role="autocomplete"></div>
<div class="sz-panel">
  <div class="sz-head">
    <span class="sz-title">拾知</span>
    <span class="sz-mode">工作模式</span>
    <input type="checkbox" class="sz-switch" data-role="workmode">
    <div style="position:relative">
      <button class="sz-ibtn" data-act="export" title="导出记录">${ICONS.download}</button>
      <div class="sz-pop" data-role="export-pop" style="display:none"></div>
    </div>
    <button class="sz-ibtn" data-act="close" title="关闭">${ICONS.x}</button>
  </div>
  <div class="sz-tabs">
    <button class="sz-tab act" data-act="tab" data-tab="goals">目标</button>
    <button class="sz-tab" data-act="tab" data-tab="records">记录</button>
    <button class="sz-tab" data-act="tab" data-tab="profile">画像</button>
    <button class="sz-tab" data-act="tab" data-tab="settings">设置</button>
  </div>
  <div class="sz-body"></div>
  <div class="sz-foot">
    <span class="sz-foot-label">关联网址</span>
    <input class="sz-input" data-role="linked-url" placeholder="填站点名或网址，点 ✦ 让 AI 自动补全搜索参数">
    <button class="sz-ibtn" data-act="ai-linked" title="AI 补全搜索参数" style="color:var(--accent)">${ICONS.sparkle}</button>
  </div>
  <div class="sz-resize" data-role="resize"></div>
</div>`;
    document.documentElement.appendChild(host);
    this.root = shadow;
    this.els = {
      fab: shadow.querySelector(".sz-fab")!,
      panel: shadow.querySelector(".sz-panel")!,
      body: shadow.querySelector(".sz-body")!,
      toasts: shadow.querySelector(".sz-toasts")!,
      workmode: shadow.querySelector('[data-role="workmode"]')!,
      todoBar: shadow.querySelector(".sz-todo-bar")!,
      todoPop: shadow.querySelector(".sz-todo-pop")!,
      ctxmenu: shadow.querySelector('[data-role="ctxmenu"]')!,
      autocomplete: shadow.querySelector('[data-role="autocomplete"]')!,
      tabs: Array.from(shadow.querySelectorAll(".sz-tab")),
    };

    shadow.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    shadow.addEventListener("change", (e) => this.onChange(e as Event));
    shadow.addEventListener("input", (e) => this.onInput(e as Event));
    shadow.addEventListener("keydown", (e) => this.onKeydown(e as KeyboardEvent));

    // 右键「塞给 AI」：在宿主页面选中文字后右键弹出
    document.addEventListener("contextmenu", (e) => this.onContextMenu(e as MouseEvent));
    document.addEventListener("click", (e) => {
      if (this.els.ctxmenu && this.els.ctxmenu.classList.contains("open")) this.hideCtxMenu();
    });

    // 输入自动补全：监听宿主页面输入框聚焦 + Ctrl+. 触发
    document.addEventListener("focusin", (e) => this.onFocusIn(e as FocusEvent));
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        this.completeInput();
        e.preventDefault();
      }
    });

    // 拖拽排序
    shadow.addEventListener("dragstart", (e) => this.onDragStart(e as DragEvent));
    shadow.addEventListener("dragover", (e) => this.onDragOver(e as DragEvent));
    shadow.addEventListener("drop", (e) => this.onDrop(e as DragEvent));
    shadow.addEventListener("dragend", () => { UI.drag = null; this.clearDragOver(); });

    // 面板 resize
    const handle = shadow.querySelector('[data-role="resize"]') as HTMLDivElement;
    handle.addEventListener("pointerdown", (e) => this.onResizeStart(e as PointerEvent));

    this.render();
  },

  onClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest("[data-act]") as HTMLElement | null;
    if (!btn) {
      // 点击面板外区域关闭导出浮层（导出浮层内部的交互，如下拉菜单，不关闭）
      const t = e.target as Element;
      if (UI.exportOpen && !t.closest('[data-role="export-pop"]')) {
        UI.exportOpen = false;
        this.renderExportPop();
      }
      return;
    }
    const act = btn.dataset.act;
    if (act === "fab") this.els.panel.classList.toggle("open");
    else if (act === "close") this.els.panel.classList.remove("open");
    else if (act === "tab") { UI.tab = btn.dataset.tab || "goals"; this.render(); }
    else if (act === "export") { UI.exportOpen = !UI.exportOpen; this.renderExportPop(); }
    else if (act === "export-selected") this.exportSelected();
    else if (act === "export-cancel") this.exportCancel();
    else if (act === "todo-bar") { UI.todoOpen = !UI.todoOpen; this.renderTodo(); }
    else if (act === "todo-close") { UI.todoOpen = false; this.renderTodo(); }
    else if (act === "copy-term") this.copyText(btn.dataset.term || "");
    else if (act === "clone-tab") { UI.cloneTab = (btn.dataset.tab || "https") as typeof UI.cloneTab; this.renderSettings(); }
    else if (act === "copy-clone") this.copyText(btn.dataset.cmd || "");
    else if (act === "toggle-rec") this.toggleRecord(btn.closest<HTMLElement>(".sz-rec")?.dataset.id || "");
    else if (act === "rec-open") { window.open(btn.dataset.url || "", "_blank", "noopener"); }
    else if (act === "del-rec") this.delRecord(btn.dataset.rid || "");
    else if (act === "retry") this.retryRecord(btn.dataset.rid || "");
    else if (act === "add-goal") this.addNode("goal", "");
    else if (act === "ai-parse-goal") this.parseGoalWithAI();
    else if (act === "add-task") this.addNode("task", btn.dataset.pid || "");
    else if (act === "add-sub") this.addNode("subtask", btn.dataset.pid || "");
    else if (act === "edit-goal") this.editGoal(btn.dataset.id || "");
    else if (act === "edit-task") this.editTask(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "edit-sub") this.editSub(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "del-goal") this.delGoal(btn.dataset.id || "");
    else if (act === "del-task") this.delTask(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "del-sub") this.delSub(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "toggle-goal") this.toggleGoal(btn.dataset.id || "");
    else if (act === "toggle-node") this.toggleNode(btn.dataset.id || "");
    else if (act === "edit-prompt") { UI.editingPrompt = btn.dataset.id || ""; this.render(); }
    else if (act === "prompt-save") this.savePrompt(btn.dataset.pkind as "goal" | "task" | "subtask", btn.dataset.id || "");
    else if (act === "prompt-cancel") { UI.editingPrompt = null; this.render(); }
else if (act === "ai-confirm") this.confirmAiDraft();
else if (act === "ai-cancel") this.cancelAiDraft();
else if (act === "ai-reparse") this.reparseGoalWithAI();
    else if (act === "reset-prompt") this.resetPrompt();
    else if (act === "clear-selected") this.clearSelected();
    else if (act === "ai-linked") this.aiFillLinkedUrl();
    else if (act === "save-settings") this.saveSettings();
    else if (act === "help") this.showHelp();
    else if (act === "add-profile") this.addProfile();
    else if (act === "del-profile") this.delProfile(btn.dataset.kind as "facts" | "preferences", Number(btn.dataset.idx || 0));
    else if (act === "ai-profile") this.generateProfileWithAI();
    else if (act === "ac-complete") this.completeInput();
    else if (act === "send-ai") this.sendSelectionToAI("analyze");
    else if (act === "send-ai-summary") this.sendSelectionToAI("summary");
    else if (act === "sort-time") { UI.recSort = "time"; this.render(); }
    else if (act === "sort-relevance") { UI.recSort = "relevance"; this.render(); }
    else if (act === "goto-rec") { UI.recFilter = btn.dataset.id || null; UI.tab = "records"; this.render(); }
    else if (act === "rec-back") { UI.recFilter = null; this.renderRecords(); }
    else if (act === "toggle-full") { const id = btn.dataset.rid || ""; if (UI.expandedFull.has(id)) UI.expandedFull.delete(id); else UI.expandedFull.add(id); this.renderRecords(); }
    else if (act === "search-term") this.searchTerm(btn.dataset.term || "");
    else if (act === "toggle-sec") { const el = btn.closest(".sz-sec"); if (el) { el.classList.toggle("open"); } }
  },

  onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-role="workmode"]')) {
      const st = getState();
      st.workMode = (t as HTMLInputElement).checked;
      if ((t as HTMLInputElement).checked && !st.activeSince) st.activeSince = Date.now();
      Store.write(K.state, st);
      this.render();
      if ((t as HTMLInputElement).checked) onLocationChange();
    } else if (t.matches('[data-role="linked-url"]')) {
      const v = (t as HTMLInputElement).value.trim();
      saveSettings({ linkedUrl: v });
      if (v) this.linkedUrlNotice(v);
    }
  },

  onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-role="rec-search"]')) { UI.recQuery = t.value; this.renderRecords(); }
  },

  onKeydown(e: KeyboardEvent): void {
    const t = e.target as Element;
    if (e.key === "Enter") {
      if (t.matches('[data-role="goal-input"]')) this.parseGoalWithAI();
      else if (t.matches('[data-role="task-input"]')) this.addNode("task", (t as HTMLElement).dataset.pid || "");
      else if (t.matches('[data-role="sub-input"]')) this.addNode("subtask", (t as HTMLElement).dataset.pid || "");
    } else if (e.key === "Escape") {
      if (UI.exportOpen) { UI.exportOpen = false; this.renderExportPop(); }
      if (UI.todoOpen) { UI.todoOpen = false; this.renderTodo(); }
    }
  },

  // ---- 目标三级树 ----
  addNode(kind: "goal" | "task" | "subtask", parentId: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    if (kind === "goal") {
      const input = this.root!.querySelector('[data-role="goal-input"]') as HTMLInputElement;
      const title = (input?.value || "").trim();
      if (!title) return;
      goals.unshift({ id: uid("g"), title, status: "active", createdAt: Date.now(), prompt: "", tasks: [], todos: [] });
      Store.write(K.goals, goals);
      if (input) input.value = "";
    } else if (kind === "task") {
      const g = goals.find((x) => x.id === parentId);
      const input = this.root!.querySelector(`[data-role="task-input"][data-pid="${parentId}"]`) as HTMLInputElement;
      const title = (input?.value || "").trim();
      if (!g || !title) return;
      g.tasks = g.tasks || [];
      g.tasks.push({ id: uid("t"), title, prompt: "", subtasks: [] });
      Store.write(K.goals, goals);
      if (input) input.value = "";
    } else {
      const g = goals.find((x) => x.id === parentId);
      const input = this.root!.querySelector(`[data-role="sub-input"][data-pid="${parentId}"]`) as HTMLInputElement;
      const title = (input?.value || "").trim();
      if (!g || !title) return;
      const task = (g.tasks || []).find((t) => t.id === input?.dataset.task);
      if (!task) return;
      task.subtasks = task.subtasks || [];
      task.subtasks.push({ id: uid("s"), title, prompt: "" });
      Store.write(K.goals, goals);
      if (input) input.value = "";
    }
    this.render();
    onLocationChange();
  },

  async parseGoalWithAI(): Promise<void> {
    const input = this.root!.querySelector('[data-role="goal-input"]') as HTMLInputElement;
    const text = (input?.value || "").trim();
    if (!text) { this.toast("请先输入目标需求", "idle"); return; }
    const bridge = (window as unknown as { LLMBridge?: { chat(p: string, f?: string): Promise<string> } }).LLMBridge;
    if (!bridge) {
      this.toast("AI 暂不可用（未检测到 LLMBridge）。请手动填写目标名称后回车创建。", "err");
      return;
    }
    this.toast("AI 正在拆解需求…", "idle");
    try {
      const raw = await bridge.chat(
        '你是目标拆解专家。用户会给你一句模糊的工作需求，你要把它拆成一个清晰目标，并拆成几条明确的"任务"（必要时再拆"子任务"），同时为每个层级写一段精准的定义提示词，供分类 AI 据此判断"一条网页记录是否属于这个分类"。\n\n' +
        '[任务的定义]\n' +
        '任务是明确、可持续执行的收集方向，像工作流里的一个步骤。命名用"动作+对象+目的"，动词开头，例如："查看最近 AI 新闻了解新技术/产品"、"检查最新论文了解技术细节"、"浏览新产品相关社区帖子"。\n' +
        '下面这些不要当成任务：元任务或待确认项（如"确定收集方向""梳理思路""补充信息"），这些属于需要向用户追问澄清的问题，应写进 questions；与信息收集无关的行政动作。\n\n' +
        '[定义提示词（prompt）的写法]\n' +
        '每一层 prompt 都要具体到能让分类 AI 一眼判断"某条网页记录是否属于它"：写清楚关注什么主题、含哪些关键词、什么算相关、什么不算（边界）、典型来源。目标级写整体范围，任务级写该方向的细分范围，子任务级写最细边界和关键词。禁止空话（如"收集相关信息"）。\n\n' +
        '[输出格式]\n' +
        '只输出 JSON（不要其他内容）：\n' +
        '{"title":"目标名称(<=20字)","prompt":"目标级定义提示词","questions":["需要向用户澄清的问题"],"tasks":[{"title":"任务名","prompt":"任务级定义提示词","searchTerms":["搜索词1","搜索词2"],"subtasks":[{"title":"子任务名","prompt":"子任务级定义提示词"}]}]}\n\n' +
        '[规则]\n' +
        '1. 任务最多 4 个，每个任务子任务最多 3 个。\n' +
        '2. 需求足够明确时 questions 返回空数组 []。\n' +
        '3. 需求模糊时把"该问用户什么"写进 questions，不要硬拆成任务。\n' +
        '4. 名称简洁，prompt 具体，不写空话。\n' +
        '5. 每个任务生成 1-3 个搜索词（searchTerms），用于后续在该任务下搜索相关资料。搜索词要贴合任务内容，不同任务应有差异。\n\n' +
        '需求：' + text,
        "json"
      );
      const obj = JSON.parse(raw);
      const title = String(obj.title || text).trim().slice(0, 40) || text.slice(0, 40);
      const questions: string[] = (Array.isArray(obj.questions) ? obj.questions : [])
        .map((q: unknown) => String(q).trim()).filter(Boolean).slice(0, 5);
      const tasks: Task[] = (Array.isArray(obj.tasks) ? obj.tasks : []).slice(0, 4).map((t: Record<string, unknown>) => ({
        id: uid("t"),
        title: String(t.title || "").trim().slice(0, 40) || "未命名任务",
        prompt: typeof t.prompt === "string" ? t.prompt : "",
        searchTerms: (Array.isArray(t.searchTerms) ? t.searchTerms : []).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 3),
        subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).slice(0, 3).map((s: Record<string, unknown>) => ({
          id: uid("s"),
          title: String(s.title || "").trim().slice(0, 40) || "未命名子任务",
          prompt: typeof s.prompt === "string" ? s.prompt : "",
        })),
      }));
      // 暂存拆解结果，等待用户确认/编辑后再写入
      UI.aiDraft = {
        title,
        prompt: typeof obj.prompt === "string" ? obj.prompt : "",
        tasks,
        questions,
        originalText: text,
      };
      if (input) input.value = "";
      this.render();
      this.toast("AI 已拆解，请确认或修改后创建", "idle");
    } catch (err) {
      this.toast("AI 拆解失败：" + String(err), "err");
    }
  },

  async reparseGoalWithAI(): Promise<void> {
    const d = UI.aiDraft;
    if (!d || !d.questions.length) return;
    const bridge = (window as unknown as { LLMBridge?: { chat(p: string, f?: string): Promise<string> } }).LLMBridge;
    if (!bridge) {
      this.toast("AI 暂不可用（未检测到 LLMBridge）。", "err");
      return;
    }
    const answers: string[] = [];
    for (let i = 0; i < d.questions.length; i++) {
      const el = this.root!.querySelector(`[data-ai-answer="${i}"]`) as HTMLInputElement;
      answers.push((el?.value || "").trim());
    }
    const context = d.questions.map((q, i) => `Q: ${q}\nA: ${answers[i] || "未回答"}`).join("\n\n");
    this.toast("AI 正在重新拆解…", "idle");
    try {
      const raw = await bridge.chat(
        '你是目标拆解专家。用户之前有需求，你提出了一些澄清问题，用户已回答。请结合原始需求和用户回答，重新拆解成目标、任务、子任务，并为每个层级生成精准的定义提示词，供分类 AI 据此判断"一条网页记录是否属于这个分类"。\n\n' +
        '[原始需求]\n' + d.originalText + '\n\n' +
        '[用户回答]\n' + context + '\n\n' +
        '[任务的定义]\n' +
        '任务是明确、可持续执行的收集方向，像工作流里的一个步骤。命名用"动作+对象+目的"，动词开头，例如："查看最近 AI 新闻了解新技术/产品"、"检查最新论文了解技术细节"、"浏览新产品相关社区帖子"。\n' +
        '下面这些不要当成任务：元任务或待确认项（如"确定收集方向""梳理思路""补充信息"），这些属于需要向用户追问澄清的问题，应写进 questions；与信息收集无关的行政动作。\n\n' +
        '[定义提示词（prompt）的写法]\n' +
        '每一层 prompt 都要具体到能让分类 AI 一眼判断"某条网页记录是否属于它"：写清楚关注什么主题、含哪些关键词、什么算相关、什么不算（边界）、典型来源。目标级写整体范围，任务级写该方向的细分范围，子任务级写最细边界和关键词。禁止空话（如"收集相关信息"）。\n\n' +
        '[输出格式]\n' +
        '只输出 JSON（不要其他内容）：\n' +
        '{"title":"目标名称(<=20字)","prompt":"目标级定义提示词","questions":["需要向用户澄清的问题"],"tasks":[{"title":"任务名","prompt":"任务级定义提示词","searchTerms":["搜索词1","搜索词2"],"subtasks":[{"title":"子任务名","prompt":"子任务级定义提示词"}]}]}\n\n' +
        '[规则]\n' +
        '1. 任务最多 4 个，每个任务子任务最多 3 个。\n' +
        '2. 需求足够明确时 questions 返回空数组 []。\n' +
        '3. 需求模糊时把"该问用户什么"写进 questions，不要硬拆成任务。\n' +
        '4. 名称简洁，prompt 具体，不写空话。\n' +
        '5. 每个任务生成 1-3 个搜索词（searchTerms），用于后续在该任务下搜索相关资料。搜索词要贴合任务内容，不同任务应有差异。',
        "json"
      );
      const obj = JSON.parse(raw);
      const title = String(obj.title || d.originalText).trim().slice(0, 40) || d.originalText.slice(0, 40);
      const questions: string[] = (Array.isArray(obj.questions) ? obj.questions : [])
        .map((q: unknown) => String(q).trim()).filter(Boolean).slice(0, 5);
      const tasks: Task[] = (Array.isArray(obj.tasks) ? obj.tasks : []).slice(0, 4).map((t: Record<string, unknown>) => ({
        id: uid("t"),
        title: String(t.title || "").trim().slice(0, 40) || "未命名任务",
        prompt: typeof t.prompt === "string" ? t.prompt : "",
        searchTerms: (Array.isArray(t.searchTerms) ? t.searchTerms : []).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 3),
        subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).slice(0, 3).map((s: Record<string, unknown>) => ({
          id: uid("s"),
          title: String(s.title || "").trim().slice(0, 40) || "未命名子任务",
          prompt: typeof s.prompt === "string" ? s.prompt : "",
        })),
      }));
      UI.aiDraft = {
        title,
        prompt: typeof obj.prompt === "string" ? obj.prompt : "",
        tasks,
        questions,
        originalText: d.originalText,
      };
      this.render();
      this.toast("AI 已重新拆解，请确认或修改后创建", "idle");
    } catch (err) {
      this.toast("AI 重新拆解失败：" + String(err), "err");
    }
  },

  editGoal(id: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    const title = prompt("目标名称", g.title);
    if (title == null) return;
    const t = title.trim();
    if (!t) return;
    g.title = t;
    Store.write(K.goals, goals);
    this.render();
  },

  editTask(id: string, goalId: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === goalId);
    const task = g?.tasks?.find((x) => x.id === id);
    if (!task) return;
    const title = prompt("任务名称", task.title);
    if (title == null) return;
    const t = title.trim();
    if (!t) return;
    task.title = t;
    Store.write(K.goals, goals);
    this.render();
  },

  editSub(id: string, goalId: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === goalId);
    let found: Subtask | null = null;
    for (const task of g?.tasks || []) found = task.subtasks?.find((x) => x.id === id) || found;
    if (!found) return;
    const title = prompt("子任务名称", found.title);
    if (title == null) return;
    const t = title.trim();
    if (!t) return;
    found.title = t;
    Store.write(K.goals, goals);
    this.render();
  },

  toggleGoal(id: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    g.status = g.status === "active" ? "done" : "active";
    Store.write(K.goals, goals);
    this.render();
  },

  // 折叠/展开分类节点（key = "g:{id}" | "t:{id}"）
  toggleNode(key: string): void {
    if (UI.collapsed.has(key)) UI.collapsed.delete(key); else UI.collapsed.add(key);
    this.render();
  },

  // 保存分类提示词（分类定义）
  savePrompt(kind: "goal" | "task" | "subtask", id: string): void {
    const ta = this.root!.querySelector(`[data-role="prompt-input"][data-id="${id}"]`) as HTMLTextAreaElement;
    const value = (ta?.value || "").trim();
    const goals = Store.read<Goal[]>(K.goals, []);
    if (kind === "goal") {
      const g = goals.find((x) => x.id === id);
      if (g) g.prompt = value;
    } else if (kind === "task") {
      for (const g of goals) {
        const t = (g.tasks || []).find((x) => x.id === id);
        if (t) { t.prompt = value; break; }
      }
    } else {
      for (const g of goals) {
        for (const t of g.tasks || []) {
          const s = (t.subtasks || []).find((x) => x.id === id);
          if (s) { s.prompt = value; break; }
        }
      }
    }
    Store.write(K.goals, goals);
    UI.editingPrompt = null;
    this.render();
  },

  // 确认 AI 拆解结果并创建目标
  confirmAiDraft(): void {
    const d = UI.aiDraft;
    if (!d) return;
    const root = this.root!;
    const title = (root.querySelector("[data-ai-title]") as HTMLInputElement)?.value?.trim() || "未命名目标";
    const prompt = (root.querySelector("[data-ai-prompt]") as HTMLTextAreaElement)?.value?.trim() || "";
    const tasks: Task[] = d.tasks.map((t, i) => {
      const tEl = root.querySelector(`[data-ai-task-title="${i}"]`) as HTMLInputElement;
      const pEl = root.querySelector(`[data-ai-task-prompt="${i}"]`) as HTMLTextAreaElement;
      const subtasks: Subtask[] = (t.subtasks || []).map((s, j) => {
        const sEl = root.querySelector(`[data-ai-sub="${i}-${j}"]`) as HTMLInputElement;
        const spEl = root.querySelector(`[data-ai-sub-prompt="${i}-${j}"]`) as HTMLTextAreaElement;
        const st = (sEl?.value || "").trim();
        return { id: s.id, title: st, prompt: (spEl?.value || "").trim() || s.prompt || "" };
      }).filter((s) => s.title);
      return {
        id: t.id,
        title: (tEl?.value || "").trim() || "未命名任务",
        prompt: pEl?.value?.trim() || "",
        subtasks,
      };
    });
    const todos: Todo[] = tasks.slice(0, 5).map((t, i) => ({
      id: uid("todo"),
      text: t.title,
      contrib: {},
      coverage: 0,
      status: "open" as const,
      manual: false,
      searchTerms: (d.tasks[i]?.searchTerms || []).slice(0, 3),
    }));
    const goals = Store.read<Goal[]>(K.goals, []);
    goals.unshift({ id: uid("g"), title, status: "active", createdAt: Date.now(), prompt, tasks, todos });
    Store.write(K.goals, goals);
    UI.aiDraft = null;
    this.render();
    onLocationChange();
    this.toast("已创建目标：" + title + "（" + tasks.length + " 个任务）", "ok");
  },

  cancelAiDraft(): void {
    UI.aiDraft = null;
    this.render();
  },

  delGoal(id: string): void {
    if (!confirm("删除这个目标？已归档的记录会保留。")) return;
    Store.write(K.goals, Store.read<Goal[]>(K.goals, []).filter((x) => x.id !== id));
    this.render();
  },

  delTask(id: string, goalId: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === goalId);
    if (!g) return;
    g.tasks = (g.tasks || []).filter((x) => x.id !== id);
    Store.write(K.goals, goals);
    this.render();
  },

  delSub(id: string, goalId: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === goalId);
    if (!g) return;
    for (const task of g.tasks || []) task.subtasks = (task.subtasks || []).filter((x) => x.id !== id);
    Store.write(K.goals, goals);
    this.render();
  },

  // ---- 记录操作 ----
  toggleRecord(id: string): void {
    if (UI.expanded.has(id)) UI.expanded.delete(id); else UI.expanded.add(id);
    this.renderRecords();
  },

  delRecord(rid: string): void {
    if (!confirm("删除这条记录？")) return;
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const sep = rid.indexOf("::");
    if (sep > -1) {
      // 删除某个分类下的单条记录（只删该 match）
      const recordId = rid.slice(0, sep);
      const matchIndex = parseInt(rid.slice(sep + 2), 10);
      const rec = recs.find((r) => r.id === recordId);
      if (rec && rec.matches && matchIndex >= 0 && matchIndex < rec.matches.length) {
        rec.matches.splice(matchIndex, 1);
        const remaining = rec.matches.filter((m) => m.relevance >= 50);
        if (!remaining.length) {
          // 没有其它分类命中了，整条记录删除
          Store.write(K.records, recs.filter((r) => r.id !== recordId));
        } else {
          // 仍有其它分类，保留记录并让主分类指向剩余里相关度最高的
          const top = remaining.reduce((a, b) => (b.relevance > a.relevance ? b : a));
          rec.category = "goal:" + top.goalId;
          Store.write(K.records, recs);
        }
      }
    } else {
      Store.write(K.records, recs.filter((r) => r.id !== rid));
    }
    this.render();
  },

  retryRecord(rid: string): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const rec = recs.find((r) => r.id === rid);
    if (!rec || !rec.excerpt) return;
    rec.category = "pending";
    const q = Store.read<QueueItem[]>(K.queue, []);
    q.push({ recordId: rec.id, excerpt: rec.excerpt, retries: 0, nextAt: 0 });
    delete rec.excerpt;
    Store.write(K.records, recs);
    Store.write(K.queue, q);
    this.render();
    pumpQueue();
  },

  exportSelected(): void {
    const sel = this.root!.querySelector('[data-role="export-select"]') as HTMLSelectElement;
    const value = sel?.value || "";
    if (!value) { this.toast("请先在导出菜单里选择目标", "idle"); return; }
    this.exportRecords(value === "all" ? null : value);
  },

  exportCancel(): void {
    UI.exportOpen = false;
    this.renderExportPop();
  },

  exportRecords(goalId: string | null): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const goals = Store.read<Goal[]>(K.goals, []);

    // 导出条目：一条记录 = 网页 × 分类（match）。同一网页命中多个分类时拆成多条，各自带独立分析。
    interface ExportEntry {
      id: string;
      url: string;
      title: string;
      capturedAt: number;
      summary: string;
      keywords: string[];
      goalId: string | null;
      taskId: string | null;
      subtaskId: string | null;
      relevance: number;
      reasoning: string;
      findings: string[];
      notes: NoteEntry[];
      keyQuotes: KeyQuote[];
    }
    const entries: ExportEntry[] = [];

    for (const r of recs) {
      const matches = (r.matches || []).filter((m) => m.relevance >= 50);
      if (matches.length) {
        for (const m of matches) {
          if (goalId && m.goalId !== goalId) continue;
          entries.push({
            id: r.id + "::" + m.goalId + (m.taskId ? ":" + m.taskId : "") + (m.subtaskId ? ":" + m.subtaskId : ""),
            url: r.url,
            title: r.title,
            capturedAt: r.capturedAt,
            summary: r.summary,
            keywords: r.keywords,
            goalId: m.goalId,
            taskId: m.taskId,
            subtaskId: m.subtaskId,
            relevance: m.relevance,
            reasoning: m.reasoning,
            findings: m.findings,
            notes: m.notes,
            keyQuotes: m.keyQuotes,
          });
        }
      } else if (!goalId) {
        // 旧版单分类记录 / 摸鱼记录：仅全量导出时包含
        const legacyGoal = r.category.startsWith("goal:") ? r.category.slice(5) : null;
        entries.push({
          id: r.id,
          url: r.url,
          title: r.title,
          capturedAt: r.capturedAt,
          summary: r.summary,
          keywords: r.keywords,
          goalId: legacyGoal,
          taskId: null,
          subtaskId: null,
          relevance: r.relevance || 0,
          reasoning: "",
          findings: r.findings || [],
          notes: r.notes || [],
          keyQuotes: [],
        });
      }
    }

    const payload = { exportedAt: Date.now(), goals, records: entries };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = goalId ? "shizhi-" + goalId + ".json" : "shizhi-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.exportOpen = false;
    this.renderExportPop();
    this.toast("已导出 " + entries.length + " 条记录。可下载 skill 辅助本地 Agent 分析。", "ok");
  },

  clearByTarget(goalId: string | null): void {
    const label = goalId ? "该目标下的记录" : "全部数据（目标、记录、队列）";
    if (!confirm("清空" + label + "？此操作不可恢复。")) return;
    if (goalId) {
      // 按 match 语义清空：删除记录中属于该目标的 match；无剩余 match 则删除整条记录
      const recs = Store.read<BrowseRecord[]>(K.records, []);
      const next: BrowseRecord[] = [];
      for (const r of recs) {
        if (r.matches && r.matches.length) {
          const rest = r.matches.filter((m) => m.goalId !== goalId);
          if (rest.length) {
            r.matches = rest;
            const top = rest.reduce((a, b) => (b.relevance > a.relevance ? b : a));
            r.category = "goal:" + top.goalId;
            next.push(r);
          }
          // 全部 match 都属于该目标 → 整条删除
        } else if (r.category !== "goal:" + goalId) {
          next.push(r);
        }
      }
      Store.write(K.records, next);
    } else {
      Object.values(K).forEach((k) => Store.del(k));
    }
    this.render();
  },

  clearSelected(): void {
    const sel = this.root!.querySelector('[data-role="clear-select"]') as HTMLSelectElement;
    const value = sel?.value || "";
    if (!value) { this.toast("请先在下拉菜单里选择要清空的内容", "idle"); return; }
    if (value === "all") {
      this.clearByTarget(null);
    } else if (value === "slacking") {
      if (!confirm("清空摸鱼记录？此操作不可恢复。")) return;
      Store.write(K.records, Store.read<BrowseRecord[]>(K.records, []).filter((r) => r.category !== "slacking"));
      this.render();
    } else {
      this.clearByTarget(value);
    }
    if (sel) sel.value = "";
  },

  // ---- 设置 ----
  saveSettings(): void {
    const ta = this.root!.querySelector('[data-role="prompt-input"]') as HTMLTextAreaElement;
    saveSettings({ analysisPrompt: (ta?.value || "").trim() });
    this.toast("设置已保存", "ok");
    this.render();
  },

  resetPrompt(): void {
    saveSettings({ analysisPrompt: "" });
    this.toast("已重置为预设提示词", "ok");
    this.render();
  },

  copyText(text: string): void {
    navigator.clipboard?.writeText(text).then(() => this.toast("已复制：" + text, "ok"));
  },

  searchTerm(term: string): void {
    const s = settings();
    navigator.clipboard?.writeText(term);
    const resolved = resolveLinkedUrl(s.linkedUrl || "");
    if (resolved.url) {
      const finalUrl = resolved.url.replace(/\{q\}/g, encodeURIComponent(term));
      window.open(finalUrl, "_blank", "noopener");
      if (resolved.usedTemplate) {
        this.toast("已识别站点并跳转到搜索结果页。", "ok");
      } else if (resolved.url.includes("{q}")) {
        this.toast("已跳转到搜索结果页。", "ok");
      } else {
        this.toast("已复制搜索词并跳转到关联网址。提示：在关联网址中加入 {q} 可直达搜索结果页。", "ok");
      }
    } else {
      this.toast("已复制搜索词。建议先填写关联网址，以便一键跳转。", "ok");
    }
  },

  async aiFillLinkedUrl(): Promise<void> {
    const input = this.root!.querySelector('[data-role="linked-url"]') as HTMLInputElement;
    const raw = (input?.value || "").trim();
    if (!raw) { this.toast("请先在输入框填站点名或网址", "idle"); return; }
    const bridge = (window as unknown as { LLMBridge?: { chat(p: string, f?: string): Promise<string> } }).LLMBridge;
    if (!bridge) {
      this.toast("AI 暂不可用（未检测到 LLMBridge）。可手动填写带 {q} 的搜索网址。", "err");
      return;
    }
    this.toast("AI 正在识别站点并补全搜索参数…", "idle");
    try {
      const rawAns = await bridge.chat(
        "用户要在一个浏览器扩展里设置一个“关联网址”，用来一键跳转搜索。请根据用户给出的站点，返回该站点的搜索结果页 URL 模板。" +
        "模板中把搜索关键词的位置写成 {q} 占位符。" +
        "只输出一个 JSON（不要代码块、不要解释）：{\"template\":\"完整的搜索URL模板，含 {q}\"}" +
        "规则：1) 若该站点不支持 URL 参数搜索，template 返回空字符串；2) 若已知该站点有反爬/需登录，仍返回理论上正确的模板；3) URL 必须完整，以 http(s) 开头。" +
        "\n\n站点：" + raw,
        "json"
      );
      const obj = JSON.parse(rawAns);
      const tpl = String(obj.template || "").trim();
      if (!tpl) { this.toast("未能识别该站点的搜索方式，请手动填写带 {q} 的网址。", "err"); return; }
      if (input) input.value = tpl;
      saveSettings({ linkedUrl: tpl });
      this.toast("已补全：" + tpl, "ok");
    } catch (err) {
      this.toast("AI 补全失败：" + String(err), "err");
    }
  },

  linkedUrlNotice(v: string): void {
    const resolved = resolveLinkedUrl(v);
    confirm(
      "已设置关联网址：" + (resolved.url || v) + "\n\n" +
      "说明：拾知的记录按浏览器同源策略隔离存储，每个站点只能查看自己域下抓到的记录，无法跨源汇总。\n\n" +
      "关联网址仅作为“搜索”按钮的默认跳转目标，不会把记录同步到该站点。\n\n" +
      "小技巧：在网址中加入 {q} 占位符（例如 https://www.zhihu.com/search?type=content&q={q}），点击搜索词后会直接跳转到该站点的搜索结果页，无需手动粘贴。\n\n" +
      "也可以只填裸域名（如 zhihu.com、juejin.cn、csdn.net、read.douban.com、medium.com、维基百科等），拾知会自动识别并直达搜索结果页。\n\n" +
      "如需跨源汇总，可在各源导出记录后，下载 skill 交给本地 Agent 分析。"
    );
    const normalized = resolveLinkedUrl(v).url || v;
    if (normalized !== v) saveSettings({ linkedUrl: normalized });
  },

  showHelp(): void {
    confirm(
      "拾知 · 使用说明\n\n" +
      "1. 开启右上角「工作模式」开关，拾知会自动记录你浏览的网页。\n" +
      "2. 在「目标」里创建目标，并拆解为任务/子任务，让记录有处可归。\n" +
      "3. 每打开一个网页，拾知会自动分析并归档到最相关的目标，无关内容归入摸鱼。\n" +
      "4. 右下角待办气泡会给出下一步建议，点击搜索词可一键跳转到关联网址搜索。\n" +
      "5. 点击目标里的任意分类，可跳转到该分类下的记录。\n" +
      "6. 在「设置」里可编辑分析提示词、清空记录、填写关联网址。\n" +
      "7. 底部「关联网址」框只需填站点名或网址，点旁边的 ✦ 图标，AI 会自动补全该站点的搜索参数，之后点搜索词即可直达结果页。\n\n" +
      "数据说明：拾知的记录保存在浏览器本地，按同源策略隔离，每个站点只能查看自己域下的记录。如需跨源汇总，请分别在各站点导出记录后，下载配套 skill 辅助本地 Agent 分析。\n\n" +
      "温馨提示：AI 分析可能存在偏差，重要结论请自行核对原始网页。拾知的所有记录都保存在本地浏览器，不会上传。"
    );
  },

  // ---- 用户画像 ----
  addProfile(): void {
    const input = this.root!.querySelector('[data-role="profile-input"]') as HTMLInputElement;
    const kind = (this.root!.querySelector('[data-role="profile-kind"]') as HTMLSelectElement).value as "facts" | "preferences";
    const text = (input?.value || "").trim();
    if (!text) return;
    const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
    (profile[kind] = profile[kind] || []).unshift(text);
    profile.updatedAt = Date.now();
    Store.write(K.profile, profile);
    if (input) input.value = "";
    this.renderProfile();
    this.toast("已添加画像条目", "ok");
  },

  delProfile(kind: "facts" | "preferences", idx: number): void {
    const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
    profile[kind] = (profile[kind] || []).filter((_, i) => i !== idx);
    profile.updatedAt = Date.now();
    Store.write(K.profile, profile);
    this.renderProfile();
  },

  async generateProfileWithAI(): Promise<void> {
    const bridge = (window as unknown as { LLMBridge?: { chat(p: string, f?: string): Promise<string> } }).LLMBridge;
    if (!bridge) {
      this.toast("AI 暂不可用（未检测到 LLMBridge）。可手动添加画像条目。", "err");
      return;
    }
    const recs = Store.read<BrowseRecord[]>(K.records, []).filter((r) => r.summary && r.category.startsWith("goal:"));
    if (!recs.length) {
      this.toast("暂无已归档的记录，无法生成画像。", "idle");
      return;
    }
    this.toast("AI 正在归纳用户画像…", "idle");
    try {
      const sample = recs.slice(0, 20).map((r) => r.summary).join("\n---\n");
      const raw = await bridge.chat(
        "根据以下浏览记录摘要，归纳用户的画像。输出 JSON（不要输出其他内容）：" +
        '{"facts":["关于用户的事实", "..."],"preferences":["用户的偏好", "..."]}' +
        "规则：facts 和 preferences 各 1-5 条，每条一句话、具体、避免空泛。\n\n" + sample.slice(0, 4000),
        "json"
      );
      const obj = JSON.parse(raw);
      const facts = (Array.isArray(obj.facts) ? obj.facts : []).slice(0, 8).map((x: unknown) => String(x).trim()).filter(Boolean);
      const preferences = (Array.isArray(obj.preferences) ? obj.preferences : []).slice(0, 8).map((x: unknown) => String(x).trim()).filter(Boolean);
      if (!facts.length && !preferences.length) { this.toast("AI 未产出有效画像，请稍后重试。", "idle"); return; }
      const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
      profile.facts = Array.from(new Set([...(profile.facts || []), ...facts])).slice(0, 20);
      profile.preferences = Array.from(new Set([...(profile.preferences || []), ...preferences])).slice(0, 20);
      profile.updatedAt = Date.now();
      Store.write(K.profile, profile);
      this.renderProfile();
      this.toast("已生成画像：" + facts.length + " 条事实、" + preferences.length + " 条偏好", "ok");
    } catch (err) {
      this.toast("画像生成失败：" + String(err), "err");
    }
  },

  // ---- 输入自动补全 ----
  onFocusIn(e: FocusEvent): void {
    const t = e.target as HTMLElement;
    if (!t) return;
    // 忽略拾知自身 shadow 内元素
    if (e.composedPath().some((n) => n === this.root)) { this.hideAutocomplete(); return; }
    const tag = t.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") { this.hideAutocomplete(); return; }
    const el = t as HTMLInputElement | HTMLTextAreaElement;
    if (el.type === "password" || el.type === "hidden" || el.readOnly || el.disabled) { this.hideAutocomplete(); return; }
    focusedInput = el;
    this.showAutocomplete(el);
  },

  showAutocomplete(el: HTMLInputElement | HTMLTextAreaElement): void {
    const rect = el.getBoundingClientRect();
    const ac = this.els.autocomplete;
    if (!ac) return;
    ac.innerHTML = `<button class="sz-ac-tip" data-act="ac-complete">${ICONS.bulb} AI 补全（Ctrl+.）</button>`;
    ac.classList.add("open");
    ac.style.left = rect.left + "px";
    ac.style.top = (rect.bottom + 4) + "px";
  },

  hideAutocomplete(): void {
    this.els.autocomplete.classList.remove("open");
  },

  async completeInput(): Promise<void> {
    const el = focusedInput;
    this.hideAutocomplete();
    if (!el || !document.contains(el)) {
      this.toast("请先聚焦页面上的输入框", "idle");
      return;
    }
    const bridge = (window as unknown as { LLMBridge?: { chat(p: string, f?: string): Promise<string> } }).LLMBridge;
    if (!bridge) {
      this.toast("AI 暂不可用（未检测到 LLMBridge）。", "err");
      return;
    }
    const existing = el.value || (el as HTMLTextAreaElement).textContent || "";
    if (!existing.trim()) {
      this.toast("输入框内容为空，请先输入开头几个字。", "idle");
      return;
    }
    this.toast("AI 正在补全…", "idle");
    try {
      const raw = await bridge.chat(
        "请为输入框补全内容，直接给出补全后的完整文本（不要解释，不要引号包裹）。" +
        "结合页面标题「" + document.title + "」理解上下文。\n\n当前输入：" + existing,
        undefined
      );
      const text = String(raw).trim();
      if (!text) { this.toast("AI 未产出内容，请重试。", "idle"); return; }
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
      this.toast("已补全，可继续编辑。", "ok");
    } catch (err) {
      this.toast("补全失败：" + String(err), "err");
    }
  },

  // ---- 右键「塞给 AI」 ----
  onContextMenu(e: MouseEvent): void {
    const sel = window.getSelection()?.toString().trim() || "";
    if (!sel) { this.hideCtxMenu(); return; }
    // 在拾知面板内部右键时不拦截（保留面板自身交互）
    if (e.composedPath().some((n) => n === this.root)) { this.hideCtxMenu(); return; }
    e.preventDefault();
    const m = this.els.ctxmenu;
    m.innerHTML = `
      <button class="sz-ctxmenu-item" data-act="send-ai">${ICONS.bulb} 塞给 AI 分析（${sel.length} 字）</button>
      <button class="sz-ctxmenu-item" data-act="send-ai-summary">${ICONS.copy} AI 摘要选中内容</button>`;
    m.classList.add("open");
    m.style.left = e.clientX + "px";
    m.style.top = e.clientY + "px";
  },

  hideCtxMenu(): void {
    this.els.ctxmenu.classList.remove("open");
  },

  async sendSelectionToAI(mode: "analyze" | "summary"): Promise<void> {
    const sel = window.getSelection()?.toString().trim() || "";
    if (!sel) { this.hideCtxMenu(); return; }
    this.hideCtxMenu();
    const bridge = (window as unknown as { LLMBridge?: { chat(p: string, f?: string): Promise<string> } }).LLMBridge;
    if (!bridge) {
      this.toast("AI 暂不可用（未检测到 LLMBridge）。请确认在 Tabbit 环境中运行。", "err");
      return;
    }
    const prompt = mode === "summary"
      ? "请用不超过 3 句话概括以下网页选中内容，提炼核心信息：\n\n" + sel
      : "请分析以下网页选中内容，指出它与哪些工作目标/任务可能相关，给出 1-2 句判断：\n\n" + sel;
    this.toast("AI 正在分析选中内容…", "idle");
    try {
      const raw = await bridge.chat(prompt, "json");
      let text = raw;
      try {
        const obj = JSON.parse(raw);
        if (typeof obj === "object" && obj !== null) {
          text = (obj.summary || obj.analysis || obj.result || raw).toString();
        }
      } catch { /* 非 JSON 直接展示 */ }
      this.toast(text.slice(0, 280), "ok");
    } catch (err) {
      this.toast("分析失败：" + String(err), "err");
    }
  },

  // ---- 拖拽 ----
  onDragStart(e: DragEvent): void {
    const row = (e.target as Element).closest("[draggable='true'][data-kind]") as HTMLElement | null;
    if (!row) return;
    UI.drag = {
      kind: row.dataset.kind as "goal" | "task" | "subtask",
      id: row.dataset.id || "",
      parent: row.dataset.parent || "",
    };
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", row.dataset.id || "");
  },

  onDragOver(e: DragEvent): void {
    if (!UI.drag) return;
    const row = (e.target as Element).closest("[draggable='true'][data-kind]") as HTMLElement | null;
    if (!row || row.dataset.kind !== UI.drag.kind) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    this.clearDragOver();
    row.classList.add("dragover");
  },

  onDrop(e: DragEvent): void {
    e.preventDefault();
    const row = (e.target as Element).closest("[draggable='true'][data-kind]") as HTMLElement | null;
    this.clearDragOver();
    if (!UI.drag || !row || row.dataset.kind !== UI.drag.kind) { UI.drag = null; return; }
    const targetId = row.dataset.id || "";
    const kind = UI.drag.kind;
    const goals = Store.read<Goal[]>(K.goals, []);
    if (kind === "goal") {
      reorder(goals, UI.drag.id, targetId);
      Store.write(K.goals, goals);
    } else if (kind === "task") {
      const g = goals.find((x) => x.id === UI.drag!.parent);
      if (g) { reorder(g.tasks || [], UI.drag.id, targetId); Store.write(K.goals, goals); }
    } else if (kind === "subtask") {
      const g = goals.find((x) => x.id === UI.drag!.parent);
      const task = g?.tasks?.find((t) => (t.subtasks || []).some((s) => s.id === UI.drag!.id));
      if (task) { reorder(task.subtasks || [], UI.drag.id, targetId); Store.write(K.goals, goals); }
    }
    UI.drag = null;
    this.render();
  },

  clearDragOver(): void {
    this.root!.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
  },

  // ---- 面板 resize ----
  onResizeStart(e: PointerEvent): void {
    e.preventDefault();
    const panel = this.els.panel;
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      const w = Math.min(560, Math.max(320, startW - (ev.clientX - startX)));
      panel.style.width = w + "px";
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  },

  // ---- 渲染 ----
  render(): void {
    if (!this.root) return;
    const st = getState();
    this.els.workmode.checked = !!st.workMode;
    this.els.fab.classList.toggle("on", !!st.workMode);
    this.els.tabs.forEach((t) => t.classList.toggle("act", t.dataset.tab === UI.tab));
    const linked = (this.root.querySelector('[data-role="linked-url"]') as HTMLInputElement);
    if (linked && linked !== document.activeElement) linked.value = settings().linkedUrl || "";

    if (UI.tab === "goals") this.renderGoals();
    else if (UI.tab === "records") this.renderRecords();
    else if (UI.tab === "profile") this.renderProfile();
    else this.renderSettings();

    this.renderTodo();
  },

  renderGoals(): void {
    const goals = Store.read<Goal[]>(K.goals, []);

    // 分类提示词（分类定义）行：展示或内联编辑
    const promptRow = (kind: "goal" | "task" | "subtask", id: string, prompt: string): string => {
      if (UI.editingPrompt === id) {
        return `<div class="sz-prompt-edit">
          <textarea class="sz-textarea" data-role="prompt-input" data-id="${esc(id)}" rows="2" placeholder="分类定义：告诉 AI 这个分类涵盖哪些内容，用于自动归档判断">${esc(prompt)}</textarea>
          <div class="sz-prompt-actions">
            <button class="sz-btn primary" data-act="prompt-save" data-id="${esc(id)}" data-pkind="${kind}">${ICONS.check} 保存</button>
            <button class="sz-btn" data-act="prompt-cancel">取消</button>
          </div>
        </div>`;
      }
      if (!prompt) {
        return `<div class="sz-prompt empty" data-act="edit-prompt" data-id="${esc(id)}" data-pkind="${kind}" title="点击添加分类定义">＋ 分类定义</div>`;
      }
      return `<div class="sz-prompt" data-act="edit-prompt" data-id="${esc(id)}" data-pkind="${kind}" title="点击编辑分类定义">${ICONS.bulb}<span class="sz-prompt-text">${esc(prompt)}</span></div>`;
    };

    // 折叠开关：无下级时用占位对齐
    const caret = (key: string, hasChild: boolean): string => {
      if (!hasChild) return `<span class="sz-caret-spacer"></span>`;
      const collapsed = UI.collapsed.has(key);
      return `<button class="sz-caret ${collapsed ? "" : "open"}" data-act="toggle-node" data-id="${esc(key)}" title="${collapsed ? "展开下级" : "折叠下级"}">${ICONS.chevron}</button>`;
    };

    const subtaskRow = (g: Goal, s: Subtask): string => `
      <div class="sz-row" draggable="true" data-kind="subtask" data-id="${esc(s.id)}" data-parent="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        <span class="sz-caret-spacer"></span>
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="subtask:${esc(s.id)}" title="点击查看该子任务下的记录">${esc(s.title)}</span>
        <button class="sz-ibtn" data-act="edit-sub" data-id="${esc(s.id)}" data-pid="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn danger" data-act="del-sub" data-id="${esc(s.id)}" data-pid="${esc(g.id)}" title="删除">${ICONS.trash}</button>
      </div>
      ${promptRow("subtask", s.id, s.prompt || "")}`;

    const taskRow = (g: Goal, t: Task): string => {
      const hasSub = (t.subtasks || []).length > 0;
      const collapsed = UI.collapsed.has("t:" + t.id);
      return `
      <div class="sz-row" draggable="true" data-kind="task" data-id="${esc(t.id)}" data-parent="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        ${caret("t:" + t.id, hasSub)}
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="task:${esc(t.id)}" title="点击查看该任务下的记录">${esc(t.title)}</span>
        <button class="sz-ibtn" data-act="edit-task" data-id="${esc(t.id)}" data-pid="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn danger" data-act="del-task" data-id="${esc(t.id)}" data-pid="${esc(g.id)}" title="删除">${ICONS.trash}</button>
      </div>
      ${promptRow("task", t.id, t.prompt || "")}
      ${collapsed ? "" : `
      <div class="sz-children">
        ${(t.subtasks || []).map((s) => subtaskRow(g, s)).join("")}
        <div class="sz-row">
          <span class="sz-caret-spacer"></span>
          <input class="sz-input" data-role="sub-input" data-pid="${esc(g.id)}" data-task="${esc(t.id)}" placeholder="添加子任务，回车确认" style="font-size:12px;padding:3px 6px">
        </div>
      </div>`}`;
    };

    const goalRow = (g: Goal): string => {
      const hasTasks = (g.tasks || []).length > 0;
      const collapsed = UI.collapsed.has("g:" + g.id);
      return `
    <div class="sz-node">
      <div class="sz-row" draggable="true" data-kind="goal" data-id="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        <button class="sz-ibtn" data-act="toggle-goal" data-id="${esc(g.id)}" title="${g.status === "active" ? "标记完成" : "重新开启"}" style="color:${g.status === "active" ? "var(--high)" : "var(--faint)"}">${ICONS.check}</button>
        ${caret("g:" + g.id, hasTasks)}
        <span class="sz-ntitle clickable ${g.status !== "active" ? "done" : ""}" data-act="goto-rec" data-id="goal:${esc(g.id)}" title="点击查看该目标下的记录">${esc(g.title)}</span>
        <button class="sz-ibtn" data-act="edit-goal" data-id="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn danger" data-act="del-goal" data-id="${esc(g.id)}" title="删除">${ICONS.trash}</button>
      </div>
      ${promptRow("goal", g.id, g.prompt || "")}
      ${collapsed ? "" : `
      <div class="sz-children">
        ${(g.tasks || []).map((t) => taskRow(g, t)).join("")}
        <div class="sz-row">
          <span class="sz-caret-spacer"></span>
          <input class="sz-input" data-role="task-input" data-pid="${esc(g.id)}" placeholder="添加任务，回车确认" style="font-size:12px;padding:3px 6px">
        </div>
      </div>`}
    </div>`};

    this.els.body.innerHTML = `
    <div class="sz-toolbar">
      <input class="sz-input" data-role="goal-input" placeholder="输入完整需求，AI 自动拆解为目标/任务" style="flex:1">
      <button class="sz-btn" data-act="ai-parse-goal" title="用 AI 把需求解析成目标并拆解任务/子任务">${ICONS.bulb} AI 拆解</button>
    </div>
    ${this.renderAiDraft()}
    ${goals.length ? '<div class="sz-note" style="margin-bottom:8px">拖拽左侧手柄可调整分类优先级，决定待办提示顺序<br><i>"P0！全都是P0！"</i></div>' : ""}
    ${goals.map(goalRow).join("") || '<div class="sz-empty">暂无目标。添加目标后，拾知会自动归档浏览记录。</div>'}
    <div class="sz-node" style="opacity:.95">
      <div class="sz-row" style="cursor:default">
        <span class="sz-grip" style="opacity:0">${ICONS.drag}</span>
        <span class="sz-caret-spacer"></span>
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="slacking" title="点击查看摸鱼记录">摸鱼</span>
      </div>
      <div class="sz-prompt" style="cursor:default" title="固定分类定义">不属于任何其它目标的记录</div>
    </div>`;
  },

  // AI 拆解结果确认卡片（可编辑后创建）
  renderAiDraft(): string {
    const d = UI.aiDraft;
    if (!d) return "";
    const taskBlocks = d.tasks.map((t, i) => `
      <div class="sz-ai-task">
        <div class="sz-ai-task-head"><span class="sz-ai-num">任务 ${i + 1}</span></div>
        <input class="sz-input" data-ai-task-title="${i}" value="${esc(t.title)}" placeholder="任务名称">
        <textarea class="sz-textarea sz-ai-ta" data-ai-task-prompt="${i}" rows="2" placeholder="任务级分类提示词（可选）">${esc(t.prompt || "")}</textarea>
        ${(t.subtasks || []).map((s, j) => `
        <div class="sz-ai-sub" style="display:block">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
            <span class="sz-ai-sub-dot" style="position:static">·</span>
            <input class="sz-input" data-ai-sub="${i}-${j}" value="${esc(s.title)}" placeholder="子任务名称" style="flex:1">
          </div>
          <textarea class="sz-textarea sz-ai-ta" data-ai-sub-prompt="${i}-${j}" rows="1" placeholder="子任务级分类提示词（可选）">${esc(s.prompt || "")}</textarea>
        </div>`).join("")}
      </div>`).join("");
    return `
    <div class="sz-ai-confirm">
      <div class="sz-ai-head">AI 拆解结果 —— 请确认或修改后再创建</div>
      ${d.questions && d.questions.length ? `<div style="background:#fff8e1;border:1px solid #f0d98c;border-radius:6px;padding:8px 10px;margin:8px 0;font-size:12px;color:#7a6a1f">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-weight:600">AI 需要你确认这些点，回答后点击右侧按钮重新拆解：</div>
          <button class="sz-btn" data-act="ai-reparse" style="font-size:11px;padding:4px 12px;background:var(--accent);color:#fff;border-color:var(--accent);white-space:nowrap">重新拆解</button>
        </div>
        ${d.questions.map((q, i) => `<div style="margin-bottom:6px"><div>· ${esc(q)}</div><input class="sz-input" data-ai-answer="${i}" placeholder="你的回答" style="margin-top:4px;font-size:12px;padding:4px 6px" value=""></div>`).join("")}
      </div>` : ""}
      <label class="sz-label">目标名称</label>
      <input class="sz-input" data-ai-title value="${esc(d.title)}" placeholder="目标名称">
      <label class="sz-label">目标级分类提示词（告诉 AI 这个目标涵盖哪些内容，用于自动归档判断）</label>
      <textarea class="sz-textarea" data-ai-prompt rows="2" placeholder="例如：与「增长数据看板」相关的产品需求、埋点方案、数据分析等">${esc(d.prompt || "")}</textarea>
      <div class="sz-ai-tasks">${taskBlocks || '<div class="sz-empty" style="padding:10px">无任务</div>'}</div>
      <div class="sz-ai-actions">
        <button class="sz-btn primary" data-act="ai-confirm">${ICONS.check} 确认创建</button>
        <button class="sz-btn" data-act="ai-cancel">取消</button>
      </div>
    </div>`;
  },

  renderRecords(): void {
    const allRecords = Store.read<BrowseRecord[]>(K.records, []);
    const goals = Store.read<Goal[]>(K.goals, []);
    const filter = UI.recFilter;
    const filterLabel = filter ? getFilterLabel(filter, goals) : "";

    // 记录视图：一条记录 = 一个网页在某分类下的针对性分析
    interface RecView {
      key: string;              // 唯一标识（recordId 或 recordId::matchIndex），用于展开/收起/删除
      rec: BrowseRecord;
      match: MatchEntry | null; // null = 无分类分析（pending/error/slacking/legacy）
    }
    const views: RecView[] = [];

    for (const r of allRecords) {
      const rawMatches = r.matches || [];

      if (filter === "slacking") {
        if (r.category === "slacking") views.push({ key: r.id, rec: r, match: null });
        continue;
      }
      if (filter) {
        // 三级分类过滤：只保留匹配该分类的 match（key 用原始数组下标，删除时可对齐）
        for (let i = 0; i < rawMatches.length; i++) {
          const m = rawMatches[i];
          if (m.relevance >= 50 && matchMatchesFilter(m, filter)) {
            views.push({ key: r.id + "::" + i, rec: r, match: m });
          }
        }
        continue;
      }

      // 无过滤：展示全部
      let pushed = false;
      for (let i = 0; i < rawMatches.length; i++) {
        const m = rawMatches[i];
        if (m.relevance >= 50) {
          views.push({ key: r.id + "::" + i, rec: r, match: m });
          pushed = true;
        }
      }
      if (!pushed) {
        views.push({ key: r.id, rec: r, match: null });
      }
    }

    // 排序
    const viewRel = (v: RecView): number => v.match ? v.match.relevance : 0;
    if (UI.recSort === "relevance") {
      views.sort((a, b) => viewRel(b) - viewRel(a) || b.rec.capturedAt - a.rec.capturedAt);
    } else {
      views.sort((a, b) => b.rec.capturedAt - a.rec.capturedAt);
    }

    // 搜索
    const q = UI.recQuery.trim().toLowerCase();
    const filtered = q
      ? views.filter((v) => {
          const r = v.rec;
          const m = v.match;
          const matchText = m
            ? (m.findings.join(" ") + " " + m.notes.map((n) => n.topic + " " + n.content).join(" ") + " " + m.reasoning)
            : "";
          return (r.title + " " + r.url + " " + (r.summary || "") + " " + (r.keywords || []).join(" ") + " " + matchText).toLowerCase().includes(q);
        })
      : views;

    const relClassOf = (num: number): string => num >= 80 ? "high" : num >= 60 ? "med" : "low";

    const recHtml = (v: RecView): string => {
      const r = v.rec;
      const m = v.match;
      const open = UI.expanded.has(v.key);
      const isPending = r.category === "pending";
      const isError = r.category === "error";

      const relDot = isPending
        ? '<span class="sz-rel none breath" title="分析中"></span>'
        : isError
          ? '<span class="sz-rel low" title="分析失败"></span>'
          : m
            ? `<span class="sz-rel ${relClassOf(m.relevance)}" title="相关度 ${m.relevance}%"></span>`
            : `<span class="sz-rel ${relevanceOf(r)}" title="相关度"></span>`;

      const url = r.url || "";
      let body = "";

      if (isPending) {
        body = `<div class="sz-pending-hint">正在分析中，请稍等片刻~</div>`;
      } else if (isError) {
        body = `<div class="sz-rsum">${esc(r.summary || r.preview || "")}</div>
          ${r.excerpt ? `<button class="sz-retry" data-act="retry" data-rid="${esc(r.id)}">重试分析</button>` : ""}`;
      } else {
        const longSummary = !!(r.summary && r.summary.length > 120);
        const fullOpen = UI.expandedFull.has(v.key);

        // 分类路径（有 match 时显示）
        const pathHtml = m
          ? `<div style="font-size:11px;font-weight:600;color:var(--accent);margin:6px 0 4px">${esc(matchPath(m, goals))}</div>`
          : "";

        let matchHtml = "";
        if (m) {
          const findingsHtml = m.findings.length
            ? `<div class="sz-findings"><div class="h">关键发现</div>${m.findings.map((f) => `<div class="sz-finding">${highlightText(f, q)}</div>`).join("")}</div>`
            : "";
          const notesHtml = m.notes.length
            ? m.notes.map((n) => `<div class="sz-note"><div class="t">${esc(n.topic)}</div><div class="c">${highlightText(n.content, q)}</div></div>`).join("")
            : "";
          const quotesHtml = m.keyQuotes.length
            ? `<div style="margin:6px 0;padding:6px 8px;background:#f8f9fa;border-left:3px solid var(--accent);border-radius:4px;font-size:12px;color:var(--muted)">${m.keyQuotes.map((kq) => `<div style="margin-bottom:4px"><div style="font-style:italic;color:var(--text)">"${esc(kq.quote)}"</div><div style="font-size:11px;margin-top:2px">— ${esc(kq.context)}</div></div>`).join("")}</div>`
            : "";
          matchHtml = `
            ${m.reasoning ? `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">${highlightText(m.reasoning, q)}</div>` : ""}
            ${findingsHtml}
            ${notesHtml}
            ${quotesHtml}`;
        } else {
          matchHtml = `
            ${(r.findings || []).length ? `<div class="sz-findings"><div class="h">关键发现</div>${r.findings!.map((f) => `<div class="sz-finding">${highlightText(f, q)}</div>`).join("")}</div>` : ""}
            ${(r.notes || []).map((n) => `<div class="sz-note"><div class="t">${esc(n.topic)}</div><div class="c">${highlightText(n.content, q)}</div></div>`).join("")}`;
        }

        body = `
          <div class="sz-rtitle">${highlightText(r.title || url, q)}</div>
          <div class="sz-rsum${longSummary && !fullOpen ? " clamp" : ""}">${highlightText(r.summary || r.preview || "", q)}</div>
          ${longSummary ? `<button class="sz-rlink" data-act="toggle-full" data-rid="${esc(v.key)}">${fullOpen ? "收起" : "查看全文"}</button>` : ""}
          ${(r.keywords || []).slice(0, 8).map((k) => `<span class="sz-kw">${highlightText(k, q)}</span>`).join("")}
          ${pathHtml}
          ${matchHtml}
          <div class="sz-racting">
            <a class="sz-rlink" data-act="rec-open" data-url="${esc(url)}" href="${esc(url)}" target="_blank" rel="noopener">${ICONS.ext} 打开原文</a>
            <button class="sz-rbtn" data-act="del-rec" data-rid="${esc(v.key)}">${ICONS.trash} 删除</button>
          </div>`;
      }

      return `
      <div class="sz-rec${open ? " open" : ""}" data-id="${esc(v.key)}">
        <div class="sz-rechead" data-act="toggle-rec">
          ${relDot}
          <span class="sz-rurl" title="${esc(url)}">${esc(r.title || url)}</span>
          <span class="sz-rtime">${fmtDate(r.capturedAt)}</span>
          <span class="sz-rcaret">${ICONS.chevron}</span>
        </div>
        <div class="sz-rbody">${body}</div>
      </div>`;
    };

    const filterBar = filter
      ? `<div class="sz-filterbar">
          <span class="sz-filter-name">当前分类：${esc(filterLabel)}</span>
          <button class="sz-btn" data-act="rec-back">返回全部</button>
        </div>`
      : "";
    const listHtml = `
    ${q ? `<div class="sz-search-hint">搜索“${esc(q)}”，匹配 ${filtered.length} 条记录</div>` : ""}
    ${filterBar}
    ${filtered.length
      ? filtered.map(recHtml).join("")
      : '<div class="sz-empty">' + (Store.read<BrowseRecord[]>(K.records, []).length ? "没有匹配的记录" : "暂无记录") + "</div>"}`;

    // 搜索框固定不随输入重建，避免焦点丢失
    const existingToolbar = this.root!.querySelector('[data-role="rec-toolbar"]');
    if (existingToolbar) {
      const listEl = this.root!.querySelector('[data-role="rec-list"]');
      if (listEl) { listEl.innerHTML = listHtml; return; }
    }
    this.els.body.innerHTML = `
    <div class="sz-toolbar" data-role="rec-toolbar">
      <input class="sz-input sz-search" data-role="rec-search" placeholder="搜索标题、摘要、关键词…" value="${esc(UI.recQuery)}">
      <div class="sz-seg">
        <button data-act="sort-time" class="${UI.recSort === "time" ? "act" : ""}">时间</button>
        <button data-act="sort-relevance" class="${UI.recSort === "relevance" ? "act" : ""}">相关度</button>
      </div>
    </div>
    <div data-role="rec-list">${listHtml}</div>`;
  },

  renderProfile(): void {
    const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
    const has = profile.facts.length || profile.preferences.length;
    const list = (items: string[], kind: "facts" | "preferences"): string => items.map((x, i) => `
      <div class="sz-todo-item">
        <div class="sz-todo-text">
          <span class="t">${esc(x)}</span>
          <button class="sz-ibtn danger" data-act="del-profile" data-kind="${kind}" data-idx="${i}" title="删除">${ICONS.trash}</button>
        </div>
      </div>`).join("");
    this.els.body.innerHTML = `
    <div class="sz-field">
      <span class="sz-label">添加画像条目</span>
      <div style="display:flex;gap:6px">
        <input class="sz-input" data-role="profile-input" placeholder="例如：偏好用 Python 写脚本">
        <select class="sz-input" data-role="profile-kind" style="max-width:96px;flex:none">
          <option value="facts">关于你</option>
          <option value="preferences">偏好</option>
        </select>
        <button class="sz-btn primary" data-act="add-profile">添加</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="sz-btn" data-act="ai-profile" title="根据已归档的记录，让 AI 归纳用户画像">${ICONS.bulb} 根据记录 AI 生成</button>
      </div>
    </div>
    ${has
      ? `${profile.facts.length ? `<div class="sz-sec">关于你</div>${list(profile.facts, "facts")}` : ""}${profile.preferences.length ? `<div class="sz-sec">偏好</div>${list(profile.preferences, "preferences")}` : ""}`
      : '<div class="sz-empty">暂无画像数据。可手动添加，或点击上方按钮让 AI 根据记录生成。</div>'}`;
  },

  renderSettings(): void {
    const s = settings();
    const goals = Store.read<Goal[]>(K.goals, []);
    const promptVal = s.analysisPrompt || PRESET_ANALYSIS_PROMPT;
    const cloneTabs: Array<{ key: typeof UI.cloneTab; label: string; cmd: string }> = [
      { key: "https", label: "HTTPS", cmd: "https://github.com/SkillRatLab/research-pilot.git" },
      { key: "ssh", label: "SSH", cmd: "git@github.com:SkillRatLab/research-pilot.git" },
      { key: "ghcli", label: "GitHub CLI", cmd: "gh repo clone SkillRatLab/research-pilot" },
    ];
    const activeClone = cloneTabs.find((t) => t.key === UI.cloneTab) || cloneTabs[0];
    this.els.body.innerHTML = `
    <div class="sz-field">
      <span class="sz-label">使用说明</span>
      <div class="sz-note">
        开启工作模式后，浏览网页会自动记录并按目标归档；在目标里拆任务/子任务，浏览内容会逐步推进待办。
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="sz-btn" data-act="help">查看完整使用说明</button>
      </div>
    </div>
    <div class="sz-field">
      <span class="sz-label">配套 Skill 下载</span>
      <div style="display:flex;gap:2px;margin-bottom:8px">
        ${cloneTabs.map((t) => `<button class="sz-btn" data-act="clone-tab" data-tab="${t.key}" style="border-bottom:${t.key === activeClone.key ? "2px solid transparent" : "2px solid var(--accent)"};border-radius:4px 4px 0 0;background:${t.key === activeClone.key ? "#f0f0f0" : "transparent"};padding:4px 10px;font-size:13px">${esc(t.label)}</button>`).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#f6f8fa;border:1px solid var(--border);border-radius:6px;font-family:ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace;font-size:12px;color:var(--text)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(activeClone.cmd)}</span>
        <button class="sz-btn" data-act="copy-clone" data-cmd="${esc(activeClone.cmd)}" style="padding:2px 8px;font-size:12px;flex-shrink:0">复制</button>
      </div>
    </div>
    <div class="sz-field">
      <span class="sz-label">记录处理提示词</span>
      <textarea class="sz-textarea" data-role="prompt-input" placeholder="${esc(PRESET_ANALYSIS_PROMPT)}" rows="12">${esc(promptVal)}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="sz-btn primary" data-act="save-settings">保存</button>
        <button class="sz-btn" data-act="reset-prompt">重置为预设</button>
      </div>
    </div>
    <div class="sz-field">
      <span class="sz-label">清空记录</span>
      <div style="display:flex;gap:6px;align-items:center">
        <select class="sz-input" data-role="clear-select" style="flex:1;min-width:120px">
          <option value="">— 选择要清空的记录 —</option>
          <option value="all">清空全部（目标 + 记录 + 队列）</option>
          <option value="slacking">清空「摸鱼」</option>
          ${goals.map((g) => `<option value="${esc(g.id)}">清空「${esc(g.title)}」</option>`).join("")}
        </select>
        <button class="sz-btn danger" data-act="clear-selected">执行清空</button>
      </div>
    </div>`;
  },

  renderExportPop(): void {
    const pop = this.root!.querySelector('[data-role="export-pop"]') as HTMLDivElement;
    if (!pop) return;
    if (!UI.exportOpen) { pop.style.display = "none"; return; }
    const goals = Store.read<Goal[]>(K.goals, []);
    pop.innerHTML = `
      <div class="sz-export-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <select class="sz-input" data-role="export-select" style="flex:1;min-width:140px">
          <option value="">— 选择要导出的记录 —</option>
          <option value="all">导出全部记录</option>
          ${goals.map((g) => `<option value="${esc(g.id)}">导出「${esc(g.title)}」</option>`).join("")}
        </select>
        <button class="sz-btn" data-act="export-cancel">取消</button>
        <button class="sz-btn primary" data-act="export-selected">导出</button>
      </div>`;
    pop.style.display = "block";
  },

  renderTodo(): void {
    const pop = this.els.todoPop;
    const txt = this.root!.querySelector('[data-role="todo-txt"]') as HTMLElement;
    const goals = Store.read<Goal[]>(K.goals, []);
    const sug = currentSuggestion(goals);
    txt.textContent = sug ? "当前建议：" + sug.todo.text : "待办";
    pop.classList.toggle("open", UI.todoOpen);
    if (!UI.todoOpen) return;

    const list = this.root!.querySelector('[data-role="todo-list"]') as HTMLElement;
    const activeGoals = goals.filter((g) => g.status === "active");
    if (!activeGoals.length) {
      list.innerHTML = '<div class="sz-empty">暂无目标</div>';
      return;
    }
    let html = "";
    for (const g of activeGoals) {
      const todos = g.todos || [];
      html += `<div class="sz-sec">${esc(g.title)}</div>`;
      if (!todos.length) {
        html += '<div class="sz-empty" style="padding:4px 0">暂无待办建议</div>';
        continue;
      }
      html += todos.map((t) => {
        const pct = Math.round(Math.min(1, t.coverage || 0) * 100);
        const rawTerms = t.searchTerms || [];
        const terms = rawTerms.filter(Boolean).slice(0, 3);
        const termRows = terms.length
          ? terms.map((s) => `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><button class="sz-copy" data-act="copy-term" data-term="${esc(s)}" title="复制" style="flex:1;justify-content:flex-start">${ICONS.copy} <span style="margin-left:3px">${esc(s)}</span></button><button class="sz-copy" data-act="search-term" data-term="${esc(s)}" title="跳转搜索">${ICONS.ext} 搜索</button></div>`).join("")
          : `<div style="color:var(--faint);font-size:11px;margin-top:3px">浏览相关页面后搜索词会自动补充</div>`;
        return `
        <div class="sz-todo-item">
          <div class="sz-todo-text">
            <span class="sz-dot" style="background:${t.status === "done" ? "var(--high)" : "var(--accent)"}"></span>
            <span class="t">${esc(t.text)}</span>
          </div>
          <div class="sz-bar"><i style="width:${pct}%"></i></div>
          <div class="sz-todo-meta" style="flex-direction:column;align-items:flex-start">
            <span>${pct}%</span>
            ${termRows}
          </div>
        </div>`;
      }).join("");
    }
    list.innerHTML = html || '<div class="sz-empty">暂无待办建议。目标下添加任务/子任务后，AI 会生成待办。</div>';
  },

  toast(text: string, kind?: string): void {
    if (!this.root) return;
    const t = document.createElement("div");
    t.className = "sz-toast " + (kind || "ok");
    t.textContent = text;
    this.els.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },
};

function saveSettings(patch: Partial<Settings>): void {
  Store.write(K.settings, Object.assign({}, settings(), patch));
}
