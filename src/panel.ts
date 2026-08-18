// 面板 UI（Shadow DOM）：目标/记录双 Tab + Toast

import { K } from "./core/constants.js";
import { clamp, esc, fmtTime, uid } from "./core/utils.js";
import { Store, getState } from "./store.js";
import { onLocationChange } from "./watcher.js";
import { pumpQueue } from "./queue.js";
import type { Goal, BrowseRecord, QueueItem } from "./types.js";

const ICONS = {
  bulb: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};

const CSS = `
:host { all: initial; }

/* ---- 浅色色板 ---- */
.sz-dock {
  --bg-panel: #fff; --bg-card: #f9fafb; --bg-note: #fff; --bg-hover: #f3f4f6; --bg-input: #fff;
  --bg-tab-act: #f3f4f6; --bg-badge: #f3f4f6; --bg-badge-on: #dcfce7; --bg-del-hover: #fef2f2;
  --bg-retry: #fff; --bg-retry-hover: #fef2f2;
  --bg-toast-ok: #166534; --bg-toast-idle: #92400e; --bg-toast-err: #b91c1c;
  --bd-panel: #e2e4e9; --bd-light: #eef0f3; --bd-dash: #f0f1f3; --bd-input: #e5e7eb; --bd-note: #eef0f3; --bd-retry: #fecaca;
  --tx-primary: #1f2328; --tx-secondary: #6b7280; --tx-tertiary: #4b5563; --tx-muted: #9ca3af;
  --tx-link: #2563eb; --tx-danger: #dc2626; --tx-inverse: #f9fafb;
  --accent: #16a34a; --accent-soft: #bbf7d0; --fab-color: #d97706;
  --rel-high: #8ba888; --rel-mid: #9ba5b4; --rel-low: #c4a59a; --rel-none: #d6d3d1;
  --shadow-panel: 0 10px 32px rgba(0,0,0,.16); --shadow-fab: 0 4px 14px rgba(0,0,0,.14);
}
/* ---- 深色色板 ---- */
.sz-dock.dark {
  --bg-panel: #1a1b1e; --bg-card: #25262b; --bg-note: #2a2b30; --bg-hover: #33343a; --bg-input: #25262b;
  --bg-tab-act: #33343a; --bg-badge: #33343a; --bg-badge-on: #1a3a2a; --bg-del-hover: #3a1e1e;
  --bg-retry: #25262b; --bg-retry-hover: #3a1e1e;
  --bg-toast-ok: #166534; --bg-toast-idle: #92400e; --bg-toast-err: #b91c1c;
  --bd-panel: #3a3b40; --bd-light: #33343a; --bd-dash: #2e2f35; --bd-input: #3a3b40; --bd-note: #3a3b40; --bd-retry: #5a2a2a;
  --tx-primary: #e0e0e4; --tx-secondary: #9ca3af; --tx-tertiary: #b0b3ba; --tx-muted: #6b7280;
  --tx-link: #6ea8fe; --tx-danger: #f87171; --tx-inverse: #1a1b1e;
  --accent: #2d7a4f; --accent-soft: #1a3a2a; --fab-color: #f59e0b;
  --rel-high: #9bc4a8; --rel-mid: #a8b2c0; --rel-low: #d0aea3; --rel-none: #4a4744;
  --shadow-panel: 0 10px 32px rgba(0,0,0,.5); --shadow-fab: 0 4px 14px rgba(0,0,0,.4);
}

/* ---- 主题切换过渡 ---- */
.sz-panel, .sz-fab, .sz-head, .sz-foot, .sz-tab, .sz-input, .sz-select, .sz-retry,
.sz-grow, .sz-rec, .sz-rec-detail, .sz-detail-note, .sz-badge, .sz-ibtn, .sz-del-btn,
.sz-detail-sec-title, .sz-detail-finding, .sz-detail-note-content, .sz-rtitle, .sz-rmeta,
.sz-pending, .sz-empty, .sz-mode, .sz-clear, .sz-gtitle, .sz-count, .sz-theme-btn {
  transition: background-color .45s ease-in-out, color .45s ease-in-out, border-color .45s ease-in-out, box-shadow .45s ease-in-out;
}

* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
.sz-dock { position: fixed; left: 0; top: 0; width: 40px; height: 40px; z-index: 2147483000; }
.sz-fab { position: absolute; left: 0; top: 0; width: 40px; height: 40px; border-radius: 50%; background: var(--bg-panel); border: 1px solid var(--bd-panel); box-shadow: var(--shadow-fab); display: flex; align-items: center; justify-content: center; cursor: grab; color: var(--fab-color); padding: 0; }
.sz-fab.dragging { cursor: grabbing; }
.sz-fab:hover { background: var(--bg-hover); }
.sz-fab.on { color: var(--accent); border-color: var(--accent-soft); }
.sz-pending { position: absolute; right: 48px; top: 10px; display: none; padding: 2px 8px; border-radius: 999px; background: var(--bg-panel); border: 1px solid var(--bd-panel); box-shadow: 0 2px 8px rgba(0,0,0,.1); color: var(--tx-secondary); font-size: 11px; pointer-events: none; white-space: nowrap; }
.sz-pending.on { display: inline-block; animation: sz-breathe 1.6s ease-in-out infinite; }
@keyframes sz-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
.sz-panel { position: absolute; right: 0; bottom: 48px; width: 360px; max-height: 70vh; background: var(--bg-panel); border: 1px solid var(--bd-panel); border-radius: 8px; box-shadow: var(--shadow-panel); display: none; flex-direction: column; color: var(--tx-primary); font-size: 13px; overflow: hidden; }
.sz-panel.open { display: flex; }
.sz-resize { position: absolute; top: 0; left: 0; width: 16px; height: 16px; cursor: nwse-resize; z-index: 2; }
.sz-resize svg { position: absolute; top: 3px; left: 3px; }
.sz-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--bd-light); }
.sz-title { font-size: 14px; font-weight: 600; flex: 1; }
.sz-mode { color: var(--tx-secondary); font-size: 12px; }
.sz-theme-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 6px; color: var(--tx-secondary); cursor: pointer; padding: 0; flex: none; }
.sz-theme-btn:hover { background: var(--bg-hover); color: var(--tx-primary); }
.sz-switch { position: relative; width: 34px; height: 20px; appearance: none; -webkit-appearance: none; background: var(--bg-badge); border-radius: 999px; cursor: pointer; transition: background .15s, background-color .45s ease-in-out; margin: 0; flex: none; }
.sz-switch:checked { background: var(--accent); }
.sz-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.sz-switch:checked::after { left: 16px; }
.sz-tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
.sz-tab { flex: 1; padding: 6px 0; text-align: center; border-radius: 6px; cursor: pointer; color: var(--tx-secondary); background: transparent; border: none; font-size: 13px; }
.sz-tab.act { background: var(--bg-tab-act); color: var(--tx-primary); font-weight: 600; }
.sz-body { padding: 10px 12px; overflow-y: auto; flex: 1; min-height: 120px; }
.sz-body.sz-animH { flex: none; overflow: hidden; transition: height .2s ease; }
.sz-foot { padding: 8px 12px; border-top: 1px solid var(--bd-light); display: flex; justify-content: space-between; align-items: center; color: var(--tx-muted); font-size: 11px; }
.sz-clear { background: none; border: none; color: var(--tx-muted); font-size: 11px; cursor: pointer; padding: 0; }
.sz-clear:hover { color: var(--tx-danger); }
.sz-add { display: flex; gap: 6px; margin-bottom: 8px; }
.sz-input { flex: 1; padding: 6px 8px; border: 1px solid var(--bd-input); border-radius: 6px; font-size: 13px; outline: none; min-width: 0; background: var(--bg-input); color: var(--tx-primary); }
.sz-input:focus { border-color: var(--accent); }
.sz-ibtn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 6px; color: var(--tx-secondary); cursor: pointer; padding: 0; flex: none; }
.sz-ibtn:hover { background: var(--bg-hover); color: var(--tx-primary); }
.sz-grow { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--bd-dash); }
.sz-gtitle { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--tx-primary); }
.sz-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--bg-badge); color: var(--tx-secondary); flex: none; }
.sz-badge.on { background: var(--bg-badge-on); color: var(--accent); }
.sz-empty { color: var(--tx-muted); text-align: center; padding: 24px 0; }
.sz-sec { display: flex; align-items: center; gap: 6px; font-weight: 600; margin: 10px 0 4px; color: var(--tx-primary); }
.sz-sec:first-child { margin-top: 0; }
.sz-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sz-count { color: var(--tx-muted); font-weight: 400; font-size: 12px; }
.sz-rec { padding: 6px 0; border-bottom: 1px dashed var(--bd-dash); }
.sz-rec-head { display: flex; align-items: flex-start; gap: 4px; }
.sz-rec-main { flex: 1; min-width: 0; cursor: pointer; }
.sz-rec-actions { display: flex; gap: 2px; flex: none; align-items: center; }
.sz-rec.expanded .sz-rmeta { -webkit-line-clamp: unset; overflow: visible; }
.sz-rec-detail { display: none; margin-top: 6px; padding: 8px; background: var(--bg-card); border-radius: 6px; font-size: 12px; color: var(--tx-tertiary); line-height: 1.6; word-break: break-word; }
.sz-rec.expanded .sz-rec-detail { display: block; }
.sz-detail-sec { margin-top: 8px; }
.sz-detail-sec:first-child { margin-top: 0; }
.sz-detail-sec-title { font-size: 12px; font-weight: 600; color: var(--tx-primary); margin-bottom: 4px; }
.sz-detail-finding { display: flex; gap: 4px; padding: 2px 0; color: var(--tx-tertiary); }
.sz-detail-finding::before { content: "•"; color: var(--tx-muted); flex: none; }
.sz-detail-note { padding: 6px 8px; background: var(--bg-note); border-radius: 4px; border: 1px solid var(--bd-note); margin-top: 4px; }
.sz-detail-note-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.sz-detail-note-topic { font-weight: 600; color: var(--tx-primary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sz-detail-note-rel { font-size: 10px; padding: 1px 6px; border-radius: 999px; flex: none; color: var(--tx-secondary); background: var(--bg-badge); }
.sz-detail-note-content { color: var(--tx-tertiary); font-size: 12px; }
.sz-del-btn { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 4px; color: var(--tx-muted); cursor: pointer; padding: 0; flex: none; }
.sz-del-btn:hover { background: var(--bg-del-hover); color: var(--tx-danger); }
.sz-rel { width: 8px; height: 8px; border-radius: 50%; flex: none; margin-top: 5px; }
.sz-rel-high { background: var(--rel-high); }
.sz-rel-mid { background: var(--rel-mid); }
.sz-rel-low { background: var(--rel-low); }
.sz-rel-none { background: var(--rel-none); }
.sz-rtitle { display: block; color: var(--tx-primary); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-rtitle:hover { text-decoration: underline; color: var(--tx-link); }
.sz-rmeta { color: var(--tx-secondary); font-size: 12px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sz-select { margin-top: 4px; font-size: 11px; color: var(--tx-secondary); border: 1px solid var(--bd-input); border-radius: 4px; max-width: 140px; background: var(--bg-input); }
.sz-retry { margin-top: 4px; font-size: 11px; color: var(--tx-danger); border: 1px solid var(--bd-retry); border-radius: 4px; background: var(--bg-retry); cursor: pointer; padding: 1px 8px; }
.sz-retry:hover { background: var(--bg-retry-hover); }
.sz-toasts { position: absolute; right: 48px; bottom: 0; width: max-content; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; z-index: 1; pointer-events: none; }
.sz-toast { background: var(--bg-toast-ok); color: var(--tx-inverse); padding: 8px 12px; border-radius: 6px; font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.2); max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; transform: translateX(40px) scale(.85); transform-origin: right center; transition: transform .25s ease-out, opacity .25s ease-out; }
.sz-toast.show { opacity: 1; transform: translateX(0) scale(1); }
.sz-toast.hide { opacity: 0; transform: translateX(40px) scale(.85); transition-timing-function: ease-in; }
.sz-toast.idle { background: var(--bg-toast-idle); }
.sz-toast.err { background: var(--bg-toast-err); }
.sz-dock.flip-v .sz-panel { bottom: auto; top: 48px; }
.sz-dock.flip-v .sz-toasts { bottom: auto; top: 0; }
.sz-dock.flip-h .sz-panel { right: auto; left: 0; }
.sz-dock.flip-h .sz-pending { right: auto; left: 48px; }
.sz-dock.flip-h .sz-toasts { right: auto; left: 48px; align-items: flex-start; }
.sz-dock.flip-h .sz-toast { transform: translateX(-40px) scale(.85); transform-origin: left center; }
.sz-dock.flip-h .sz-toast.show { transform: translateX(0) scale(1); }
.sz-dock.flip-h .sz-toast.hide { transform: translateX(-40px) scale(.85); }
.sz-dock.flip-v .sz-resize { top: auto; bottom: 0; cursor: nesw-resize; }
.sz-dock.flip-h .sz-resize { left: auto; right: 0; cursor: nesw-resize; }
.sz-dock.flip-v.flip-h .sz-resize { cursor: nwse-resize; }
.sz-dock.flip-h .sz-resize svg { left: auto; right: 3px; transform: scaleX(-1); }
.sz-dock.flip-v .sz-resize svg { top: auto; bottom: 3px; transform: scaleY(-1); }
.sz-dock.flip-v.flip-h .sz-resize svg { transform: scale(-1, -1); }
`;

export const Panel = {
  tab: "goals",
  root: null as ShadowRoot | null,
  pos: { x: 0, y: 0 },
  suppressFabClick: false,
  animTimer: 0,
  panelSize: null as { w: number; h: number } | null,
  els: {} as {
    dock: HTMLDivElement;
    fab: HTMLButtonElement;
    resize: HTMLDivElement;
    pending: HTMLSpanElement;
    panel: HTMLDivElement;
    body: HTMLDivElement;
    toasts: HTMLDivElement;
    workmode: HTMLInputElement;
    driver: HTMLSpanElement;
    tabs: HTMLButtonElement[];
    themeBtn: HTMLButtonElement;
  },
  mount(): void {
    const host = document.createElement("div");
    host.id = "shizhi-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
<style>${CSS}</style>
<div class="sz-dock">
<div class="sz-toasts"></div>
<button class="sz-fab" data-act="fab" title="拾知">${ICONS.bulb}</button>
<span class="sz-pending" data-role="pending">分析中</span>
<div class="sz-panel">
  <div class="sz-resize" data-role="resize" title="拖拽调整大小 · 双击恢复默认"><svg viewBox="0 0 10 10" width="10" height="10" fill="none"><path d="M1 9 9 1M4 9 9 4M7 9 9 7" stroke="#d1d5db" stroke-width="1.2" stroke-linecap="round"/></svg></div>
  <div class="sz-head">
    <span class="sz-title">拾知</span>
    <span class="sz-mode">工作模式</span>
    <input type="checkbox" class="sz-switch" data-role="workmode">
    <button class="sz-theme-btn" data-act="theme" title="切换主题"></button>
    <button class="sz-ibtn" data-act="close" title="关闭">${ICONS.x}</button>
  </div>
  <div class="sz-tabs">
    <button class="sz-tab act" data-act="tab" data-tab="goals">目标</button>
    <button class="sz-tab" data-act="tab" data-tab="records">记录</button>
  </div>
  <div class="sz-body"></div>
  <div class="sz-foot"><span data-role="driver"></span><button class="sz-clear" data-act="clear">清空数据</button></div>
</div>
</div>`;
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
      workmode: shadow.querySelector('[data-role="workmode"]')!,
      driver: shadow.querySelector('[data-role="driver"]')!,
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
    shadow.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    shadow.addEventListener("change", (e) => this.onChange(e as Event));
    shadow.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" && (e.target as Element).matches('[data-role="goal-input"]')) this.addGoal();
    });
    this.render();
  },
  onClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest("[data-act]") as HTMLElement | null;
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "fab") { if (!this.suppressFabClick) this.els.panel.classList.toggle("open"); } // 拖拽后的 click 不触发展开
    else if (act === "close") this.els.panel.classList.remove("open");
    else if (act === "tab") this.switchTab(btn.dataset.tab!);
    else if (act === "add-goal") this.addGoal();
    else if (act === "toggle-goal") this.toggleGoal(btn.closest(".sz-grow").dataset.id);
    else if (act === "del-goal") this.delGoal(btn.closest(".sz-grow").dataset.id);
    else if (act === "retry") this.retryRecord(btn.dataset.rid);
    else if (act === "expand") { btn.closest(".sz-rec")!.classList.toggle("expanded"); }
    else if (act === "del-record") this.delRecord(btn.dataset.rid!);
    else if (act === "clear") this.clearAll();
    else if (act === "theme") this.toggleTheme();
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
    } else if (t.matches('[data-role="reassign"]')) {
      const recs = Store.read<BrowseRecord[]>(K.records, []);
      const rec = recs.find((r) => r.id === t.dataset.rid);
      if (rec) { rec.category = (t as HTMLSelectElement).value; Store.write(K.records, recs); this.render(); }
    }
  },
  addGoal(): void {
    const input = this.root!.querySelector('[data-role="goal-input"]') as HTMLInputElement;
    const title = (input.value || "").trim();
    if (!title) return;
    const goals = Store.read<Goal[]>(K.goals, []);
    goals.unshift({ id: uid("g"), title, status: "active", createdAt: Date.now(), todos: [] });
    Store.write(K.goals, goals);
    input.value = "";
    this.render();
    onLocationChange(); // 有目标后立即可记录
  },
  toggleGoal(id: string): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    g.status = g.status === "active" ? "done" : "active";
    Store.write(K.goals, goals);
    this.render();
  },
  delGoal(id: string): void {
    if (!confirm("删除这个目标？已归档的记录会保留。")) return;
    Store.write(K.goals, Store.read<Goal[]>(K.goals, []).filter((x) => x.id !== id));
    this.render();
  },
  delRecord(rid: string): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const idx = recs.findIndex((r) => r.id === rid);
    if (idx < 0) return;
    recs.splice(idx, 1);
    Store.write(K.records, recs);
    const q = Store.read<{ recordId: string }[]>(K.queue, []);
    Store.write(K.queue, q.filter((item) => item.recordId !== rid));
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
  clearAll(): void {
    if (!confirm("清空拾知的全部数据（目标、记录、队列）？")) return;
    Object.values(K).forEach((k) => Store.del(k));
    this.render();
  },
  switchTab(tab: string): void {
    if (tab === this.tab) return;
    this.tab = tab;
    if (this.panelSize) { this.render(); return; } // 已自定义尺寸：高度固定，跳过高度过渡
    const body = this.els.body;
    const prevH = body.offsetHeight;
    const chrome = this.els.panel.offsetHeight - prevH; // 头部/标签栏/底部等固定高度
    this.render(); // 更新 tab 激活态并替换内容
    // 高度丝滑过渡：固定旧高度 → 过渡到新内容的自然高度（受 70vh 上限约束）
    const newH = Math.max(120, Math.min(body.scrollHeight, Math.round(window.innerHeight * 0.7) - chrome));
    clearTimeout(this.animTimer);
    body.classList.add("sz-animH");
    body.style.height = prevH + "px";
    void body.offsetHeight; // 强制 reflow，确保过渡生效
    body.style.height = newH + "px";
    this.animTimer = setTimeout(() => {
      body.classList.remove("sz-animH");
      body.style.height = "";
    }, 220);
  },
  render(): void {
    if (!this.root) return;
    const st = getState();
    this.els.workmode.checked = !!st.workMode;
    this.els.fab.classList.toggle("on", !!st.workMode);
    this.els.pending.classList.toggle("on", Store.read<QueueItem[]>(K.queue, []).length > 0);
    this.els.driver.textContent = "存储：" + Store.driverLabel();
    this.els.tabs.forEach((t) => t.classList.toggle("act", t.dataset.tab === this.tab));
    if (this.tab === "goals") this.renderGoals();
    else this.renderRecords();
  },
  renderGoals(): void {
    const goals = Store.read<Goal[]>(K.goals, []);
    const rows = goals.map((g) => `
    <div class="sz-grow" data-id="${esc(g.id)}">
      <span class="sz-gtitle" title="${esc(g.title)}">${esc(g.title)}</span>
      <span class="sz-badge ${g.status === "active" ? "on" : ""}">${g.status === "active" ? "进行中" : "已完成"}</span>
      <button class="sz-ibtn" data-act="toggle-goal" title="${g.status === "active" ? "标记完成" : "重新开启"}">${ICONS.check}</button>
      <button class="sz-ibtn" data-act="del-goal" title="删除">${ICONS.trash}</button>
    </div>`).join("");
    this.els.body.innerHTML = `
    <div class="sz-add">
      <input class="sz-input" data-role="goal-input" placeholder="输入工作目标，回车添加" maxlength="80">
      <button class="sz-ibtn" data-act="add-goal" title="添加目标">${ICONS.plus}</button>
    </div>
    ${rows || '<div class="sz-empty">暂无目标</div>'}`;
  },
  renderRecords(): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const goals = Store.read<Goal[]>(K.goals, []);
    const groups: { key: string; name: string; color: string; items: BrowseRecord[] }[] = goals.map((g) => ({
      key: "goal:" + g.id, name: g.title,
      color: g.status === "active" ? "#16a34a" : "#9ca3af", items: [] as BrowseRecord[],
    }));
    groups.push(
      { key: "slacking", name: "摸鱼", color: "#d97706", items: [] as BrowseRecord[] },
      { key: "pending", name: "分析中", color: "#6b7280", items: [] as BrowseRecord[] },
      { key: "error", name: "分析失败", color: "#dc2626", items: [] as BrowseRecord[] },
      { key: "orphan", name: "已移除目标", color: "#9ca3af", items: [] as BrowseRecord[] }
    );
    for (const r of recs) {
      let g = groups.find((x) => x.key === r.category);
      if (!g) {
        g = groups.find((x) => x.key === (String(r.category).startsWith("goal:") ? "orphan" : "pending"));
      }
      g!.items.push(r);
    }
    const activeGoals = goals.filter((g) => g.status === "active");
    const selectHtml = (r: BrowseRecord): string => {
      const known = r.category === "slacking" || activeGoals.some((g) => "goal:" + g.id === r.category);
      const opts = ['<option value="" disabled ' + (known ? "" : "selected") + ">移动到…</option>"]
        .concat(activeGoals.map((g) =>
          `<option value="goal:${esc(g.id)}" ${r.category === "goal:" + g.id ? "selected" : ""}>${esc(g.title)}</option>`))
        .concat([`<option value="slacking" ${r.category === "slacking" ? "selected" : ""}>摸鱼</option>`]);
      return `<select class="sz-select" data-role="reassign" data-rid="${esc(r.id)}">${opts.join("")}</select>`;
    };
    let html = "";
    for (const g of groups) {
      if (!g.items.length) continue;
      html += `<div class="sz-sec"><span class="sz-dot" style="background:${g.color}"></span>${esc(g.name)}<span class="sz-count">${g.items.length}</span></div>`;
      html += g.items.slice(0, 50).map((r) => {
        const movable = r.category === "slacking" || String(r.category).startsWith("goal:");
        const findingsHtml = r.findings?.length
          ? `<div class="sz-detail-sec"><div class="sz-detail-sec-title">💡 关键发现</div>${r.findings.map((f) => `<div class="sz-detail-finding">${esc(f)}</div>`).join("")}</div>`
          : "";
        const notesHtml = r.notes?.length
          ? `<div class="sz-detail-sec"><div class="sz-detail-sec-title">📒 提取笔记</div>${r.notes.map((n) => `<div class="sz-detail-note"><div class="sz-detail-note-head"><span class="sz-detail-note-topic">${esc(n.topic)}</span><span class="sz-detail-note-rel">相关度 ${n.relevance}%</span></div><div class="sz-detail-note-content">${esc(n.content)}</div></div>`).join("")}</div>`
          : "";
        const relCls = r.relevance == null ? "sz-rel-none" : r.relevance >= 60 ? "sz-rel-high" : r.relevance >= 30 ? "sz-rel-mid" : "sz-rel-low";
        const relTitle = r.relevance == null ? "未分析" : `相关度 ${r.relevance}/100`;
        return `
      <div class="sz-rec" data-id="${esc(r.id)}">
        <div class="sz-rec-head">
          <span class="sz-rel ${relCls}" title="${relTitle}"></span>
          <div class="sz-rec-main" data-act="expand">
            <a class="sz-rtitle" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(r.title || r.url)}</a>
            <div class="sz-rmeta">${fmtTime(r.capturedAt)} · ${esc(r.summary || r.preview || "")}</div>
          </div>
          <div class="sz-rec-actions">
            ${r.category === "pending" ? '<span class="sz-badge">分析中</span>' : ""}
            <button class="sz-del-btn" data-act="del-record" data-rid="${esc(r.id)}" title="删除">${ICONS.x}</button>
          </div>
        </div>
        <div class="sz-rec-detail">${findingsHtml}${notesHtml}${r.category === "pending" ? "正在分析中，请稍等片刻~" : ""}</div>
        ${movable ? selectHtml(r) : ""}
        ${r.category === "error" && r.excerpt ? `<button class="sz-retry" data-act="retry" data-rid="${esc(r.id)}">重试</button>` : ""}
      </div>`;
      }).join("");
    }
    this.els.body.innerHTML = html || '<div class="sz-empty">暂无记录</div>';
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
