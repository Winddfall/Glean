// 面板 UI（Shadow DOM）：目标/记录双 Tab + Toast

import { K } from "./core/constants.js";
import { esc, fmtTime, uid } from "./core/utils.js";
import { Store, getState } from "./store.js";
import { onLocationChange } from "./watcher.js";
import { pumpQueue } from "./queue.js";
import type { Goal, BrowseRecord } from "./types.js";

const ICONS = {
  bulb: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
};

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
.sz-fab { position: fixed; right: 16px; bottom: 16px; width: 40px; height: 40px; border-radius: 50%; background: #fff; border: 1px solid #e2e4e9; box-shadow: 0 4px 14px rgba(0,0,0,.14); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483000; color: #d97706; padding: 0; }
.sz-fab:hover { background: #fafafa; }
.sz-fab.on { color: #16a34a; border-color: #bbf7d0; }
.sz-panel { position: fixed; right: 16px; bottom: 64px; width: 360px; max-height: 70vh; background: #fff; border: 1px solid #e2e4e9; border-radius: 8px; box-shadow: 0 10px 32px rgba(0,0,0,.16); display: none; flex-direction: column; z-index: 2147483000; color: #1f2328; font-size: 13px; overflow: hidden; }
.sz-panel.open { display: flex; }
.sz-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #eef0f3; }
.sz-title { font-size: 14px; font-weight: 600; flex: 1; }
.sz-mode { color: #6b7280; font-size: 12px; }
.sz-switch { position: relative; width: 34px; height: 20px; appearance: none; -webkit-appearance: none; background: #e5e7eb; border-radius: 999px; cursor: pointer; transition: background .15s; margin: 0; flex: none; }
.sz-switch:checked { background: #16a34a; }
.sz-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.sz-switch:checked::after { left: 16px; }
.sz-tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
.sz-tab { flex: 1; padding: 6px 0; text-align: center; border-radius: 6px; cursor: pointer; color: #6b7280; background: transparent; border: none; font-size: 13px; }
.sz-tab.act { background: #f3f4f6; color: #111827; font-weight: 600; }
.sz-body { padding: 10px 12px; overflow-y: auto; flex: 1; min-height: 120px; }
.sz-foot { padding: 8px 12px; border-top: 1px solid #eef0f3; display: flex; justify-content: space-between; align-items: center; color: #9ca3af; font-size: 11px; }
.sz-clear { background: none; border: none; color: #9ca3af; font-size: 11px; cursor: pointer; padding: 0; }
.sz-clear:hover { color: #dc2626; }
.sz-add { display: flex; gap: 6px; margin-bottom: 8px; }
.sz-input { flex: 1; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; outline: none; min-width: 0; }
.sz-input:focus { border-color: #16a34a; }
.sz-ibtn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 6px; color: #6b7280; cursor: pointer; padding: 0; flex: none; }
.sz-ibtn:hover { background: #f3f4f6; color: #111827; }
.sz-grow { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px dashed #f0f1f3; }
.sz-gtitle { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #f3f4f6; color: #6b7280; flex: none; }
.sz-badge.on { background: #dcfce7; color: #166534; }
.sz-empty { color: #9ca3af; text-align: center; padding: 24px 0; }
.sz-sec { display: flex; align-items: center; gap: 6px; font-weight: 600; margin: 10px 0 4px; }
.sz-sec:first-child { margin-top: 0; }
.sz-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sz-count { color: #9ca3af; font-weight: 400; font-size: 12px; }
.sz-rec { padding: 6px 0; border-bottom: 1px dashed #f0f1f3; }
.sz-rtitle { display: block; color: #1f2328; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sz-rtitle:hover { text-decoration: underline; color: #2563eb; }
.sz-rmeta { color: #6b7280; font-size: 12px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sz-select { margin-top: 4px; font-size: 11px; color: #6b7280; border: 1px solid #e5e7eb; border-radius: 4px; max-width: 140px; background: #fff; }
.sz-retry { margin-top: 4px; font-size: 11px; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; background: #fff; cursor: pointer; padding: 1px 8px; }
.sz-retry:hover { background: #fef2f2; }
.sz-toasts { position: fixed; left: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 2147483001; pointer-events: none; }
.sz-toast { background: #166534; color: #f9fafb; padding: 8px 12px; border-radius: 6px; font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.2); max-width: 300px; }
.sz-toast.idle { background: #92400e; }
.sz-toast.err { background: #b91c1c; }
`;

export const Panel = {
  tab: "goals",
  root: null as ShadowRoot | null,
  els: {} as {
    fab: HTMLButtonElement;
    panel: HTMLDivElement;
    body: HTMLDivElement;
    toasts: HTMLDivElement;
    workmode: HTMLInputElement;
    driver: HTMLSpanElement;
    tabs: HTMLButtonElement[];
  },
  mount(): void {
    const host = document.createElement("div");
    host.id = "shizhi-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
<style>${CSS}</style>
<div class="sz-toasts"></div>
<button class="sz-fab" data-act="fab" title="拾知">${ICONS.bulb}</button>
<div class="sz-panel">
  <div class="sz-head">
    <span class="sz-title">拾知</span>
    <span class="sz-mode">工作模式</span>
    <input type="checkbox" class="sz-switch" data-role="workmode">
    <button class="sz-ibtn" data-act="close" title="关闭">${ICONS.x}</button>
  </div>
  <div class="sz-tabs">
    <button class="sz-tab act" data-act="tab" data-tab="goals">目标</button>
    <button class="sz-tab" data-act="tab" data-tab="records">记录</button>
  </div>
  <div class="sz-body"></div>
  <div class="sz-foot"><span data-role="driver"></span><button class="sz-clear" data-act="clear">清空数据</button></div>
</div>`;
    document.documentElement.appendChild(host);
    this.root = shadow;
    this.els = {
      fab: shadow.querySelector(".sz-fab")!,
      panel: shadow.querySelector(".sz-panel")!,
      body: shadow.querySelector(".sz-body")!,
      toasts: shadow.querySelector(".sz-toasts")!,
      workmode: shadow.querySelector('[data-role="workmode"]')!,
      driver: shadow.querySelector('[data-role="driver"]')!,
      tabs: Array.from(shadow.querySelectorAll(".sz-tab")),
    };
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
    if (act === "fab") this.els.panel.classList.toggle("open");
    else if (act === "close") this.els.panel.classList.remove("open");
    else if (act === "tab") { this.tab = btn.dataset.tab; this.render(); }
    else if (act === "add-goal") this.addGoal();
    else if (act === "toggle-goal") this.toggleGoal(btn.closest(".sz-grow").dataset.id);
    else if (act === "del-goal") this.delGoal(btn.closest(".sz-grow").dataset.id);
    else if (act === "retry") this.retryRecord(btn.dataset.rid);
    else if (act === "clear") this.clearAll();
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
  retryRecord(rid: string): void {
    const recs = Store.read<BrowseRecord[]>(K.records, []);
    const rec = recs.find((r) => r.id === rid);
    if (!rec || !rec.excerpt) return;
    rec.category = "pending";
    const q = Store.read<BrowseRecord[]>(K.queue, []);
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
  render(): void {
    if (!this.root) return;
    const st = getState();
    this.els.workmode.checked = !!st.workMode;
    this.els.fab.classList.toggle("on", !!st.workMode);
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
    const groups = goals.map((g) => ({
      key: "goal:" + g.id, name: g.title,
      color: g.status === "active" ? "#16a34a" : "#9ca3af", items: [],
    }));
    groups.push(
      { key: "slacking", name: "摸鱼", color: "#d97706", items: [] },
      { key: "pending", name: "分析中", color: "#6b7280", items: [] },
      { key: "error", name: "分析失败", color: "#dc2626", items: [] },
      { key: "orphan", name: "已移除目标", color: "#9ca3af", items: [] }
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
        return `
      <div class="sz-rec" data-id="${esc(r.id)}">
        <a class="sz-rtitle" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(r.title || r.url)}</a>
        <div class="sz-rmeta">${fmtTime(r.capturedAt)} · ${esc(r.summary || r.preview || "")}</div>
        ${movable ? selectHtml(r) : ""}
        ${r.category === "error" && r.excerpt ? `<button class="sz-retry" data-act="retry" data-rid="${esc(r.id)}">重试</button>` : ""}
      </div>`;
      }).join("");
    }
    this.els.body.innerHTML = html || '<div class="sz-empty">暂无记录</div>';
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
