// 面板 UI（Shadow DOM）：目标树/记录/画像/设置 四 Tab + todo 气泡 + 面板拖拽/缩放 + 主题切换
// 说明：本模块只做前端交互与视觉，不修改后端（采集/分析/队列）逻辑。

import panelCss from "./panel.css";
import panelHtml from "./panel.html";
import fabLogoUrl from "./fab-logo.jpg";
import {K} from "../core/constants.js";
import {clamp, esc, uid, normalizeSearchTerm, enrichSearchTerm} from "../core/utils.js";
import {getState, settings, Store} from "../store.js";
import {onLocationChange} from "../watcher.js";
import {pumpQueue} from "../queue.js";
import { PRESET_ANALYSIS_PROMPT } from "../core/prompt.js";
import type {BrowseRecord, Goal, MatchEntry, Profile, QueueItem, Settings, SearchTerm, Subtask, Task, Todo} from "../types.js";

// 设置面板使用的预设提示词（与 core/prompt.ts 中的 PRESET_ANALYSIS_PROMPT 保持一致）
const PRESET_PROMPT = PRESET_ANALYSIS_PROMPT;

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
  back: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  drag: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};

// 当前聚焦的宿主页面输入框（用于输入自动补全）
let focusedInput: HTMLInputElement | HTMLTextAreaElement | null = null;

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return hh + ":" + mm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hh + ":" + mm;
}

// 搜索命中片段高亮（输出已转义 HTML）
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

// 当前待办建议：取优先级最高的（数组最前的）进行中目标里第一个未完成且覆盖度不足的 todo
// 若目标没有 todo（未拆解任务），则返回目标标题本身作为建议
// 优先级与目标数组顺序直接挂钩；拖拽调整目标顺序即调整优先级
function currentSuggestion(goals: Goal[]): { text: string; goal: Goal } | null {
  for (const g of goals) {
    if (g.status !== "active") continue;
    const todos = g.todos || [];
    for (const t of todos) {
      if (t.status === "open" && (t.coverage || 0) < 0.9) return { text: t.text, goal: g };
    }
    // 没有 todo 的 active goal：用第一个 task 标题或目标标题作为建议
    if (!todos.length) {
      const firstTask = g.tasks?.[0];
      return { text: firstTask ? firstTask.title : g.title, goal: g };
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

function saveSettings(patch: Partial<Settings>): void {
  Store.write(K.settings, Object.assign({}, settings(), patch));
}

// 首次使用写入演示数据，便于理解面板结构（已有数据则不覆盖）
function seedDemoData(): void {
  const goals = Store.read<Goal[]>(K.goals, []);
  const records = Store.read<BrowseRecord[]>(K.records, []);
  if (goals.length || records.length) return;

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
      { id: "demo-todo1", text: "收集季度数据", taskId: "demo-t1", contrib: {}, coverage: 0.4, status: "open", manual: false, searchTerms: ["季度数据", "Q3 营收"] },
      { id: "demo-todo2", text: "校对排版", taskId: "demo-t2", contrib: {}, coverage: 0, status: "open", manual: false, searchTerms: ["排版规范"] },
    ],
  };
  const g2: Goal = {
    id: "demo-g2",
    title: "学习 React",
    status: "active",
    createdAt: Date.now() - 86400000 * 5,
    tasks: [],
    todos: [
      { id: "demo-todo3", text: "看完官方文档 Hooks 章节", contrib: {}, coverage: 0.1, status: "open", manual: false, searchTerms: ["React Hooks"] },
    ],
  };
  Store.write(K.goals, [g1, g2]);

  const longSummary =
    "这是一条用于测试「查看全文/收起」功能的长摘要。正文摘录会被截断并显示展开按钮，点击后可查看完整内容。" +
    "季度报告需要汇总各部门 KPI、营收增速、用户留存等核心指标，并与去年同期进行环比分析。".repeat(3);

  Store.write(K.records, [
    {
      id: "demo-r1", url: "https://example.com/report-template", origin: "example.com",
      title: "季度报告模板", h1: "季度报告模板", meta: "report",
      capturedAt: Date.now() - 3600000 * 2, excerptHash: "h1", preview: "预览内容",
      category: "goal:demo-g1", relevance: 85,
      findings: ["模板结构完整，可直接套用"],
      notes: [{ topic: "报告结构", content: "包含 KPI、增速、留存三个核心模块。", relevance: 90 }],
      summary: longSummary, keywords: ["报告", "季度", "模板"],
    },
    {
      id: "demo-r2", url: "https://example.com/data-source", origin: "example.com",
      title: "数据中心", h1: "数据中心", meta: "data",
      capturedAt: Date.now() - 3600000 * 4, excerptHash: "h2", preview: "预览",
      category: "goal:demo-g1", relevance: 55,
      summary: "各部门数据汇总页面，可导出 CSV 和 Excel。", keywords: ["数据", "导出"],
    },
    {
      id: "demo-r3", url: "https://example.com/slacking", origin: "example.com",
      title: "摸鱼网页", h1: "娱乐", meta: "fun",
      capturedAt: Date.now() - 3600000 * 6, excerptHash: "h3", preview: "预览",
      category: "slacking", summary: "无关的娱乐内容。", keywords: ["娱乐"],
    },
  ]);

  Store.write(K.state, { workMode: true, activeSince: Date.now() });
}

export const Panel = {
  tab: "goals",
  recQuery: "",
  recSort: "time" as "time" | "rel",
  recGroup: null as string | null, // 组内视图：当前选中分组的 key，null 为总览
  recDeleteMode: false, // 记录多选删除模式
  recSelected: new Set<string>(), // 多选删除中选中的记录项 key
  collapsed: new Set<string>(), // 折叠的分类节点（"g:{id}" | "t:{id}"）
  editingPrompt: null as null | string, // 正在编辑分类提示词的节点 id
  aiDraft: null as null | { title: string; prompt: string; tasks: Task[]; questions: string[]; originalText: string }, // AI 拆解待确认结果
  todoOpen: false,
  exportOpen: false,
  drag: null as null | { kind: "goal" | "task" | "subtask"; id: string; parent: string },
  root: null as ShadowRoot | null,
  pos: { x: 0, y: 0 },
  suppressFabClick: false,
  animTimer: 0,
  panelSize: null as { w: number; h: number } | null,
  cloneTab: "https" as "https" | "ssh" | "ghcli",
  els: {} as {
    dock: HTMLDivElement;
    fab: HTMLButtonElement;
    resize: HTMLDivElement;
    pending: HTMLSpanElement;
    panel: HTMLDivElement;
    body: HTMLDivElement;
    toasts: HTMLDivElement;
    toolbar: HTMLDivElement;
    rectools: HTMLDivElement;
    sortBtn: HTMLButtonElement;
    searchInput: HTMLInputElement;
    workmode: HTMLInputElement;
    todoPop: HTMLDivElement;
    ctxmenu: HTMLDivElement;
    autocomplete: HTMLDivElement;
    tabs: HTMLButtonElement[];
    themeBtn: HTMLButtonElement;
  },
  mount(): void {
    seedDemoData();
    const host = document.createElement("div");
    host.id = "shizhi-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${panelCss}</style>${panelHtml
      .replace(/\{\{logo\}\}/g, `<img class="sz-fab-logo" src="${fabLogoUrl}" alt="拾知" draggable="false">`)
      .replace(/\{\{bulb\}\}/g, ICONS.bulb)
      .replace(/\{\{close\}\}/g, ICONS.x)
      .replace(/\{\{download\}\}/g, ICONS.download)
      .replace(/\{\{sparkle\}\}/g, ICONS.sparkle)}`;
    document.documentElement.appendChild(host);
    this.root = shadow;
    this.els = {
      dock: shadow.querySelector(".sz-dock")!,
      fab: shadow.querySelector(".sz-fab")!,
      resize: shadow.querySelector(".sz-resize")!,
      pending: shadow.querySelector('[data-role="pending"]')!,
      panel: shadow.querySelector(".sz-panel")!,
      body: shadow.querySelector(".sz-body")!,
      toasts: shadow.querySelector(".sz-toasts")!,
      toolbar: shadow.querySelector('[data-role="rec-toolbar"]')!,
      rectools: shadow.querySelector(".sz-rectools")!,
      sortBtn: shadow.querySelector('[data-act="rec-sort"]')!,
      searchInput: shadow.querySelector('[data-role="rec-search"]')!,
      workmode: shadow.querySelector('[data-role="workmode"]')!,
      todoPop: shadow.querySelector('[data-role="todo-pop"]')!,
      ctxmenu: shadow.querySelector('[data-role="ctxmenu"]')!,
      autocomplete: shadow.querySelector('[data-role="autocomplete"]')!,
      tabs: Array.from(shadow.querySelectorAll(".sz-tab")),
      themeBtn: shadow.querySelector('[data-act="theme"]')!,
    };
    const saved = Store.read<{ x: number; y: number } | null>(K.fabPos, null);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) this.placeDock(saved.x, saved.y);
    else this.placeDock(window.innerWidth - 56, window.innerHeight - 56); // 默认右下角
    addEventListener("resize", () => this.placeDock(this.pos.x, this.pos.y)); // 窗口变化后保持图标在视口内
    const psz = Store.read<{ w: number; h: number } | null>(K.panelSize, null);
    if (psz && Number.isFinite(psz.w) && Number.isFinite(psz.h)) {
      this.panelSize = {
        w: clamp(psz.w, 280, Math.round(window.innerWidth * 0.9)),
        h: clamp(psz.h, 240, Math.round(window.innerHeight * 0.8)),
      };
      this.applyPanelSize();
    }
    this.initDrag();
    this.initResize();
    this.initTheme();
    this.recSort = Store.read<string>(K.recSort, "time") === "rel" ? "rel" : "time";
    shadow.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    shadow.addEventListener("input", (e) => this.onInput(e as Event));
    shadow.addEventListener("change", (e) => this.onChange(e as Event));
    shadow.addEventListener("keydown", (e) => this.onKeydown(e as KeyboardEvent));

    // 右键「塞给 AI」：在宿主页面选中文字后右键弹出
    document.addEventListener("contextmenu", (e) => this.onContextMenu(e as MouseEvent));
    document.addEventListener("click", () => {
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

    // 目标树拖拽排序
    shadow.addEventListener("dragstart", (e) => this.onDragStart(e as DragEvent));
    shadow.addEventListener("dragover", (e) => this.onDragOver(e as DragEvent));
    shadow.addEventListener("drop", (e) => this.onDrop(e as DragEvent));
    shadow.addEventListener("dragend", () => { this.drag = null; this.clearDragOver(); });

    this.render();
  },
  onClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest("[data-act]") as HTMLElement | null;
    if (!btn) {
      // 点击导出浮层外部区域时关闭浮层
      const t = e.target as Element;
      if (this.exportOpen && !t.closest('[data-role="export-pop"]')) {
        this.exportOpen = false;
        this.renderExportPop();
      }
      return;
    }
    const act = btn.dataset.act;
    if (act === "fab") { if (!this.suppressFabClick) this.els.panel.classList.toggle("open"); } // 拖拽后的 click 不触发展开
    else if (act === "close") this.els.panel.classList.remove("open");
    else if (act === "tab") this.switchTab(btn.dataset.tab!);
    else if (act === "export") { this.exportOpen = !this.exportOpen; this.renderExportPop(); }
    else if (act === "export-selected") this.exportSelected();
    else if (act === "export-cancel") this.exportCancel();
    else if (act === "todo-bar") { this.todoOpen = !this.todoOpen; this.renderTodo(); }
    else if (act === "todo-close") { this.todoOpen = false; this.renderTodo(); }
    else if (act === "copy-term") this.copyText(btn.dataset.term || "");
    else if (act === "search-term") this.searchTerm(btn.dataset.term || "");
    else if (act === "add-goal") this.addNode("goal", "");
    else if (act === "ai-parse-goal") this.parseGoalWithAI();
    else if (act === "edit-goal") this.editGoal(btn.dataset.id || "");
    else if (act === "edit-task") this.editTask(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "edit-sub") this.editSub(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "del-goal") this.delGoal(btn.dataset.id || "");
    else if (act === "del-task") this.delTask(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "del-sub") this.delSub(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "toggle-goal") this.toggleGoal(btn.dataset.id || "");
    else if (act === "toggle-node") this.toggleNode(btn.dataset.id || "");
    else if (act === "edit-prompt") { this.editingPrompt = btn.dataset.id || ""; this.render(); }
    else if (act === "prompt-save") this.savePrompt(btn.dataset.pkind as "goal" | "task" | "subtask", btn.dataset.id || "");
    else if (act === "prompt-cancel") { this.editingPrompt = null; this.render(); }
    else if (act === "ai-confirm") this.confirmAiDraft();
    else if (act === "ai-cancel") this.cancelAiDraft();
    else if (act === "ai-reparse") this.reparseGoalWithAI();
    else if (act === "goto-rec") this.gotoGroup(btn.dataset.id || "", btn.dataset.kind || "");
    else if (act === "retry") this.retryRecord(btn.dataset.rid || "");
    else if (act === "rec-sort") {
      const sort = btn.dataset.sort as "time" | "rel";
      if (sort && sort !== this.recSort) {
        this.recSort = sort;
        Store.write(K.recSort, this.recSort);
        this.render();
      }
    }
    else if (act === "enter-group") this.enterGroup(btn.dataset.key!);
    else if (act === "leave-group") this.leaveGroup();
    else if (act === "expand") { btn.closest(".sz-rec")!.classList.toggle("expanded"); }
    else if (act === "del-mode") this.toggleDeleteMode();
    else if (act === "del-cancel") { this.recDeleteMode = false; this.recSelected.clear(); this.render(); }
    else if (act === "del-confirm") this.confirmDeleteSelected();
    else if (act === "rec-check") { const k = btn.dataset.key!; if ((btn as HTMLInputElement).checked) this.recSelected.add(k); else this.recSelected.delete(k); this.render(); }
    else if (act === "theme") this.toggleTheme();
    else if (act === "reset-prompt") this.resetPrompt();
    else if (act === "clear-selected") this.clearSelected();
    else if (act === "ai-linked") this.aiFillLinkedUrl();
    else if (act === "save-settings") this.saveSettings();
    else if (act === "clone-tab") { this.cloneTab = (btn.dataset.tab || "https") as typeof this.cloneTab; this.renderSettings(); }
    else if (act === "copy-clone") this.copyText(btn.dataset.cmd || "");
    else if (act === "help") this.showHelp();
    else if (act === "add-profile") this.addProfile();
    else if (act === "del-profile") this.delProfile(btn.dataset.kind as "facts" | "preferences", Number(btn.dataset.idx || 0));
    else if (act === "ai-profile") this.generateProfileWithAI();
    else if (act === "ac-complete") this.completeInput();
    else if (act === "send-ai") this.sendSelectionToAI("analyze");
    else if (act === "send-ai-summary") this.sendSelectionToAI("summary");
  },
  onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-role="rec-search"]')) { this.recQuery = t.value; this.renderRecords(); }
  },
  onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-role="workmode"]')) {
      const st = getState();
      st.workMode = (t as HTMLInputElement).checked;
      if ((t as HTMLInputElement).checked && !st.activeSince) st.activeSince = Date.now();
      Store.write(K.state, st);
      this.render();
      if ((t as HTMLInputElement).checked) onLocationChange(); // 开启后立即评估当前页
    } else if (t.matches('[data-role="linked-url"]')) {
      const v = (t as HTMLInputElement).value.trim();
      saveSettings({ linkedUrl: v });
      if (v) this.linkedUrlNotice(v);
    }
  },
  onKeydown(e: KeyboardEvent): void {
    const t = e.target as Element;
    if (e.key === "Enter") {
      if (t.matches('[data-role="goal-input"]')) {
        if (typeof (window as any).LLMBridge !== "undefined") this.parseGoalWithAI();
        else this.addNode("goal", "");
      }
      else if (t.matches('[data-role="task-input"]')) this.addNode("task", (t as HTMLElement).dataset.pid || "");
      else if (t.matches('[data-role="sub-input"]')) this.addNode("subtask", (t as HTMLElement).dataset.pid || "");
    } else if (e.key === "Escape") {
      if (this.exportOpen) { this.exportOpen = false; this.renderExportPop(); }
      if (this.todoOpen) { this.todoOpen = false; this.renderTodo(); }
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
      const taskId = uid("t");
      g.tasks.push({ id: taskId, title, prompt: "", subtasks: [] });
      // 同步创建对应的 todo，让 todo 系统生效
      g.todos = g.todos || [];
      g.todos.push({ id: uid("todo"), text: title, taskId, contrib: {}, coverage: 0, status: "open", manual: false });
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
    const bridge = window.LLMBridge;
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
'{"title":"目标名称(<=20字)","prompt":"目标级定义提示词","questions":["需要向用户澄清的问题"],"tasks":[{"title":"任务名","prompt":"任务级定义提示词","searchTerms":[{"display":"显示标签","query":"完整搜索表达式"}],"subtasks":[{"title":"子任务名","prompt":"子任务级定义提示词"}]}]}\n\n' +
'[规则]\n' +
'1. 任务最多 4 个，每个任务子任务最多 3 个。\n' +
'2. 需求足够明确时 questions 返回空数组 []。\n' +
'3. 需求模糊时把"该问用户什么"写进 questions，不要硬拆成任务。\n' +
'4. 名称简洁，prompt 具体，不写空话。\n' +
'5. 每个任务生成 1-3 个搜索词（searchTerms），每个搜索词包含两层：\n' +
'   - display：UI 显示标签，8 字以内，简洁明了（如"AI应用案例"）。\n' +
'   - query：实际复制/搜索时使用的完整表达式。学术场景用布尔运算符（引号精确匹配、AND/OR 组合、减号排除）；通用搜索用自然语言完整问句。\n' +
'   搜索词要贴合任务内容，不同任务应有差异。\n\n' +
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
        searchTerms: (Array.isArray(t.searchTerms) ? t.searchTerms : []).slice(0, 3).map((s: unknown) => {
          if (s && typeof s === "object" && !Array.isArray(s)) {
            const so = s as Record<string, unknown>;
            return { display: String(so.display || "").trim(), query: String(so.query || "").trim() };
          }
          return String(s).trim();
        }).filter((s) => (typeof s === "string" ? s : s.display || s.query))
          .map((s) => enrichSearchTerm(normalizeSearchTerm(s as string | SearchTerm))),
        subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).slice(0, 3).map((s: Record<string, unknown>) => ({
          id: uid("s"),
          title: String(s.title || "").trim().slice(0, 40) || "未命名子任务",
          prompt: typeof s.prompt === "string" ? s.prompt : "",
        })),
      }));
      // 暂存拆解结果，等待用户确认/编辑后再写入
      this.aiDraft = {
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
    const d = this.aiDraft;
    if (!d || !d.questions.length) return;
    const bridge = window.LLMBridge;
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
        '{"title":"目标名称(<=20字)","prompt":"目标级定义提示词","questions":["需要向用户澄清的问题"],"tasks":[{"title":"任务名","prompt":"任务级定义提示词","searchTerms":[{"display":"显示标签","query":"完整搜索表达式"}],"subtasks":[{"title":"子任务名","prompt":"子任务级定义提示词"}]}]}\n\n' +
        '[规则]\n' +
        '1. 任务最多 4 个，每个任务子任务最多 3 个。\n' +
        '2. 需求足够明确时 questions 返回空数组 []。\n' +
        '3. 需求模糊时把"该问用户什么"写进 questions，不要硬拆成任务。\n' +
        '4. 名称简洁，prompt 具体，不写空话。\n' +
        '5. 每个任务生成 1-3 个搜索词（searchTerms），每个搜索词包含两层：\n' +
        '   - display：UI 显示标签，8 字以内，简洁明了。\n' +
        '   - query：实际复制/搜索时使用的完整表达式。学术场景用布尔运算符（引号精确匹配、AND/OR 组合、减号排除）；通用搜索用自然语言完整问句。\n' +
        '   搜索词要贴合任务内容，不同任务应有差异。',
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
        searchTerms: (Array.isArray(t.searchTerms) ? t.searchTerms : []).slice(0, 3).map((s: unknown) => {
          if (s && typeof s === "object" && !Array.isArray(s)) {
            const so = s as Record<string, unknown>;
            return { display: String(so.display || "").trim(), query: String(so.query || "").trim() };
          }
          return String(s).trim();
        }).filter((s) => (typeof s === "string" ? s : s.display || s.query))
          .map((s) => enrichSearchTerm(normalizeSearchTerm(s as string | SearchTerm))),
        subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).slice(0, 3).map((s: Record<string, unknown>) => ({
          id: uid("s"),
          title: String(s.title || "").trim().slice(0, 40) || "未命名子任务",
          prompt: typeof s.prompt === "string" ? s.prompt : "",
        })),
      }));
      this.aiDraft = {
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
    if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key);
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
    this.editingPrompt = null;
    this.render();
  },
  // 确认 AI 拆解结果并创建目标
  confirmAiDraft(): void {
    const d = this.aiDraft;
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
        searchTerms: (t.searchTerms || []).slice(0, 3),
        subtasks,
      };
    });
    const todos: Todo[] = tasks.slice(0, 5).map((t, i) => ({
      id: uid("todo"),
      text: t.title,
      taskId: t.id,
      contrib: {},
      coverage: 0,
      status: "open" as const,
      manual: false,
      searchTerms: (d.tasks[i]?.searchTerms || []).slice(0, 3),
    }));
    const goals = Store.read<Goal[]>(K.goals, []);
    goals.unshift({ id: uid("g"), title, status: "active", createdAt: Date.now(), prompt, tasks, todos });
    Store.write(K.goals, goals);
    this.aiDraft = null;
    this.render();
    onLocationChange();
    this.toast("已创建目标：" + title + "（" + tasks.length + " 个任务）", "ok");
  },
  cancelAiDraft(): void {
    this.aiDraft = null;
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
  toggleDeleteMode(): void {
    this.recDeleteMode = !this.recDeleteMode;
    if (!this.recDeleteMode) this.recSelected.clear();
    this.render();
  },
  confirmDeleteSelected(): void {
    if (!this.recSelected.size) { this.toast("请先选择要删除的记录", "err"); return; }
    if (!confirm(`确定删除选中的 ${this.recSelected.size} 条记录？此操作不可恢复。`)) return;
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const queue = Store.read<QueueItem[]>(K.queue, []);
    const toDeleteWhole = new Set<string>();
    const toRemoveMatch = new Map<string, string[]>(); // recordId -> [matchKeys]
    for (const key of this.recSelected) {
      if (key.includes(":")) {
        const [rid] = key.split(":");
        const arr = toRemoveMatch.get(rid) || [];
        arr.push(key);
        toRemoveMatch.set(rid, arr);
      } else {
        toDeleteWhole.add(key);
      }
    }
    // 移除 match
    for (const [rid, keys] of toRemoveMatch) {
      const rec = recs.find((r) => r.id === rid);
      if (!rec || !rec.matches) continue;
      for (const key of keys) {
        const [, gid, tid, sid] = key.split(":");
        rec.matches = rec.matches.filter((m) => !(m.goalId === gid && (m.taskId || "") === tid && (m.subtaskId || "") === sid));
      }
      if (rec.matches.length === 0) {
        toDeleteWhole.add(rid);
      } else {
        const top = rec.matches.sort((a, b) => b.relevance - a.relevance)[0];
        rec.category = "goal:" + top.goalId;
      }
    }
    // 删除整记录
    for (const rid of toDeleteWhole) {
      const idx = recs.findIndex((r) => r.id === rid);
      if (idx >= 0) recs.splice(idx, 1);
      const qi = queue.findIndex((q) => q.recordId === rid);
      if (qi >= 0) queue.splice(qi, 1);
    }
    Store.write(K.records, recs);
    Store.write(K.queue, queue);
    const deletedCount = this.recSelected.size;
    this.recSelected.clear();
    this.recDeleteMode = false;
    this.render();
    this.toast("已删除 " + deletedCount + " 条记录", "ok");
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

  // ---- 导出 / 清空 ----
  exportSelected(): void {
    const sel = this.root!.querySelector('[data-role="export-select"]') as HTMLSelectElement;
    const value = sel?.value || "";
    if (!value) { this.toast("请先在导出菜单里选择目标", "idle"); return; }
    this.exportRecords(value === "all" ? null : value);
  },
  exportCancel(): void {
    this.exportOpen = false;
    this.renderExportPop();
  },
  exportRecords(goalId: string | null): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const goals = Store.read<Goal[]>(K.goals, []);
    let picked = recs;
    if (goalId) picked = recs.filter((r) => r.category === "goal:" + goalId);
    const groups: Record<string, BrowseRecord[]> = {};
    for (const r of picked) {
      const key = r.category || "other";
      (groups[key] = groups[key] || []).push(r);
    }
    const payload = { exportedAt: Date.now(), goals, records: groups };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = goalId ? "shizhi-" + goalId + ".json" : "shizhi-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.exportOpen = false;
    this.renderExportPop();
    this.toast("已导出 " + picked.length + " 条记录。可下载 skill 辅助本地 Agent 分析。", "ok");
  },
  clearByTarget(goalId: string | null): void {
    const label = goalId ? "该目标下的记录" : "全部数据（目标、记录、队列）";
    if (!confirm("清空" + label + "？此操作不可恢复。")) return;
    if (goalId) {
      Store.write(K.records, Store.read<BrowseRecord[]>(K.records, []).filter((r) => r.category !== "goal:" + goalId));
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
    this.toast("分析提示词已重置为预设", "ok");
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
    const bridge = window.LLMBridge;
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
      "   提示词编辑须知：自定义提示词必须保留 {{GOALS}}、{{URL}}、{{TITLE}}、{{EXCERPT}} 等占位符，以及「只输出 JSON + matches 数组（每个元素含 goalId/taskId/subtaskId/relevance/findings/notes/keyQuotes）」的格式约定，否则分析会失败。\n" +
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
    const bridge = window.LLMBridge;
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
    const bridge = window.LLMBridge;
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
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.focus();
      el.setSelectionRange(text.length, text.length);
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
    const bridge = window.LLMBridge;
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

  // ---- 目标树拖拽排序 ----
  onDragStart(e: DragEvent): void {
    const row = (e.target as Element).closest("[draggable='true'][data-kind]") as HTMLElement | null;
    if (!row) return;
    this.drag = {
      kind: row.dataset.kind as "goal" | "task" | "subtask",
      id: row.dataset.id || "",
      parent: row.dataset.parent || "",
    };
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", row.dataset.id || "");
  },
  onDragOver(e: DragEvent): void {
    if (!this.drag) return;
    const row = (e.target as Element).closest("[draggable='true'][data-kind]") as HTMLElement | null;
    if (!row || row.dataset.kind !== this.drag.kind) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    this.clearDragOver();
    row.classList.add("dragover");
  },
  onDrop(e: DragEvent): void {
    e.preventDefault();
    const row = (e.target as Element).closest("[draggable='true'][data-kind]") as HTMLElement | null;
    this.clearDragOver();
    if (!this.drag || !row || row.dataset.kind !== this.drag.kind) { this.drag = null; return; }
    const targetId = row.dataset.id || "";
    const kind = this.drag.kind;
    const goals = Store.read<Goal[]>(K.goals, []);
    if (kind === "goal") {
      reorder(goals, this.drag.id, targetId);
      Store.write(K.goals, goals);
    } else if (kind === "task") {
      const g = goals.find((x) => x.id === this.drag!.parent);
      if (g) { reorder(g.tasks || [], this.drag.id, targetId); Store.write(K.goals, goals); }
    } else if (kind === "subtask") {
      const g = goals.find((x) => x.id === this.drag!.parent);
      const task = g?.tasks?.find((t) => (t.subtasks || []).some((s) => s.id === this.drag!.id));
      if (task) { reorder(task.subtasks || [], this.drag.id, targetId); Store.write(K.goals, goals); }
    }
    this.drag = null;
    this.render();
  },
  clearDragOver(): void {
    this.root!.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
  },

  // ---- 组内视图 ----
  enterGroup(key: string): void {
    this.recGroup = key;
    this.recQuery = "";
    this.recDeleteMode = false;
    this.recSelected.clear();
    this.els.searchInput.value = "";
    this.render();
  },
  leaveGroup(): void {
    this.recGroup = null;
    this.recQuery = "";
    this.recDeleteMode = false;
    this.recSelected.clear();
    this.els.searchInput.value = "";
    this.render();
  },
  // 从目标树点击分类跳转：切到记录 Tab 并进入对应分组
  gotoGroup(id: string, kind?: string): void {
    if (id === "slacking") this.recGroup = "slacking";
    else if (kind === "task") this.recGroup = "task:" + id;
    else if (kind === "subtask") this.recGroup = "subtask:" + id;
    else this.recGroup = "goal:" + id;
    this.recQuery = "";
    this.els.searchInput.value = "";
    if (this.tab !== "records") this.switchTab("records");
    else this.render();
  },
  switchTab(tab: string): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.recDeleteMode = false;
    this.recSelected.clear();
    // 清理可能残留的高度动画状态
    clearTimeout(this.animTimer);
    this.els.body.classList.remove("sz-animH");
    this.els.body.style.height = "";
    this.render();
  },

  // ---- 渲染 ----
  render(): void {
    if (!this.root) return;
    const st = getState();
    this.els.workmode.checked = !!st.workMode;
    this.els.fab.classList.toggle("on", !!st.workMode);
    this.els.pending.classList.toggle("on", Store.read<QueueItem[]>(K.queue, []).length > 0);
    this.els.tabs.forEach((t) => t.classList.toggle("act", t.dataset.tab === this.tab));
    // 组内视图的分类被删除时回退总览
    const goals = Store.read<Goal[]>(K.goals, []);
    if (this.recGroup) {
      if (this.recGroup.startsWith("goal:")) {
        const gid = this.recGroup.slice(5);
        if (!goals.some((g) => g.id === gid)) {
          this.recGroup = null; this.recQuery = ""; this.els.searchInput.value = "";
        }
      } else if (this.recGroup.startsWith("task:")) {
        const tid = this.recGroup.slice(5);
        const hasTask = goals.some((g) => g.tasks?.some((t) => t.id === tid));
        if (!hasTask) { this.recGroup = null; this.recQuery = ""; this.els.searchInput.value = ""; }
      } else if (this.recGroup.startsWith("subtask:")) {
        const sid = this.recGroup.slice(8);
        const hasSub = goals.some((g) => g.tasks?.some((t) => t.subtasks?.some((s) => s.id === sid)));
        if (!hasSub) { this.recGroup = null; this.recQuery = ""; this.els.searchInput.value = ""; }
      }
    }
    // 先渲染 body 内容，避免 toolbar 状态变化和 body 替换之间出现布局不一致的中间态
    if (this.tab === "goals") this.renderGoals();
    else if (this.tab === "records") this.renderRecords();
    else if (this.tab === "profile") this.renderProfile();
    else this.renderSettings();
    this.renderTodo();
    // 再更新 toolbar 状态（与 body 渲染分开，避免闪烁）
    this.els.toolbar.classList.toggle("on", this.tab === "records"); // 工具栏在记录标签页始终显示
    this.els.rectools.classList.toggle("on", this.tab === "records" && !!this.recGroup); // 搜索框只在组内视图出现
    // 排序 tab 激活态
    this.root.querySelectorAll('[data-act="rec-sort"]').forEach((btn) => {
      btn.classList.toggle("act", (btn as HTMLElement).dataset.sort === this.recSort);
    });
    const delBtn = this.root.querySelector('[data-role="del-btn"]') as HTMLButtonElement | null;
    if (delBtn) {
      if (this.recDeleteMode) {
        delBtn.textContent = "确认删除(" + this.recSelected.size + ")";
        delBtn.dataset.act = "del-confirm";
        delBtn.classList.add("sz-del-confirm");
      } else {
        delBtn.textContent = "删除";
        delBtn.dataset.act = "del-mode";
        delBtn.classList.remove("sz-del-confirm");
      }
    }
    const cancelBtn = this.root.querySelector('[data-role="del-cancel"]') as HTMLButtonElement | null;
    if (cancelBtn) cancelBtn.style.display = this.recDeleteMode ? "" : "none";
    // 关联网址输入框同步（聚焦编辑时不打扰）
    const linked = this.root.querySelector('[data-role="linked-url"]') as HTMLInputElement | null;
    if (linked && linked !== this.root.activeElement) linked.value = settings().linkedUrl || "";
  },
  renderGoals(): void {
    const goals = Store.read<Goal[]>(K.goals, []);

    // 分类提示词（分类定义）行：展示或内联编辑
    const promptRow = (kind: "goal" | "task" | "subtask", id: string, prompt: string): string => {
      if (this.editingPrompt === id) {
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
      const collapsed = this.collapsed.has(key);
      return `<button class="sz-caret ${collapsed ? "" : "open"}" data-act="toggle-node" data-id="${esc(key)}" title="${collapsed ? "展开下级" : "折叠下级"}">${ICONS.chevron}</button>`;
    };

    const subtaskRow = (g: Goal, s: Subtask): string => `
      <div class="sz-row" draggable="true" data-kind="subtask" data-id="${esc(s.id)}" data-parent="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        <span class="sz-caret-spacer"></span>
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="${esc(s.id)}" data-kind="subtask" title="点击查看该子任务下的记录">${esc(s.title)}</span>
        <button class="sz-ibtn" data-act="edit-sub" data-id="${esc(s.id)}" data-pid="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn" data-act="del-sub" data-id="${esc(s.id)}" data-pid="${esc(g.id)}" title="删除">${ICONS.trash}</button>
      </div>
      ${promptRow("subtask", s.id, s.prompt || "")}`;

    const taskRow = (g: Goal, t: Task): string => {
      const hasSub = (t.subtasks || []).length > 0;
      const collapsed = this.collapsed.has("t:" + t.id);
      return `
      <div class="sz-row" draggable="true" data-kind="task" data-id="${esc(t.id)}" data-parent="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        ${caret("t:" + t.id, hasSub)}
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="${esc(t.id)}" data-kind="task" title="点击查看该任务下的记录">${esc(t.title)}</span>
        <button class="sz-ibtn" data-act="edit-task" data-id="${esc(t.id)}" data-pid="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn" data-act="del-task" data-id="${esc(t.id)}" data-pid="${esc(g.id)}" title="删除">${ICONS.trash}</button>
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
      const collapsed = this.collapsed.has("g:" + g.id);
      return `
    <div class="sz-node">
      <div class="sz-row" draggable="true" data-kind="goal" data-id="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        <button class="sz-ibtn" data-act="toggle-goal" data-id="${esc(g.id)}" title="${g.status === "active" ? "标记完成" : "重新开启"}" style="color:${g.status === "active" ? "var(--accent)" : "var(--tx-muted)"}">${ICONS.check}</button>
        ${caret("g:" + g.id, hasTasks)}
        <span class="sz-ntitle clickable ${g.status !== "active" ? "done" : ""}" data-act="goto-rec" data-id="${esc(g.id)}" data-kind="goal" title="点击查看该目标下的记录">${esc(g.title)}</span>
        <button class="sz-ibtn" data-act="edit-goal" data-id="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn" data-act="del-goal" data-id="${esc(g.id)}" title="删除">${ICONS.trash}</button>
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
<div class="sz-goal-toolbar">
<input class="sz-input" data-role="goal-input" placeholder="输入需求，AI 自动拆解" style="flex:1">
<button class="sz-btn" data-act="ai-parse-goal" title="用 AI 把需求解析成目标并拆解任务/子任务">${ICONS.bulb} AI 拆解</button>
</div>
    ${this.renderAiDraft()}
    ${goals.length ? '<div class="sz-note" style="margin-bottom:8px">拖拽左侧手柄可调整分类优先级，代办将提示优先级最高且未完成的任务。—— P0！全都是P0！</div>' : ""}
    ${goals.map(goalRow).join("") || '<div class="sz-empty">暂无目标。添加目标后，拾知会自动归档浏览记录。</div>'}
    <div class="sz-node" style="opacity:.95">
      <div class="sz-row" style="cursor:default">
        <span class="sz-grip" style="opacity:0">${ICONS.drag}</span>
        <span class="sz-caret-spacer"></span>
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="slacking" data-kind="slacking" title="点击查看摸鱼记录">摸鱼</span>
      </div>
      <div class="sz-prompt" style="cursor:default" title="固定分类定义">不属于任何其它目标的记录</div>
    </div>`;
  },
  // AI 拆解结果确认卡片（可编辑后创建）
  renderAiDraft(): string {
    const d = this.aiDraft;
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
          <button class="sz-btn" data-act="ai-reparse" style="font-size:11px;padding:4px 12px;background:var(--accent);color:var(--accent-contrast);border-color:var(--accent);white-space:nowrap">重新拆解</button>
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
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const goals = Store.read<Goal[]>(K.goals, []);
    type RecItem = { record: BrowseRecord; match?: MatchEntry };
    const groups: { key: string; name: string; color: string; items: RecItem[] }[] = goals.map((g) => ({
      key: "goal:" + g.id, name: g.title,
      color: g.status === "active" ? "#16a34a" : "#9ca3af", items: [] as RecItem[],
    }));
    groups.push(
      { key: "slacking", name: "摸鱼", color: "#d97706", items: [] as RecItem[] },
      { key: "pending", name: "分析中", color: "#6b7280", items: [] as RecItem[] },
      { key: "error", name: "分析失败", color: "#dc2626", items: [] as RecItem[] },
      { key: "orphan", name: "已移除目标", color: "#9ca3af", items: [] as RecItem[] }
    );
    for (const r of recs) {
      if (r.matches && r.matches.length > 0 && r.category !== "pending" && r.category !== "error") {
        // 多分类：每个 match 放入对应 goal
        for (const m of r.matches) {
          const g = groups.find((x) => x.key === "goal:" + m.goalId);
          if (g) g.items.push({ record: r, match: m });
        }
      } else {
        // 单分类或无 match：按 category 放入
        let g = groups.find((x) => x.key === r.category);
        if (!g) {
          g = groups.find((x) => x.key === (String(r.category).startsWith("goal:") ? "orphan" : "pending"));
        }
        g!.items.push({ record: r });
      }
    }
    const recHtml = (item: RecItem, q: string): string => {
      const r = item.record;
      const m = item.match;
      const keywords = m ? [] : (r.keywords || []);
      const findings = m ? m.findings : (r.findings || []);
      const notes = m ? m.notes : (r.notes || []);
      const relevance = m ? m.relevance : r.relevance;
      const relTitle = m ? `相关度 ${relevance}/100（${m.reasoning ? m.reasoning.slice(0, 60) : ""}）` : (relevance == null ? "未分析" : `相关度 ${relevance}/100`);
      const displayTitle = (m?.title || r.title || r.url);
      const truncatedTitle = displayTitle.length > 28 ? displayTitle.slice(0, 28) + "…" : displayTitle;
      const itemKey = m ? `${r.id}:${m.goalId}:${m.taskId || ""}:${m.subtaskId || ""}` : r.id;
      const checked = this.recSelected.has(itemKey) ? "checked" : "";
      const kwHtml = keywords.length
        ? `<div class="sz-detail-sec">${keywords.slice(0, 8).map((k) => `<span class="sz-kw">${highlightText(k, q)}</span>`).join("")}</div>`
        : "";
      const findingsHtml = findings.length
        ? `<div class="sz-detail-sec"><div class="sz-detail-sec-title">💡 关键发现</div>${findings.map((f) => `<div class="sz-detail-finding">${highlightText(f, q)}</div>`).join("")}</div>`
        : "";
      const notesHtml = notes.length
        ? `<div class="sz-detail-sec"><div class="sz-detail-sec-title">📒 提取笔记</div>${notes.map((n) => `<div class="sz-detail-note"><div class="sz-detail-note-head"><span class="sz-detail-note-topic">${esc(n.topic)}</span><span class="sz-detail-note-rel">相关度 ${n.relevance}%</span></div><div class="sz-detail-note-content">${highlightText(n.content, q)}</div></div>`).join("")}</div>`
        : "";
      const keyQuotesHtml = m && m.keyQuotes?.length
        ? `<div class="sz-detail-sec"><div class="sz-detail-sec-title">📌 原文引用</div>${m.keyQuotes.map((kq) => `<blockquote class="sz-detail-quote">${esc(kq.quote)}<cite>${esc(kq.context)}</cite></blockquote>`).join("")}</div>`
        : "";
      const relCls = relevance == null ? "sz-rel-none" : relevance >= 60 ? "sz-rel-high" : relevance >= 30 ? "sz-rel-mid" : "sz-rel-low";
      const relBadge = relevance != null ? `<span class="sz-rel-badge">${relevance}%</span>` : "";
      return `
      <div class="sz-rec" data-id="${esc(r.id)}" data-item-key="${esc(itemKey)}" ${m ? `data-match-goal="${esc(m.goalId)}"` : ""}>
        <div class="sz-rec-head">
          ${this.recDeleteMode ? `<input type="checkbox" class="sz-rec-check" data-act="rec-check" data-key="${esc(itemKey)}" ${checked}>` : ""}
          <span class="sz-rel ${relCls}" title="${esc(relTitle)}"></span>
          <div class="sz-rec-main" data-act="expand">
            <a class="sz-rtitle" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(displayTitle)}">${highlightText(truncatedTitle, q)}</a>
            <div class="sz-rmeta">${fmtDate(r.capturedAt)} · ${highlightText(r.summary || r.preview || "", q)}${m ? ` · 命中分类` : ""}</div>
          </div>
          <div class="sz-rec-actions">
            ${relBadge}
            ${r.category === "pending" ? '<span class="sz-badge">分析中</span>' : ""}
          </div>
        </div>
        <div class="sz-rec-detail">${kwHtml}${findingsHtml}${notesHtml}${keyQuotesHtml}${r.category === "pending" ? "正在分析中，请稍等片刻~" : ""}</div>
        ${r.category === "error" && r.excerpt ? `<button class="sz-retry" data-act="retry" data-rid="${esc(r.id)}">重试</button>` : ""}
      </div>`;
    };
    const byTime = (a: RecItem, b: RecItem): number => b.record.capturedAt - a.record.capturedAt;
    const byRel = (a: RecItem, b: RecItem): number => {
      const ra = a.match ? a.match.relevance : a.record.relevance;
      const rb = b.match ? b.match.relevance : b.record.relevance;
      return (rb ?? -1) - (ra ?? -1) || b.record.capturedAt - a.record.capturedAt;
    };

    // 组内视图：只显示选中的分组，搜索与排序都限定在组内
    if (this.recGroup) {
      let items: RecItem[] = [];
      let groupName = "";
      let groupColor = "";
      let isSearchable = false;
      if (this.recGroup.startsWith("goal:")) {
        const gid = this.recGroup.slice(5);
        const g = goals.find((x) => x.id === gid);
        groupName = g?.title || "未知目标";
        groupColor = g?.status === "active" ? "#16a34a" : "#9ca3af";
        isSearchable = true;
        items = recs.flatMap((r) => {
          if (r.category === "pending" || r.category === "error") return [];
          if (r.matches?.length) return r.matches.filter((m) => m.goalId === gid).map((m) => ({ record: r, match: m }));
          if (r.category === "goal:" + gid) return [{ record: r }];
          return [];
        });
      } else if (this.recGroup.startsWith("task:")) {
        const tid = this.recGroup.slice(5);
        for (const g of goals) {
          const t = g.tasks?.find((x) => x.id === tid);
          if (t) { groupName = t.title; break; }
        }
        groupName = groupName || "未知任务";
        groupColor = "#2563eb";
        isSearchable = true;
        items = recs.flatMap((r) => {
          if (r.category === "pending" || r.category === "error") return [];
          if (r.matches?.length) return r.matches.filter((m) => m.taskId === tid).map((m) => ({ record: r, match: m }));
          return [];
        });
      } else if (this.recGroup.startsWith("subtask:")) {
        const sid = this.recGroup.slice(8);
        for (const g of goals) {
          for (const t of g.tasks || []) {
            const s = t.subtasks?.find((x) => x.id === sid);
            if (s) { groupName = s.title; break; }
          }
          if (groupName) break;
        }
        groupName = groupName || "未知子任务";
        groupColor = "#9333ea";
        isSearchable = true;
        items = recs.flatMap((r) => {
          if (r.category === "pending" || r.category === "error") return [];
          if (r.matches?.length) return r.matches.filter((m) => m.subtaskId === sid).map((m) => ({ record: r, match: m }));
          return [];
        });
      } else {
        const g = groups.find((x) => x.key === this.recGroup)!;
        groupName = g.name;
        groupColor = g.color;
        isSearchable = g.key.startsWith("goal:");
        items = g.items;
      }
      this.els.searchInput.style.display = isSearchable ? "" : "none";
      this.els.searchInput.placeholder = "搜索：" + groupName;
      if (this.els.searchInput.value !== this.recQuery) this.els.searchInput.value = this.recQuery;
      const q = isSearchable ? this.recQuery.trim().toLowerCase() : "";
      const filtered = (q ? items.filter((item) =>
        [item.record.title, item.record.url, item.record.summary, item.record.preview, (item.record.keywords || []).join(" "), item.match?.reasoning]
          .some((s) => s && String(s).toLowerCase().includes(q))) : items)
        .sort(this.recSort === "rel" ? byRel : byTime);
      let html = `<div class="sz-sec"><button class="sz-back" data-act="leave-group" title="返回全部分组">${ICONS.back}返回</button><span class="sz-dot" style="background:${groupColor}"></span><span class="sz-gtitle">${esc(groupName)}</span><span class="sz-count">${filtered.length}</span></div>`;
      if (q) html += `<div class="sz-note" style="margin-bottom:6px">搜索"${esc(q)}"，匹配 ${filtered.length} 条记录</div>`;
      html += filtered.slice(0, 50).map((item) => recHtml(item, q)).join("")
        || (q ? '<div class="sz-empty">未找到匹配的记录</div>' : '<div class="sz-empty">该分组暂无记录</div>');
      this.els.body.innerHTML = html;
      return;
    }

    // 总览：按时间倒序，点击组标题进入组内视图
    let html = "";
    for (const g of groups) {
      if (!g.items.length) continue;
      html += `<div class="sz-sec sz-sec-link" data-act="enter-group" data-key="${esc(g.key)}" title="进入该分组"><span class="sz-dot" style="background:${g.color}"></span>${esc(g.name)}<span class="sz-count">${g.items.length}</span><span class="sz-chev">›</span></div>`;
      html += g.items.sort(this.recSort === "rel" ? byRel : byTime).slice(0, 50).map((item) => recHtml(item, "")).join("");
    }
    this.els.body.innerHTML = html || '<div class="sz-empty">暂无记录</div>';
  },
  renderProfile(): void {
    const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
    const has = profile.facts.length || profile.preferences.length;
    const list = (items: string[], kind: "facts" | "preferences"): string => items.map((x, i) => `
      <div class="sz-todo-item">
        <div class="sz-todo-text">
          <span class="t">${esc(x)}</span>
          <button class="sz-ibtn" data-act="del-profile" data-kind="${kind}" data-idx="${i}" title="删除">${ICONS.trash}</button>
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
    const promptVal = s.analysisPrompt || PRESET_PROMPT;
    const cloneTabs: Array<{ key: "https" | "ssh" | "ghcli"; label: string; cmd: string }> = [
      { key: "https", label: "HTTPS", cmd: "https://github.com/SkillRatLab/research-pilot.git" },
      { key: "ssh", label: "SSH", cmd: "git@github.com:SkillRatLab/research-pilot.git" },
      { key: "ghcli", label: "GitHub CLI", cmd: "gh repo clone SkillRatLab/research-pilot" },
    ];
    const activeClone = cloneTabs.find((t) => t.key === this.cloneTab) || cloneTabs[0];
    this.els.body.innerHTML = `
    <div class="sz-field">
      <span class="sz-label">记录分析提示词（留空则使用预设）</span>
      <textarea class="sz-textarea" data-role="prompt-input" placeholder="${esc(PRESET_PROMPT)}">${esc(promptVal)}</textarea>
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
    </div>
    <div class="sz-field">
      <span class="sz-label">存储</span>
      <div class="sz-note">存储：${Store.driverLabel()}</div>
    </div>
    <div class="sz-field">
      <span class="sz-label">使用说明</span>
      <div class="sz-note">
        开启工作模式后，浏览网页会自动记录并按目标归档；在目标里拆任务/子任务，浏览内容会逐步推进待办。
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="sz-btn" data-act="help">查看使用说明</button>
      </div>
    </div>
    <div class="sz-field">
      <span class="sz-label">配套 Skill 下载</span>
      <div style="display:flex;gap:2px;margin-bottom:8px">
        ${cloneTabs.map((t) => `<button class="sz-btn" data-act="clone-tab" data-tab="${t.key}" style="border-bottom:${t.key === activeClone.key ? "2px solid transparent" : "2px solid var(--accent)"};border-radius:4px 4px 0 0;background:${t.key === activeClone.key ? "var(--bg-hover)" : "transparent"};padding:4px 10px;font-size:13px">${esc(t.label)}</button>`).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--bd-panel);border-radius:6px;font-family:ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace;font-size:12px;color:var(--tx-primary)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(activeClone.cmd)}</span>
        <button class="sz-btn" data-act="copy-clone" data-cmd="${esc(activeClone.cmd)}" style="padding:2px 8px;font-size:12px;flex-shrink:0">复制</button>
      </div>
    </div>`;
  },
  renderExportPop(): void {
    const pop = this.root!.querySelector('[data-role="export-pop"]') as HTMLDivElement;
    if (!pop) return;
    if (!this.exportOpen) { pop.style.display = "none"; return; }
    const goals = Store.read<Goal[]>(K.goals, []);
    pop.innerHTML = `
      <div class="sz-export-row">
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
    txt.textContent = sug ? "当前建议：" + sug.text : "待办";
    pop.classList.toggle("open", this.todoOpen);
    if (!this.todoOpen) return;

    // 自动修复：给所有 active goal 中缺少 searchTerms 的 open todo 保底并保存
    let dataModified = false;
    for (const g of goals) {
      if (g.status !== "active") continue;
      // 补齐缺失的 todos
      if (g.tasks?.length) {
        const existing = new Set((g.todos || []).map((t) => t.taskId).filter(Boolean));
        for (const task of g.tasks) {
          if (existing.has(task.id)) continue;
          g.todos = g.todos || [];
          g.todos.push({
            id: uid("todo"),
            text: task.title,
            taskId: task.id,
            contrib: {},
            coverage: 0,
            status: "open",
            manual: false,
            searchTerms: (task.searchTerms || []).slice(0, 3),
          });
          dataModified = true;
        }
      }
      // 给缺少 searchTerms 的 open todo 保底（即使 Store 中为空也强制生成）
      for (const todo of g.todos || []) {
        if (todo.status === "open" && (!todo.searchTerms || !todo.searchTerms.length)) {
          const task = g.tasks?.find((t) => t.id === todo.taskId);
          if (task && task.searchTerms?.length) {
            todo.searchTerms = task.searchTerms.slice(0, 3);
          } else {
            const base = todo.text || g.title || "搜索";
            todo.searchTerms = [{ display: base, query: base }];
          }
          dataModified = true;
        }
      }
    }
    if (dataModified) {
      Store.write(K.goals, goals);
    }

    const list = this.root!.querySelector('[data-role="todo-list"]') as HTMLElement;
    const activeGoals = goals.filter((g) => g.status === "active");
    if (!activeGoals.length) {
      list.innerHTML = '<div class="sz-empty">暂无目标</div>';
      return;
    }
    let html = "";
    for (const g of activeGoals) {
      const todos = g.todos || [];
      const tasks = g.tasks || [];
      html += `<div class="sz-sec">${esc(g.title)}</div>`;
      const items = todos.length ? todos : tasks.map((task) => ({
        id: task.id,
        text: task.title,
        status: "open" as const,
        coverage: 0,
        searchTerms: [] as string[],
      }));
      if (!items.length) {
        html += `<div class="sz-empty" style="font-size:12px;padding:8px 0">暂无待办，添加任务后自动生成</div>`;
        continue;
      }
      html += items.map((t) => {
        const pct = Math.round(Math.min(1, t.coverage || 0) * 100);
        let rawTerms = (t.searchTerms || []).filter((s) => normalizeSearchTerm(s).query);
        // 渲染级最终保底：绝不允许 open todo 在 UI 上缺失搜索词
        if (t.status === "open" && !rawTerms.length) {
          const base = t.text || g.title || "搜索";
          rawTerms = [{ display: base, query: base }];
        }
        const terms = rawTerms.slice(0, 3).map((s) => enrichSearchTerm(normalizeSearchTerm(s)));
        const termRows = terms.length
          ? terms.map((st) => `<div class="sz-term-row"><button class="sz-copy" data-act="copy-term" data-term="${esc(st.query)}" title="复制">${ICONS.copy} <span>${esc(st.display)}</span></button><button class="sz-search-btn" data-act="search-term" data-term="${esc(st.query)}" title="跳转搜索">${ICONS.ext} 搜索</button></div>`).join("")
          : `<div style="color:var(--tx-muted);font-size:11px;margin-top:3px">浏览相关页面后搜索词会自动补充</div>`;
        return `
        <div class="sz-todo-item">
          <div class="sz-todo-text">
            <span class="sz-dot" style="background:${t.status === "done" ? "#16a34a" : "var(--accent)"}"></span>
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
  applyPanelSize(): void {
    const p = this.els.panel;
    if (this.panelSize) {
      p.style.width = this.panelSize.w + "px";
      p.style.height = this.panelSize.h + "px";
      p.style.maxHeight = "80vh"; // 自定义尺寸时放宽默认 70vh 上限
    } else {
      p.style.width = "";
      p.style.height = "";
      p.style.maxHeight = "";
    }
  },
  initTheme(): void {
    const dark = Store.read<string>(K.theme, "light") === "dark";
    this.applyTheme(dark);
  },
  applyTheme(dark: boolean): void {
    this.els.dock.classList.toggle("dark", dark);
    this.els.themeBtn.innerHTML = dark ? ICONS.sun : ICONS.moon;
  },
  toggleTheme(): void {
    const dark = !this.els.dock.classList.contains("dark");
    this.applyTheme(dark);
    Store.write(K.theme, dark ? "dark" : "light");
  },
  initResize(): void {
    this.els.resize.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // 避免拖动时选中面板文本
      const sx = e.clientX, sy = e.clientY;
      const rect = this.els.panel.getBoundingClientRect();
      const sw = rect.width, sh = rect.height;
      // 面板锚定边固定：默认锚右下，向左/上拖变大；翻转后方向随之反转
      const dirX = this.els.dock.classList.contains("flip-h") ? 1 : -1;
      const dirY = this.els.dock.classList.contains("flip-v") ? 1 : -1;
      const onMove = (ev: MouseEvent) => {
        const w = clamp(Math.round(sw + (ev.clientX - sx) * dirX), 280, Math.round(window.innerWidth * 0.9));
        const h = clamp(Math.round(sh + (ev.clientY - sy) * dirY), 240, Math.round(window.innerHeight * 0.8));
        this.panelSize = { w, h };
        this.applyPanelSize();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (this.panelSize) Store.write(K.panelSize, this.panelSize); // 尺寸记忆
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    this.els.resize.addEventListener("dblclick", () => {
      this.panelSize = null;
      Store.del(K.panelSize);
      this.applyPanelSize(); // 恢复默认：宽 360px、高度自适应
    });
  },
  placeDock(x: number, y: number): void {
    const vw = window.innerWidth, vh = window.innerHeight;
    x = clamp(x, 0, Math.max(0, vw - 40));
    y = clamp(y, 0, Math.max(0, vh - 40));
    this.pos = { x, y };
    const dock = this.els.dock;
    dock.style.left = x + "px";
    dock.style.top = y + "px";
    // 图标在上半屏时面板/toast 向下展开；左侧空间不足 360px 时换到图标右侧
    dock.classList.toggle("flip-v", y + 20 < vh / 2);
    dock.classList.toggle("flip-h", x + 40 < 360);
  },
  initDrag(): void {
    this.els.fab.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // 避免拖动时选中页面文本
      const sx = e.clientX, sy = e.clientY;
      const ox = this.pos.x, oy = this.pos.y;
      let moved = false;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // 5px 内视为点击
        moved = true;
        this.els.fab.classList.add("dragging");
        this.placeDock(ox + dx, oy + dy);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.els.fab.classList.remove("dragging");
        if (!moved) return;
        Store.write(K.fabPos, this.pos); // 位置记忆
        this.suppressFabClick = true; // 抑制紧随其后的 click，避免误触发展开面板
        setTimeout(() => { this.suppressFabClick = false; }, 0);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  },
  toast(text: string, kind?: string): void {
    if (!this.root) return;
    const t = document.createElement("div");
    t.className = "sz-toast " + (kind || "ok");
    t.textContent = text;
    this.els.toasts.appendChild(t);
    void t.offsetWidth; // 强制 reflow，确保入场过渡生效
    t.classList.add("show");
    setTimeout(() => {
      t.classList.remove("show");
      t.classList.add("hide"); // 向右收入图标方向后再移除节点
      setTimeout(() => t.remove(), 300);
    }, 3000);
  },
};
