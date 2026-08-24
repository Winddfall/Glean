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
import {
  STORAGE_SOFT_CAP_OPTIONS_MB,
  formatStorageBytes,
  getStorageQuotaSnapshot,
  saveStorageSoftCapMb,
  storageQuotaStatus,
  type StorageCategoryId,
  type StorageQuotaSnapshot,
  type StorageSoftCapMb,
} from "../storageQuota.js";
import type {BrowseRecord, Goal, MatchEntry, Profile, QueueItem, Settings, SearchTerm, Subtask, Task, Todo} from "../types.js";

// 设置面板使用的预设提示词（与 core/prompt.ts 中的 PRESET_ANALYSIS_PROMPT 保持一致）
const PRESET_PROMPT = PRESET_ANALYSIS_PROMPT;
const APP_VERSION = "0.1.0";
const DEFAULT_THEME_COLOR = "#5f8f55";
const THEME_COLORS: Record<string, { name: string; light: string; dark: string; soft: string; darkSoft: string; hover: string; darkHover: string; badge: string; darkBadge: string }> = {
  "#5f8f55": { name: "抹茶绿", light: "#5f8f55", dark: "#76a86c", soft: "#c8ddc2", darkSoft: "#31502f", hover: "#eef4ec", darkHover: "#2b382d", badge: "#e4f0e1", darkBadge: "#203422" },
  "#3b82f6": { name: "晴空蓝", light: "#3b82f6", dark: "#6ea8fe", soft: "#bfdbfe", darkSoft: "#244a7a", hover: "#eff6ff", darkHover: "#27364a", badge: "#dbeafe", darkBadge: "#1e3048" },
  "#8b5cf6": { name: "雾紫", light: "#8b5cf6", dark: "#b18cff", soft: "#ddd6fe", darkSoft: "#49327c", hover: "#f5f3ff", darkHover: "#332b45", badge: "#ede9fe", darkBadge: "#34234f" },
  "#e76f51": { name: "珊瑚橙", light: "#e76f51", dark: "#ff9277", soft: "#fed0c6", darkSoft: "#7c3b2d", hover: "#fff3f0", darkHover: "#482d29", badge: "#ffe4de", darkBadge: "#4a2822" },
  "#d97706": { name: "暖琥珀", light: "#d97706", dark: "#f5a623", soft: "#fed7aa", darkSoft: "#754b13", hover: "#fff8ed", darkHover: "#493722", badge: "#ffedd5", darkBadge: "#4b3216" },
  "#64748b": { name: "石墨灰", light: "#64748b", dark: "#aab6c6", soft: "#cbd5e1", darkSoft: "#4a5565", hover: "#f1f5f9", darkHover: "#303740", badge: "#e2e8f0", darkBadge: "#29313b" },
};
const GOAL_COLORS = ["#9ca3af", "#fb7185", "#fb923c", "#fbbf24", "#4ade80", "#60a5fa", "#c084fc"] as const;
const DEFAULT_GOAL_COLOR = "#4ade80";

function goalColor(goal: Goal | undefined): string {
  return goal?.color && /^#[0-9a-f]{6}$/i.test(goal.color) ? goal.color.toLowerCase() : DEFAULT_GOAL_COLOR;
}

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
  database: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11"/><path d="M3 4v7h7"/><path d="M4 13a8.1 8.1 0 0 0 14.8 3L21 13"/><path d="M21 20v-7h-7"/></svg>',
  statusCheck: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
  statusAlert: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.7 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  target: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  drag: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  github: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-6 0C5.8.1 4.7.5 4.7.5A5 5 0 0 0 4.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 9 18v4"/><path d="M9 18c-4.5 2-5-2-7-2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  palette: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.1 1.8 1.8 0 0 1 1.2-3.1H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="11" r=".8" fill="currentColor"/><circle cx="9.5" cy="7.5" r=".8" fill="currentColor"/><circle cx="14" cy="7" r=".8" fill="currentColor"/><circle cx="17" cy="10" r=".8" fill="currentColor"/></svg>',
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

const STORAGE_CATEGORY_LABELS: Record<StorageCategoryId, string> = {
  goals: "目标",
  records: "记录",
  profile: "画像",
  queue: "分析队列",
  settings: "设置",
  ui: "界面状态",
  other: "其他拾知数据",
};

function storageCategoryLabel(id: StorageCategoryId): string {
  return STORAGE_CATEGORY_LABELS[id];
}

function storageStatusLabel(status: "normal" | "warning" | "critical"): string {
  return status === "critical" ? "接近上限" : status === "warning" ? "需要注意" : "空间充足";
}

function storageStatusIcon(status: "normal" | "warning" | "critical"): string {
  return status === "normal" ? ICONS.statusCheck : ICONS.statusAlert;
}

function storagePercent(snapshot: StorageQuotaSnapshot): number {
  return Math.round(Math.min(1, snapshot.usageRatio) * 100);
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
  recReturnTab: null as "goals" | null, // 从目标树进入记录分组时，返回目标标签页
  recCollapsed: new Set<string>(), // 记录标签页折叠的分组 key
  collapsed: new Set<string>(), // 折叠的分类节点（"g:{id}" | "t:{id}"）
  editingGoal: null as null | string, // 正在内联编辑的目标 id
  editingPrompt: null as null | string, // 正在编辑分类提示词的节点 id
  colorGoalId: null as null | string, // 正在选择标识色的目标 id
  pendingDelete: null as null | { kind: "goal" | "task" | "subtask" | "record" | "profile"; id: string; parentId?: string; message: string },
  aiDraft: null as null | { title: string; prompt: string; tasks: Task[]; questions: string[]; originalText: string }, // AI 拆解待确认结果
  todoOpen: false,
  exportOpen: false,
  themeColorOpen: false,
  storageManagerOpen: false,
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
    modeButtons: HTMLButtonElement[];
    themeColorBtn: HTMLButtonElement;
    themeColorPop: HTMLDivElement;
    todoPop: HTMLDivElement;
    ctxmenu: HTMLDivElement;
    autocomplete: HTMLDivElement;
    tabBar: HTMLDivElement;
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
      .replace(/\{\{palette\}\}/g, ICONS.palette)
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
      modeButtons: Array.from(shadow.querySelectorAll('[data-act="panel-mode"]')),
      themeColorBtn: shadow.querySelector('[data-act="theme-color"]')!,
      themeColorPop: shadow.querySelector('[data-role="theme-color-pop"]')!,
      todoPop: shadow.querySelector('[data-role="todo-pop"]')!,
      ctxmenu: shadow.querySelector('[data-role="ctxmenu"]')!,
      autocomplete: shadow.querySelector('[data-role="autocomplete"]')!,
      tabBar: shadow.querySelector(".sz-tabs")!,
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
    this.initThemeColor();
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
    const target = e.target as Element;
    const btn = target.closest("[data-act]") as HTMLElement | null;
    if (!btn) {
      // 点击导出浮层外部区域时关闭浮层
      if (this.exportOpen && !target.closest('[data-role="export-pop"]')) {
        this.exportOpen = false;
        this.renderExportPop();
      }
      if (this.colorGoalId && !target.closest('[data-role="goal-palette"]')) {
        this.colorGoalId = null;
        this.render();
      }
      if (this.themeColorOpen && !target.closest('[data-role="theme-color-pop"]')) {
        this.themeColorOpen = false;
        this.els.themeColorPop.classList.remove("open");
      }
      return;
    }
    const act = btn.dataset.act;
    if (this.colorGoalId && act !== "toggle-goal-color" && act !== "set-goal-color") {
      this.colorGoalId = null;
      this.root?.querySelector('[data-role="goal-palette"]')?.remove();
    }
    if (act === "fab") { if (!this.suppressFabClick) this.els.panel.classList.toggle("open"); } // 拖拽后的 click 不触发展开
    else if (act === "close") this.els.panel.classList.remove("open");
    else if (act === "tab") { this.recReturnTab = null; this.switchTab(btn.dataset.tab!); }
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
    else if (act === "save-goal-title") this.saveGoalTitle(btn.dataset.id || "");
    else if (act === "cancel-goal-title") { this.editingGoal = null; this.render(); }
    else if (act === "edit-task") this.editTask(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "edit-sub") this.editSub(btn.dataset.id || "", btn.dataset.pid || "");
    else if (act === "del-goal") this.askDelete("goal", btn.dataset.id || "", undefined, "删除这个目标？已归档的记录会保留。");
    else if (act === "del-task") this.askDelete("task", btn.dataset.id || "", btn.dataset.pid || "", "删除这个任务及其子任务？");
    else if (act === "del-sub") this.askDelete("subtask", btn.dataset.id || "", btn.dataset.pid || "", "删除这个子任务？");
    else if (act === "confirm-delete") this.confirmDelete();
    else if (act === "cancel-delete") { this.pendingDelete = null; this.render(); }
    else if (act === "toggle-goal") this.toggleGoal(btn.dataset.id || "");
    else if (act === "toggle-node") this.toggleNode(btn.dataset.id || "");
    else if (act === "toggle-goal-color") {
      const id = btn.dataset.id || "";
      this.colorGoalId = this.colorGoalId === id ? null : id;
      this.render();
    }
    else if (act === "set-goal-color") this.setGoalColor(btn.dataset.id || "", btn.dataset.color || "");
    else if (act === "edit-prompt") {
      const id = btn.dataset.id || "";
      this.editingPrompt = id;
      this.render();
      this.resizePromptInput(id);
    }
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
    else if (act === "toggle-rec-group") this.toggleRecGroup(btn.dataset.key!);
    else if (act === "del-record") this.askDelete("record", btn.dataset.key || "", undefined, "确定删除这条记录？此操作不可恢复。");
    else if (act === "theme") this.toggleTheme();
    else if (act === "theme-color") {
      this.themeColorOpen = !this.themeColorOpen;
      this.els.themeColorPop.classList.toggle("open", this.themeColorOpen);
    }
    else if (act === "set-theme-color") this.setThemeColor(btn.dataset.color || DEFAULT_THEME_COLOR);
    else if (act === "reset-theme-color") this.setThemeColor(DEFAULT_THEME_COLOR);
    else if (act === "panel-mode") this.setPanelMode(btn.dataset.mode === "slacking" ? "slacking" : "work");
    else if (act === "storage-manage") this.openStorageManager();
    else if (act === "storage-close") this.closeStorageManager();
    else if (act === "storage-refresh") this.render();
    else if (act === "storage-limit") this.saveStorageLimit(btn.dataset.value || "");
    else if (act === "storage-category") this.manageStorageCategory(btn.dataset.category as StorageCategoryId);
    else if (act === "reset-prompt") this.resetPrompt();
    else if (act === "clear-selected") this.clearSelected();
    else if (act === "ai-linked") this.aiFillLinkedUrl();
    else if (act === "save-settings") this.saveSettings();
    else if (act === "clone-tab") { this.cloneTab = (btn.dataset.tab || "https") as typeof this.cloneTab; this.renderSettings(); }
    else if (act === "copy-clone") this.copyText(btn.dataset.cmd || "");
    else if (act === "help") this.showHelp();
    else if (act === "add-profile") this.addProfile();
    else if (act === "del-profile") {
      const kind = btn.dataset.kind as "facts" | "preferences";
      const id = kind + ":" + (btn.dataset.idx || "0");
      this.askDelete("profile", id, undefined, "删除这条画像信息？");
    }
    else if (act === "ac-complete") this.completeInput();
    else if (act === "send-ai") this.sendSelectionToAI("analyze");
    else if (act === "send-ai-summary") this.sendSelectionToAI("summary");
  },
  onInput(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (t.matches('[data-role="rec-search"]')) { this.recQuery = t.value; this.renderRecords(); }
    else if (t.matches('.sz-prompt-input')) this.resizePromptInput(undefined, t as HTMLTextAreaElement);
  },
  onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-role="linked-url"]')) {
      const v = (t as HTMLInputElement).value.trim();
      saveSettings({ linkedUrl: v });
      if (v) this.linkedUrlNotice(v);
    } else if (t.matches('[data-role="goal-color-input"]')) {
      this.setGoalColor(t.dataset.id || "", (t as HTMLInputElement).value);
    } else if (t.matches('[data-role="theme-color-input"]')) {
      this.setThemeColor((t as HTMLInputElement).value);
    }
  },
  onKeydown(e: KeyboardEvent): void {
    const t = e.target as Element;
    if (e.key === "Enter") {
      if (t.matches('[data-role="goal-input"]')) {
        if (typeof (window as any).LLMBridge !== "undefined") this.parseGoalWithAI();
        else this.addNode("goal", "");
      }
      else if (t.matches('[data-role="goal-title-input"]')) this.saveGoalTitle((t as HTMLElement).dataset.id || "");
      else if (t.matches('[data-role="task-input"]')) this.addNode("task", (t as HTMLElement).dataset.pid || "");
      else if (t.matches('[data-role="sub-input"]')) this.addNode("subtask", (t as HTMLElement).dataset.pid || "");
    } else if (e.key === "Escape") {
      if (this.exportOpen) { this.exportOpen = false; this.renderExportPop(); }
      if (this.todoOpen) { this.todoOpen = false; this.renderTodo(); }
      if (this.colorGoalId) { this.colorGoalId = null; this.render(); }
      if (this.editingGoal) { this.editingGoal = null; this.render(); }
    }
  },

  resizePromptInput(id?: string, target?: HTMLTextAreaElement): void {
    const fields = target
      ? [target]
      : Array.from(this.root?.querySelectorAll<HTMLTextAreaElement>(id
        ? `[data-role="prompt-input"][data-id="${id}"]`
        : ".sz-prompt-input") || []);
    for (const field of fields) {
      field.style.height = "auto";
      const height = Math.min(Math.max(field.scrollHeight, 38), 120);
      field.style.height = height + "px";
      field.style.overflowY = height >= 120 ? "auto" : "hidden";
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
        searchTerms: (Array.isArray(t.searchTerms) ? t.searchTerms : []).map((s: unknown) => {
          if (s && typeof s === "object" && !Array.isArray(s)) {
            const so = s as Record<string, unknown>;
            return { display: String(so.display || "").trim(), query: String(so.query || "").trim() };
          }
          return String(s).trim();
        }).filter((s) => (typeof s === "string" ? s : s.display || s.query))
          .slice(0, 3)
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
        searchTerms: (Array.isArray(t.searchTerms) ? t.searchTerms : []).map((s: unknown) => {
          if (s && typeof s === "object" && !Array.isArray(s)) {
            const so = s as Record<string, unknown>;
            return { display: String(so.display || "").trim(), query: String(so.query || "").trim() };
          }
          return String(s).trim();
        }).filter((s) => (typeof s === "string" ? s : s.display || s.query))
          .slice(0, 3)
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
    if (!Store.read<Goal[]>(K.goals, []).some((g) => g.id === id)) return;
    this.editingGoal = id;
    this.render();
    const input = this.root?.querySelector(`[data-role="goal-title-input"][data-id="${id}"]`) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  },
  saveGoalTitle(id: string): void {
    const input = this.root?.querySelector(`[data-role="goal-title-input"][data-id="${id}"]`) as HTMLInputElement | null;
    const title = (input?.value || "").trim();
    if (!title) return;
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    g.title = title;
    Store.write(K.goals, goals);
    this.editingGoal = null;
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
  setGoalColor(id: string, color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    g.color = color.toLowerCase();
    Store.write(K.goals, goals);
    this.colorGoalId = null;
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
  askDelete(kind: "goal" | "task" | "subtask" | "record" | "profile", id: string, parentId: string | undefined, message: string): void {
    this.pendingDelete = { kind, id, parentId, message };
    this.render();
  },
  confirmDelete(): void {
    const pending = this.pendingDelete;
    if (!pending) return;
    this.pendingDelete = null;
    if (pending.kind === "goal") this.delGoal(pending.id);
    else if (pending.kind === "task") this.delTask(pending.id, pending.parentId || "");
    else if (pending.kind === "subtask") this.delSub(pending.id, pending.parentId || "");
    else if (pending.kind === "record") this.delRecord(pending.id);
    else {
      const [kind, index] = pending.id.split(":");
      this.delProfile(kind as "facts" | "preferences", Number(index));
    }
  },
  deleteConfirm(kind: "goal" | "task" | "subtask" | "record" | "profile", id: string, parentId?: string): string {
    const p = this.pendingDelete;
    if (!p || p.kind !== kind || p.id !== id || (p.parentId || "") !== (parentId || "")) return "";
    return `<div class="sz-inline-confirm">
      <span>${esc(p.message)}</span>
      <button class="sz-btn danger" data-act="confirm-delete">确认删除</button>
      <button class="sz-btn" data-act="cancel-delete">取消</button>
    </div>`;
  },
  delGoal(id: string): void {
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
  toggleRecGroup(key: string): void {
    if (this.recCollapsed.has(key)) this.recCollapsed.delete(key);
    else this.recCollapsed.add(key);
    this.render();
  },
  delRecord(key: string): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const queue = Store.read<QueueItem[]>(K.queue, []);
    const isMatch = key.includes(":");
    const [rid, gid, tid, sid] = isMatch ? key.split(":") : [key, "", "", ""];
    const rec = recs.find((r) => r.id === rid);
    if (!rec) return;
    let deletedWhole = false;
    if (isMatch) {
      if (!rec.matches) return;
      rec.matches = rec.matches.filter((m) => !(m.goalId === gid && (m.taskId || "") === tid && (m.subtaskId || "") === sid));
      if (rec.matches.length) {
        const top = rec.matches.sort((a, b) => b.relevance - a.relevance)[0];
        rec.category = "goal:" + top.goalId;
      } else {
        deletedWhole = true;
      }
    } else {
      deletedWhole = true;
    }
    if (deletedWhole) {
      const idx = recs.findIndex((r) => r.id === rid);
      if (idx >= 0) recs.splice(idx, 1);
      const qi = queue.findIndex((q) => q.recordId === rid);
      if (qi >= 0) queue.splice(qi, 1);
    }
    Store.write(K.records, recs);
    Store.write(K.queue, queue);
    this.render();
    this.toast(isMatch && !deletedWhole ? "已从该分类移除记录" : "已删除记录", "ok");
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
    const kind = "preferences" as "facts" | "preferences";
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
    this.recReturnTab = null;
    this.recGroup = key;
    this.recQuery = "";
    this.els.searchInput.value = "";
    this.render();
  },
  leaveGroup(): void {
    const returnTab = this.recReturnTab;
    this.recReturnTab = null;
    this.recGroup = null;
    this.recQuery = "";
    this.els.searchInput.value = "";
    if (returnTab === "goals") this.switchTab("goals");
    else this.render();
  },
  // 从目标树点击分类跳转：切到记录 Tab 并进入对应分组
  gotoGroup(id: string, kind?: string): void {
    this.recReturnTab = this.tab === "goals" ? "goals" : null;
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
    // 清理可能残留的高度动画状态
    clearTimeout(this.animTimer);
    this.els.body.classList.remove("sz-animH");
    this.els.body.style.height = "";
    this.render();
  },

  setPanelMode(mode: "work" | "slacking"): void {
    const st = getState();
    st.panelMode = mode;
    if (!st.activeSince) st.activeSince = Date.now();
    Store.write(K.state, st);
    this.recGroup = null;
    this.recReturnTab = null;
    this.recQuery = "";
    this.els.searchInput.value = "";
    this.render();
  },

  openStorageManager(): void {
    this.storageManagerOpen = true;
    this.render();
  },
  closeStorageManager(): void {
    this.storageManagerOpen = false;
    this.render();
  },
  saveStorageLimit(value: string): void {
    const parsed = Number(value) as StorageSoftCapMb;
    if (!STORAGE_SOFT_CAP_OPTIONS_MB.includes(parsed)) return;
    try {
      saveStorageSoftCapMb(parsed);
      this.toast("存储软上限已更新", "ok");
      this.render();
    } catch (error) {
      this.toast(String(error), "err");
    }
  },
  clearStorageQueue(): void {
    const queue = Store.read<QueueItem[]>(K.queue, []);
    if (!queue.length) return;
    if (!confirm("清空分析队列？尚未分析的记录将不会继续处理。")) return;
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    for (const item of queue) {
      const rec = recs.find((candidate) => candidate.id === item.recordId);
      if (!rec || rec.category !== "pending") continue;
      rec.category = "error";
      rec.excerpt = item.excerpt;
    }
    Store.write(K.records, recs);
    Store.del(K.queue);
    this.toast("分析队列已清空，未完成记录可手动重试", "ok");
    this.render();
  },
  manageStorageCategory(id: StorageCategoryId): void {
    if (id === "queue") {
      this.clearStorageQueue();
      return;
    }
    if (id === "goals" || id === "records" || id === "profile") {
      this.storageManagerOpen = false;
      this.switchTab(id === "goals" ? "goals" : id === "records" ? "records" : "profile");
    }
  },

  renderStorageCard(snapshot: StorageQuotaSnapshot): string {
    const status = storageQuotaStatus(snapshot.usageRatio);
    const percent = storagePercent(snapshot);
    return `
      <section class="sz-storage-card" aria-label="存储空间">
        <div class="sz-storage-card-main">
          <div class="sz-storage-card-head">
            <div class="sz-storage-heading"><span class="sz-storage-icon">${ICONS.database}</span><strong>存储空间</strong></div>
            <div class="sz-storage-card-actions">
              <span class="sz-storage-status ${status}">${storageStatusIcon(status)}<span>${storageStatusLabel(status)}</span></span>
              <button class="sz-ibtn" data-act="storage-refresh" title="刷新存储用量" aria-label="刷新存储用量">${ICONS.refresh}</button>
            </div>
          </div>
          <div class="sz-storage-row">
            <span class="sz-storage-row-label">当前源数据</span>
            <strong>${formatStorageBytes(snapshot.bytesInUse)} / ${formatStorageBytes(snapshot.softCapBytes)}</strong>
            <span class="sz-storage-percent">${percent}%</span>
          </div>
          <div class="sz-storage-progress" role="progressbar" aria-label="当前源数据" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i class="${status}" style="width:${percent}%"></i></div>
        </div>
        <div class="sz-storage-card-foot"><button class="sz-btn" data-act="storage-manage">管理存储</button></div>
      </section>`;
  },

  renderStorageManager(snapshot: StorageQuotaSnapshot): void {
    const status = storageQuotaStatus(snapshot.usageRatio);
    const percent = storagePercent(snapshot);
    const categoryRows = snapshot.categories
      .filter((category) => category.id === "goals" || category.id === "records" || category.id === "profile")
      .map((category) => {
        return `<div class="sz-storage-detail-row">
          <span class="sz-storage-detail-name">${storageCategoryLabel(category.id)}</span>
          <span class="sz-storage-detail-size">${formatStorageBytes(category.bytesInUse)}</span>
          <button class="sz-storage-link" data-act="storage-category" data-category="${category.id}">管理</button>
        </div>`;
      }).join("");
    this.els.body.innerHTML = `
      <div class="sz-storage-manager">
        <div class="sz-storage-manager-head">
          <div class="sz-storage-heading"><span class="sz-storage-icon">${ICONS.database}</span><strong>存储空间</strong></div>
          <button class="sz-ibtn" data-act="storage-close" title="关闭存储管理" aria-label="关闭存储管理">${ICONS.x}</button>
        </div>
        <div class="sz-storage-manager-content">
          <section class="sz-storage-overview">
            <div class="sz-storage-overview-top">
              <span class="sz-storage-status ${status}">${storageStatusIcon(status)}<span>${storageStatusLabel(status)}</span></span>
              <button class="sz-ibtn" data-act="storage-refresh" title="刷新存储用量" aria-label="刷新存储用量">${ICONS.refresh}</button>
            </div>
            <div class="sz-storage-row"><span class="sz-storage-row-label">当前源数据</span><strong>${formatStorageBytes(snapshot.bytesInUse)} / ${formatStorageBytes(snapshot.softCapBytes)}</strong><span class="sz-storage-percent">${percent}%</span></div>
            <div class="sz-storage-progress" role="progressbar" aria-label="当前源数据" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i class="${status}" style="width:${percent}%"></i></div>
            <div class="sz-storage-origin">仅统计当前源，其他网站的 localStorage 不会共享或汇总。</div>
          </section>
          <section class="sz-storage-limit">
            <div class="sz-storage-section-head"><strong>拾知软上限</strong><span>${formatStorageBytes(snapshot.softCapBytes)}</span></div>
            <div class="sz-storage-segmented" role="group" aria-label="拾知软上限">
              ${STORAGE_SOFT_CAP_OPTIONS_MB.map((value) => `<button class="${snapshot.softCapMb === value ? "selected" : ""}" data-act="storage-limit" data-value="${value}" aria-pressed="${snapshot.softCapMb === value}">${value} MB</button>`).join("")}
            </div>
            <p class="sz-storage-note">软上限用于提醒和进度展示，不会改变浏览器对当前源的硬性 localStorage 限制。</p>
          </section>
          <section class="sz-storage-breakdown">
            <div class="sz-storage-section-head"><strong>存储明细</strong></div>
            <div class="sz-storage-detail-list">${categoryRows}</div>
          </section>
        </div>
      </div>`;
  },

  // ---- 渲染 ----
  render(): void {
    if (!this.root) return;
    const st = getState();
    const panelMode = st.panelMode === "slacking" ? "slacking" : "work";
    this.els.modeButtons.forEach((button) => {
      const active = button.dataset.mode === panelMode;
      button.classList.toggle("act", active);
      button.setAttribute("aria-pressed", String(active));
    });
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
    this.els.panel.classList.toggle("storage-manager-open", this.storageManagerOpen);
    this.els.tabBar.hidden = this.storageManagerOpen;
    this.els.toolbar.classList.toggle("on", this.tab === "records" && !this.storageManagerOpen);
    this.els.rectools.classList.toggle("on", this.tab === "records" && !!this.recGroup && !this.storageManagerOpen);
    if (this.storageManagerOpen) {
      this.renderStorageManager(getStorageQuotaSnapshot());
      return;
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
    // 关联网址输入框同步（聚焦编辑时不打扰）
    const linked = this.root.querySelector('[data-role="linked-url"]') as HTMLInputElement | null;
    if (linked && linked !== this.root.activeElement) linked.value = settings().linkedUrl || "";
  },
  renderGoals(): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const slackingOnly = getState().panelMode === "slacking";
    const slackingNode = `<div class="sz-node" style="opacity:.95">
      <div class="sz-row" style="cursor:default">
        <span class="sz-grip" style="opacity:0">${ICONS.drag}</span>
        <span class="sz-caret-spacer"></span>
        <span class="sz-ntitle clickable" data-act="goto-rec" data-id="slacking" data-kind="slacking" title="点击查看摸鱼记录">摸鱼</span>
      </div>
      <div class="sz-prompt sz-prompt-fixed" title="固定分类定义">不属于任何其它目标的记录</div>
    </div>`;
    if (slackingOnly) {
      this.els.body.innerHTML = slackingNode;
      return;
    }

    // 分类提示词（分类定义）：内联编辑面板
    const promptEditor = (kind: "goal" | "task" | "subtask", id: string, prompt: string): string =>
      `<div class="sz-prompt-edit sz-prompt-edit-${kind}">
        <textarea class="sz-textarea sz-prompt-input" data-role="prompt-input" data-id="${esc(id)}" rows="1" placeholder="告诉 AI，这里收什么">${esc(prompt)}</textarea>
        <div class="sz-prompt-actions">
          <button class="sz-btn primary" data-act="prompt-save" data-id="${esc(id)}" data-pkind="${kind}">${ICONS.check} 保存</button>
          <button class="sz-btn" data-act="prompt-cancel">取消</button>
        </div>
      </div>`;
    // 分类定义按钮：放在标题同行，点击后进入内联编辑
    const promptChip = (kind: "goal" | "task" | "subtask", id: string, prompt: string): string =>
      `<button class="sz-cat-btn ${prompt ? "" : "empty"}" data-act="edit-prompt" data-id="${esc(id)}" data-pkind="${kind}" title="${prompt ? "点击编辑分类定义" : "点击添加分类定义"}">${prompt ? "<span class='sz-cat-dot'></span>分类定义" : "＋ 分类定义"}</button>`;
    const colorPalette = (g: Goal): string => {
      const current = goalColor(g);
      const customSelected = !GOAL_COLORS.some((color) => color === current);
      return `<div class="sz-goal-palette" data-role="goal-palette" aria-label="选择目标颜色">
        ${GOAL_COLORS.map((color) => `<button class="sz-color-swatch ${current === color ? "selected" : ""}" data-act="set-goal-color" data-id="${esc(g.id)}" data-color="${color}" style="--swatch:${color}" title="选择颜色"></button>`).join("")}
        <label class="sz-color-swatch sz-color-custom ${customSelected ? "selected" : ""}" title="自定义颜色">
          <input type="color" data-role="goal-color-input" data-id="${esc(g.id)}" value="${current}" aria-label="自定义目标颜色">
        </label>
      </div>`;
    };
    // 折叠开关：无下级时用占位对齐
    const caret = (key: string, hasChild: boolean): string => {
      if (!hasChild) return `<span class="sz-caret-spacer"></span>`;
      const collapsed = this.collapsed.has(key);
      return `<button class="sz-ibtn sz-rec-caret ${collapsed ? "" : "open"}" data-act="toggle-node" data-id="${esc(key)}" title="${collapsed ? "展开下级" : "折叠下级"}">${ICONS.chevron}</button>`;
    };

    const subtaskRow = (g: Goal, s: Subtask): string => `
      <div class="sz-row sz-row-subtask" draggable="true" data-kind="subtask" data-id="${esc(s.id)}" data-parent="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        <span class="sz-caret-spacer"></span>
        <span class="sz-level sz-level-subtask" aria-hidden="true"></span>
        <span class="sz-title-wrap">
          <span class="sz-ntitle sz-ntitle-subtask clickable" data-act="goto-rec" data-id="${esc(s.id)}" data-kind="subtask" title="点击查看该子任务下的记录">${esc(s.title)}</span>
          ${promptChip("subtask", s.id, s.prompt || "")}
        </span>
        <button class="sz-ibtn" data-act="edit-sub" data-id="${esc(s.id)}" data-pid="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn" data-act="del-sub" data-id="${esc(s.id)}" data-pid="${esc(g.id)}" title="删除">${ICONS.trash}</button>
      </div>
      ${this.deleteConfirm("subtask", s.id, g.id)}
      ${this.editingPrompt === s.id ? promptEditor("subtask", s.id, s.prompt || "") : ""}`;

    const taskRow = (g: Goal, t: Task): string => {
      const collapsed = this.collapsed.has("t:" + t.id);
      return `
      <div class="sz-row sz-row-task" draggable="true" data-kind="task" data-id="${esc(t.id)}" data-parent="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        ${caret("t:" + t.id, true)}
        <span class="sz-level sz-level-task" aria-hidden="true"></span>
        <span class="sz-title-wrap">
          <span class="sz-ntitle sz-ntitle-task clickable" data-act="goto-rec" data-id="${esc(t.id)}" data-kind="task" title="点击查看该任务下的记录">${esc(t.title)}</span>
          ${promptChip("task", t.id, t.prompt || "")}
        </span>
        <button class="sz-ibtn" data-act="edit-task" data-id="${esc(t.id)}" data-pid="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn" data-act="del-task" data-id="${esc(t.id)}" data-pid="${esc(g.id)}" title="删除">${ICONS.trash}</button>
      </div>
      ${this.deleteConfirm("task", t.id, g.id)}
      ${this.editingPrompt === t.id ? promptEditor("task", t.id, t.prompt || "") : ""}
      ${collapsed ? "" : `
      <div class="sz-children">
        ${(t.subtasks || []).map((s) => subtaskRow(g, s)).join("")}
        <div class="sz-row sz-add-node-row">
          <span class="sz-caret-spacer"></span>
          <input class="sz-input sz-sub-input" data-role="sub-input" data-pid="${esc(g.id)}" data-task="${esc(t.id)}" placeholder="添加子任务" style="font-size:12px;padding:3px 6px">
        </div>
      </div>`}`;
    };

    const goalRow = (g: Goal): string => {
      const collapsed = this.collapsed.has("g:" + g.id);
      return `
    <div class="sz-node">
      <div class="sz-row sz-row-goal" draggable="true" data-kind="goal" data-id="${esc(g.id)}">
        <span class="sz-grip" title="拖拽排序">${ICONS.drag}</span>
        ${caret("g:" + g.id, true)}
        <button class="sz-goal-color" data-act="toggle-goal-color" data-id="${esc(g.id)}" style="--goal-color:${goalColor(g)}" title="更改目标颜色" aria-label="更改目标颜色">${ICONS.target}</button>
        ${this.editingGoal === g.id ? `
        <span class="sz-goal-title-edit">
          <input class="sz-input sz-goal-title-input" data-role="goal-title-input" data-id="${esc(g.id)}" value="${esc(g.title)}" aria-label="目标名称">
          <button class="sz-ibtn" data-act="save-goal-title" data-id="${esc(g.id)}" title="保存目标名称">${ICONS.check}</button>
          <button class="sz-ibtn" data-act="cancel-goal-title" title="取消编辑">${ICONS.x}</button>
        </span>` : `
        <span class="sz-title-wrap">
          <span class="sz-ntitle sz-ntitle-goal clickable ${g.status !== "active" ? "done" : ""}" data-act="goto-rec" data-id="${esc(g.id)}" data-kind="goal" title="点击查看该目标下的记录">${esc(g.title)}</span>
          ${promptChip("goal", g.id, g.prompt || "")}
        </span>
        <button class="sz-ibtn sz-goal-status" data-act="toggle-goal" data-id="${esc(g.id)}" title="${g.status === "active" ? "标记完成" : "重新开启"}">${ICONS.check}</button>
        <button class="sz-ibtn" data-act="edit-goal" data-id="${esc(g.id)}" title="编辑">${ICONS.edit}</button>
        <button class="sz-ibtn" data-act="del-goal" data-id="${esc(g.id)}" title="删除">${ICONS.trash}</button>`}
      </div>
      ${this.deleteConfirm("goal", g.id)}
      ${this.colorGoalId === g.id ? colorPalette(g) : ""}
      ${this.editingPrompt === g.id ? promptEditor("goal", g.id, g.prompt || "") : ""}
      ${collapsed ? "" : `
      <div class="sz-children">
        ${(g.tasks || []).map((t) => taskRow(g, t)).join("")}
        <div class="sz-row sz-add-node-row">
          <span class="sz-caret-spacer"></span>
          <input class="sz-input sz-task-input" data-role="task-input" data-pid="${esc(g.id)}" placeholder="添加任务" style="font-size:12px;padding:3px 6px">
        </div>
      </div>`}
    </div>`};

this.els.body.innerHTML = `
<div class="sz-goal-toolbar">
<input class="sz-input" data-role="goal-input" placeholder="随心输入，智能拆解" style="flex:1">
<button class="sz-btn" data-act="ai-parse-goal" title="用 AI 把需求解析成目标并拆解任务/子任务">${ICONS.bulb} AI 拆解</button>
</div>
    ${this.renderAiDraft()}
    ${goals.length ? '<div class="sz-note sz-priority-note" style="margin-bottom:8px">拖动排序，待办优先提示靠前任务。<span>—— P0！全都是P0！</span></div>' : ""}
    ${goals.map(goalRow).join("") || '<div class="sz-empty">暂无目标。添加目标后，拾知会自动归档浏览记录。</div>'}
    ${slackingNode}`;
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
    const slackingOnly = getState().panelMode === "slacking";
    type RecItem = { record: BrowseRecord; match?: MatchEntry };
    const groups: { key: string; name: string; color: string; items: RecItem[] }[] = goals.map((g) => ({
      key: "goal:" + g.id, name: g.title,
      color: g.status === "active" ? goalColor(g) : "#9ca3af", items: [] as RecItem[],
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
      const hasDetail = keywords.length > 0 || findings.length > 0 || notes.length > 0 || (m && (m.keyQuotes || []).length > 0) || r.category === "pending";
      const relCls = relevance == null ? "sz-rel-none" : relevance >= 60 ? "sz-rel-high" : relevance >= 30 ? "sz-rel-mid" : "sz-rel-low";
      const relBadge = relevance != null ? `<span class="sz-rel-badge">${relevance}%</span>` : "";
      const itemKey = m ? `${r.id}:${m.goalId}:${m.taskId || ""}:${m.subtaskId || ""}` : r.id;
      return `
      <div class="sz-rec" data-id="${esc(r.id)}" ${m ? `data-match-goal="${esc(m.goalId)}"` : ""}>
        <div class="sz-rec-head">
          <span class="sz-rel ${relCls}" title="${esc(relTitle)}"></span>
          <div class="sz-rec-main">
            <a class="sz-rtitle" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(displayTitle)}">${highlightText(truncatedTitle, q)}</a>
            <div class="sz-rmeta">${fmtDate(r.capturedAt)}</div>
          </div>
          <div class="sz-rec-actions">
            ${relBadge}
            ${r.category === "pending" ? '<span class="sz-badge">分析中</span>' : ""}
            ${hasDetail ? `<button class="sz-ibtn sz-expand" data-act="expand" title="展开关键发现">${ICONS.chevron}</button>` : ""}
            <button class="sz-ibtn" data-act="del-record" data-key="${esc(itemKey)}" title="删除记录">${ICONS.trash}</button>
          </div>
        </div>
        <div class="sz-rec-detail">${kwHtml}${findingsHtml}${notesHtml}${keyQuotesHtml}${r.category === "pending" ? "正在分析中，请稍等片刻~" : ""}</div>
        ${this.deleteConfirm("record", itemKey)}
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
        groupColor = g?.status === "active" ? goalColor(g) : "#9ca3af";
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
      html += `<div class="sz-rec-list">${filtered.slice(0, 50).map((item) => recHtml(item, q)).join("")
        || (q ? '<div class="sz-empty">未找到匹配的记录</div>' : '<div class="sz-empty">该分组暂无记录</div>')}</div>`;
      this.els.body.innerHTML = html;
      return;
    }

    // 总览：按时间倒序，分组可折叠，点击组标题进入组内视图
    let html = "";
    for (const g of (slackingOnly ? groups.filter((group) => group.key === "slacking") : groups)) {
      if (!g.items.length) continue;
      const collapsed = this.recCollapsed.has(g.key);
      html += `<div class="sz-sec sz-sec-link">
        <button class="sz-ibtn sz-rec-caret ${collapsed ? "" : "open"}" data-act="toggle-rec-group" data-key="${esc(g.key)}" title="${collapsed ? "展开记录" : "收起记录"}">${ICONS.chevron}</button>
        <span class="sz-dot" style="background:${g.color}"></span>
        <span class="sz-gtitle sz-group-title" data-act="enter-group" data-key="${esc(g.key)}" title="进入该分组">${esc(g.name)}</span>
        <span class="sz-count">${g.items.length}</span>
      </div>`;
      if (!collapsed) html += `<div class="sz-rec-list">${g.items.sort(this.recSort === "rel" ? byRel : byTime).slice(0, 50).map((item) => recHtml(item, "")).join("")}</div>`;
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
        ${this.deleteConfirm("profile", kind + ":" + i)}
      </div>`).join("");
    this.els.body.innerHTML = `
    <div class="sz-field">
      <span class="sz-label">添加画像条目</span>
      <div style="display:flex;gap:6px">
        <input class="sz-input" data-role="profile-input" placeholder="例如：偏好用 Python 写脚本" style="flex:1">
        <button class="sz-btn primary" data-act="add-profile">添加</button>
      </div>
    </div>
    ${has
      ? `${profile.facts.length ? `<div class="sz-sec">关于你</div>${list(profile.facts, "facts")}` : ""}${profile.preferences.length ? `<div class="sz-sec">偏好</div>${list(profile.preferences, "preferences")}` : ""}`
      : ""}`;
  },
  renderSettings(): void {
    const s = settings();
    const storageSnapshot = getStorageQuotaSnapshot();
    const promptVal = s.analysisPrompt || PRESET_PROMPT;
    const cloneTabs: Array<{ key: "https" | "ssh" | "ghcli"; label: string; cmd: string }> = [
      { key: "https", label: "HTTPS", cmd: "https://github.com/SkillRatLab/research-pilot.git" },
      { key: "ssh", label: "SSH", cmd: "git@github.com:SkillRatLab/research-pilot.git" },
      { key: "ghcli", label: "GitHub CLI", cmd: "gh repo clone SkillRatLab/research-pilot" },
    ];
    const activeClone = cloneTabs.find((t) => t.key === this.cloneTab) || cloneTabs[0];
    this.els.body.innerHTML = `
    ${this.renderStorageCard(storageSnapshot)}
    <section class="sz-field sz-setting-card">
      <span class="sz-label">记录分析提示词（留空则使用预设）</span>
      <textarea class="sz-textarea" data-role="prompt-input" placeholder="${esc(PRESET_PROMPT)}">${esc(promptVal)}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="sz-btn primary" data-act="save-settings">保存</button>
        <button class="sz-btn" data-act="reset-prompt">重置为预设</button>
      </div>
    </section>
    <section class="sz-field sz-setting-card">
      <span class="sz-label">配套 Skill 下载</span>
      <div style="display:flex;gap:2px;margin-bottom:8px">
        ${cloneTabs.map((t) => `<button class="sz-btn" data-act="clone-tab" data-tab="${t.key}" style="border-bottom:${t.key === activeClone.key ? "2px solid transparent" : "2px solid var(--accent)"};border-radius:4px 4px 0 0;background:${t.key === activeClone.key ? "var(--bg-hover)" : "transparent"};padding:4px 10px;font-size:13px">${esc(t.label)}</button>`).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--bd-panel);border-radius:6px;font-family:ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace;font-size:12px;color:var(--tx-primary)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(activeClone.cmd)}</span>
        <button class="sz-btn" data-act="copy-clone" data-cmd="${esc(activeClone.cmd)}" style="padding:2px 8px;font-size:12px;flex-shrink:0">复制</button>
      </div>
    </section>
    <section class="sz-project-footer sz-setting-card">
      <div class="sz-project-meta">
        <span><strong>版本</strong><b>${APP_VERSION}</b></span>
        <span class="sz-doc-placeholder" aria-disabled="true">${ICONS.globe} 官方文档</span>
      </div>
      <a class="sz-issue-link" href="https://github.com/Winddfall/Glean/issues" target="_blank" rel="noopener noreferrer">
        <span class="sz-issue-star" aria-hidden="true">⭐</span>
        <span>觉得拾知好用吗？在 Github 提出 Issue，能帮助我们更好地改进它！</span>
        ${ICONS.ext}
      </a>
      <a class="sz-star-project" href="https://github.com/Winddfall/Glean" target="_blank" rel="noopener noreferrer">
        ${ICONS.github}<span>为项目点亮⭐</span>
      </a>
    </section>`;
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
      // 给缺少（或全为无效）searchTerms 的 open todo 保底（即使 Store 中为空也强制生成）
      for (const todo of g.todos || []) {
        const todoTerms = (todo.searchTerms || []).filter((s) => normalizeSearchTerm(s).query);
        if (todo.status === "open" && !todoTerms.length) {
          const task = g.tasks?.find((t) => t.id === todo.taskId);
          const taskTerms = (task?.searchTerms || []).filter((s) => normalizeSearchTerm(s).query);
          if (taskTerms.length) {
            todo.searchTerms = taskTerms.slice(0, 3);
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
  initThemeColor(): void {
    this.applyThemeColor(Store.read<string>(K.themeColor, DEFAULT_THEME_COLOR));
  },
  setThemeColor(value: string): void {
    const color = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_THEME_COLOR;
    Store.write(K.themeColor, color);
    this.applyThemeColor(color);
    this.themeColorOpen = false;
    this.els.themeColorPop.classList.remove("open");
  },
  applyThemeColor(value: string): void {
    const color = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_THEME_COLOR;
    const preset = THEME_COLORS[color];
    const dark = this.els.dock.classList.contains("dark");
    const accent = preset ? (dark ? preset.dark : preset.light) : color;
    const soft = preset ? (dark ? preset.darkSoft : preset.soft) : `color-mix(in srgb, ${color} 32%, ${dark ? "#1a1b1e" : "#ffffff"})`;
    const hover = preset ? (dark ? preset.darkHover : preset.hover) : `color-mix(in srgb, ${color} 8%, ${dark ? "#1a1b1e" : "#ffffff"})`;
    const badge = preset ? (dark ? preset.darkBadge : preset.badge) : `color-mix(in srgb, ${color} 16%, ${dark ? "#1a1b1e" : "#ffffff"})`;
    this.els.dock.style.setProperty("--accent", accent);
    this.els.dock.style.setProperty("--accent-soft", soft);
    this.els.dock.style.setProperty("--bg-hover", hover);
    this.els.dock.style.setProperty("--bg-tab-act", hover);
    this.els.dock.style.setProperty("--bg-badge-on", badge);
    this.els.dock.style.setProperty("--fab-color", accent);
    this.updateThemeColorPalette(color, preset?.name || "自定义");
  },
  updateThemeColorPalette(color: string, name?: string): void {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLButtonElement>(".sz-theme-swatch[data-color]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.color?.toLowerCase() === color.toLowerCase());
    });
    const input = this.root.querySelector('[data-role="theme-color-input"]') as HTMLInputElement | null;
    if (input) input.value = color;
    const label = this.root.querySelector('[data-role="theme-color-label"]');
    if (label) label.textContent = name || "自定义";
    const hex = this.root.querySelector('[data-role="theme-color-hex"]');
    if (hex) hex.textContent = color.toUpperCase();
  },
  applyTheme(dark: boolean): void {
    this.els.dock.classList.toggle("dark", dark);
    this.els.themeBtn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    this.applyThemeColor(Store.read<string>(K.themeColor, DEFAULT_THEME_COLOR));
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
