"use strict";
(() => {
  // src/core/constants.ts
  var K = {
    state: "shizhi.state",
    goals: "shizhi.goals",
    records: "shizhi.records",
    queue: "shizhi.queue",
    settings: "shizhi.settings"
  };
  var DEFAULT_SETTINGS = {
    dwellMs: 3e3,
    // 停留闸：可见且连续停留 >= 3s 才记录
    settleMs: 1500,
    // 页面/路由变化后等待渲染的时间
    queueGapMs: 2e3,
    // 两次 LLM 调用的最小间隔
    contentMaxChars: 3e3,
    // 正文摘录截断
    dedupeWindowMs: 30 * 60 * 1e3,
    recordCap: 500,
    excludedSites: []
    // 子串匹配 URL，命中不记录
  };

  // src/store.ts
  var Store = {
    get(k) {
      return localStorage.getItem(k);
    },
    set(k, v) {
      return localStorage.setItem(k, v);
    },
    del(k) {
      return localStorage.removeItem(k);
    },
    read(k, fallback) {
      try {
        const raw = this.get(k);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    write(k, v) {
      this.set(k, JSON.stringify(v));
    },
    driverLabel() {
      return "localStorage\uFF08\u672C\u7AD9\u70B9\uFF09";
    }
  };
  function settings() {
    return Object.assign({}, DEFAULT_SETTINGS, Store.read(K.settings, {}));
  }
  function getState() {
    return Object.assign({ workMode: false, activeSince: 0 }, Store.read(K.state, {}));
  }

  // src/core/utils.ts
  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }
  function truncate(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) : s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function backoffMs(retries) {
    return [5e3, 15e3, 6e4][clamp(retries, 1, 3) - 1];
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function parseJsonLoose(raw) {
    if (raw && typeof raw === "object") return raw;
    let s = String(raw == null ? "" : raw).trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  }

  // src/extract.ts
  function extractPage() {
    const title = document.title || "";
    const h1 = ((document.querySelector("h1") || {}).textContent || "").trim();
    const metaEl = document.querySelector('meta[name="description"]');
    const meta = (metaEl ? metaEl.getAttribute("content") : "").trim();
    const text = extractMainText();
    return { url: location.href, origin: location.origin, title, h1, meta, text };
  }
  function extractMainText() {
    const max = settings().contentMaxChars;
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(
      'script,style,noscript,iframe,svg,form,button,select,textarea,input,nav,aside,header,footer,[aria-hidden="true"],[class*="comment"],[id*="comment"],[class*="sidebar"],[id*="sidebar"]'
    ).forEach((el) => el.remove());
    const norm = (s) => truncate(
      String(s || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(),
      max
    );
    const cands = ["article", "main", '[role="main"]', "#content", ".content", ".article", ".post", ".entry-content", ".markdown-body"];
    for (const sel of cands) {
      const el = clone.querySelector(sel);
      if (el && (el.textContent || "").trim().length > 200) return norm(el.textContent);
    }
    let best = clone;
    let bestScore = 0;
    const divs = clone.querySelectorAll("div, section");
    const n = Math.min(divs.length, 800);
    for (let i = 0; i < n; i++) {
      const d = divs[i];
      const t = (d.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length < 200) continue;
      let lt = 0;
      d.querySelectorAll("a").forEach((a) => {
        lt += (a.textContent || "").length;
      });
      const score = t.length - lt * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return norm(best.textContent);
  }

  // src/core/prompt.ts
  function buildPagePrompt(page, goals) {
    const goalLines = goals.map((g, i) => `${i + 1}. ${g.id}\uFF1A${g.title}`).join("\n");
    return [
      '\u4F60\u662F"\u62FE\u77E5"\u5206\u6790\u5668\u3002\u5224\u65AD\u7F51\u9875\u5185\u5BB9\u4E0E\u7528\u6237\u5DE5\u4F5C\u76EE\u6807\u7684\u5173\u7CFB\uFF0C\u53EA\u8F93\u51FA JSON\u3002',
      "",
      "[\u5DE5\u4F5C\u76EE\u6807]",
      goalLines,
      "",
      "[\u7F51\u9875]",
      `URL: ${page.url}`,
      `\u6807\u9898: ${page.title}`,
      page.h1 ? `\u7AE0\u8282: ${page.h1}` : "",
      page.meta ? `\u7B80\u4ECB: ${page.meta}` : "",
      "\u6B63\u6587\u6458\u5F55:",
      page.excerpt,
      "",
      "\u8F93\u51FA JSON\uFF08\u4E0D\u8981\u8F93\u51FA\u4EFB\u4F55\u5176\u4ED6\u5185\u5BB9\uFF09\uFF1A",
      '{"relevant": true\u6216false, "goalId": "\u76EE\u6807id\u6216null", "summary": "80\u5B57\u4EE5\u5185\u9875\u9762\u6458\u8981", "keywords": ["\u5173\u952E\u8BCD"]}',
      "\u89C4\u5219\uFF1AgoalId \u53EA\u80FD\u4ECE\u4E0A\u65B9\u5DE5\u4F5C\u76EE\u6807\u7684 id \u4E2D\u9009\u6700\u76F8\u5173\u7684\u4E00\u4E2A\uFF1B\u4E0E\u4EFB\u4F55\u76EE\u6807\u90FD\u65E0\u5173\u65F6 relevant=false\u3001goalId=null\uFF1B\u62FF\u4E0D\u51C6\u65F6 relevant=false\u3002"
    ].filter(Boolean).join("\n");
  }
  function validateAnalysis(json, goals) {
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bad analysis json");
    const obj = json;
    const ids = new Set(goals.map((g) => g.id));
    let relevant = obj.relevant === true || obj.relevant === "true";
    const goalId = typeof obj.goalId === "string" && ids.has(obj.goalId) ? obj.goalId : null;
    if (!goalId) relevant = false;
    return {
      relevant,
      goalId,
      summary: truncate(typeof obj.summary === "string" ? obj.summary : "", 200),
      keywords: Array.isArray(obj.keywords) ? obj.keywords.slice(0, 8).map(String) : []
    };
  }

  // src/queue.ts
  var pumping = false;
  async function pumpQueue() {
    if (pumping) return;
    pumping = true;
    try {
      for (; ; ) {
        const q = Store.read(K.queue, []);
        const now = Date.now();
        const item = q.find((i) => (i.nextAt || 0) <= now);
        if (!item) break;
        const recs = Store.read(K.records, []);
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
            rec.excerpt = item.excerpt;
            Store.write(K.records, recs);
            Store.write(K.queue, Store.read(K.queue, []).filter((i) => i.recordId !== item.recordId));
            Panel.render();
          } else {
            item.nextAt = Date.now() + backoffMs(item.retries);
            Store.write(K.queue, q);
            break;
          }
        }
      }
    } finally {
      pumping = false;
    }
  }
  async function analyze(rec, item) {
    const goals = Store.read(K.goals, []).filter((g2) => g2.status === "active");
    const prompt = buildPagePrompt(
      { url: rec.url, title: rec.title, h1: rec.h1, meta: rec.meta, excerpt: item.excerpt },
      goals
    );
    const raw = await LLMBridge.chat(prompt, "json");
    const res = validateAnalysis(parseJsonLoose(raw), goals);
    rec.summary = res.summary;
    rec.keywords = res.keywords;
    rec.category = res.relevant && res.goalId ? "goal:" + res.goalId : "slacking";
    const g = goals.find((x) => x.id === res.goalId);
    Panel.toast(res.relevant && g ? "\u5DF2\u5F52\u6863\u81F3\uFF1A" + g.title : "\u5DF2\u5F52\u5165\u6478\u9C7C", res.relevant && g ? "ok" : "idle");
  }

  // src/watcher.ts
  var settleTimer = 0;
  var dwellTimer = 0;
  var visListener = null;
  function onLocationChange() {
    clearTimeout(settleTimer);
    clearTimeout(dwellTimer);
    settleTimer = setTimeout(armDwell, settings().settleMs);
  }
  function armDwell() {
    if (document.visibilityState !== "visible") {
      if (!visListener) {
        visListener = () => {
          if (document.visibilityState === "visible") {
            document.removeEventListener("visibilitychange", visListener);
            visListener = null;
            dwellTimer = setTimeout(capture, settings().dwellMs);
          }
        };
        document.addEventListener("visibilitychange", visListener);
      }
      return;
    }
    dwellTimer = setTimeout(capture, settings().dwellMs);
  }
  function capture() {
    const st = getState();
    if (!st.workMode) return;
    const goals = Store.read(K.goals, []).filter((g) => g.status === "active");
    if (!goals.length) return;
    if (settings().excludedSites.some((x) => location.href.includes(x))) return;
    if (document.visibilityState !== "visible") return;
    const page = extractPage();
    if (!page.text || page.text.length < 100) return;
    const hash = fnv1a(page.url.split("#")[0] + "|" + page.text.slice(0, 500));
    const recs = Store.read(K.records, []);
    const now = Date.now();
    if (recs.some((r) => r.excerptHash === hash && now - r.capturedAt < settings().dedupeWindowMs)) return;
    const rec = {
      id: uid("r"),
      url: page.url,
      origin: page.origin,
      title: page.title,
      h1: page.h1,
      meta: page.meta,
      capturedAt: now,
      excerptHash: hash,
      preview: truncate(page.text.replace(/\s+/g, " "), 160),
      category: "pending",
      summary: "",
      keywords: []
    };
    recs.unshift(rec);
    Store.write(K.records, recs.slice(0, settings().recordCap));
    const q = Store.read(K.queue, []);
    q.push({ recordId: rec.id, excerpt: page.text, retries: 0, nextAt: 0 });
    Store.write(K.queue, q);
    Panel.render();
    pumpQueue();
  }
  function hookHistory() {
    try {
      for (const m of ["pushState", "replaceState"]) {
        const orig = history[m];
        history[m] = function(...args) {
          const r = orig.apply(this, args);
          onLocationChange();
          return r;
        };
      }
      addEventListener("popstate", onLocationChange);
      addEventListener("hashchange", onLocationChange);
      const t = document.querySelector("title");
      if (t) new MutationObserver(() => onLocationChange()).observe(t, { childList: true });
    } catch (e) {
    }
  }

  // src/panel.ts
  var ICONS = {
    bulb: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
  };
  var CSS = `
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
  var Panel = {
    tab: "goals",
    root: null,
    els: {},
    mount() {
      const host = document.createElement("div");
      host.id = "shizhi-host";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
<style>${CSS}</style>
<div class="sz-toasts"></div>
<button class="sz-fab" data-act="fab" title="\u62FE\u77E5">${ICONS.bulb}</button>
<div class="sz-panel">
  <div class="sz-head">
    <span class="sz-title">\u62FE\u77E5</span>
    <span class="sz-mode">\u5DE5\u4F5C\u6A21\u5F0F</span>
    <input type="checkbox" class="sz-switch" data-role="workmode">
    <button class="sz-ibtn" data-act="close" title="\u5173\u95ED">${ICONS.x}</button>
  </div>
  <div class="sz-tabs">
    <button class="sz-tab act" data-act="tab" data-tab="goals">\u76EE\u6807</button>
    <button class="sz-tab" data-act="tab" data-tab="records">\u8BB0\u5F55</button>
  </div>
  <div class="sz-body"></div>
  <div class="sz-foot"><span data-role="driver"></span><button class="sz-clear" data-act="clear">\u6E05\u7A7A\u6570\u636E</button></div>
</div>`;
      document.documentElement.appendChild(host);
      this.root = shadow;
      this.els = {
        fab: shadow.querySelector(".sz-fab"),
        panel: shadow.querySelector(".sz-panel"),
        body: shadow.querySelector(".sz-body"),
        toasts: shadow.querySelector(".sz-toasts"),
        workmode: shadow.querySelector('[data-role="workmode"]'),
        driver: shadow.querySelector('[data-role="driver"]'),
        tabs: Array.from(shadow.querySelectorAll(".sz-tab"))
      };
      shadow.addEventListener("click", (e) => this.onClick(e));
      shadow.addEventListener("change", (e) => this.onChange(e));
      shadow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches('[data-role="goal-input"]')) this.addGoal();
      });
      this.render();
    },
    onClick(e) {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "fab") this.els.panel.classList.toggle("open");
      else if (act === "close") this.els.panel.classList.remove("open");
      else if (act === "tab") {
        this.tab = btn.dataset.tab;
        this.render();
      } else if (act === "add-goal") this.addGoal();
      else if (act === "toggle-goal") this.toggleGoal(btn.closest(".sz-grow").dataset.id);
      else if (act === "del-goal") this.delGoal(btn.closest(".sz-grow").dataset.id);
      else if (act === "retry") this.retryRecord(btn.dataset.rid);
      else if (act === "clear") this.clearAll();
    },
    onChange(e) {
      const t = e.target;
      if (t.matches('[data-role="workmode"]')) {
        const st = getState();
        st.workMode = t.checked;
        if (t.checked && !st.activeSince) st.activeSince = Date.now();
        Store.write(K.state, st);
        this.render();
        if (t.checked) onLocationChange();
      } else if (t.matches('[data-role="reassign"]')) {
        const recs = Store.read(K.records, []);
        const rec = recs.find((r) => r.id === t.dataset.rid);
        if (rec) {
          rec.category = t.value;
          Store.write(K.records, recs);
          this.render();
        }
      }
    },
    addGoal() {
      const input = this.root.querySelector('[data-role="goal-input"]');
      const title = (input.value || "").trim();
      if (!title) return;
      const goals = Store.read(K.goals, []);
      goals.unshift({ id: uid("g"), title, status: "active", createdAt: Date.now(), todos: [] });
      Store.write(K.goals, goals);
      input.value = "";
      this.render();
      onLocationChange();
    },
    toggleGoal(id) {
      const goals = Store.read(K.goals, []);
      const g = goals.find((x) => x.id === id);
      if (!g) return;
      g.status = g.status === "active" ? "done" : "active";
      Store.write(K.goals, goals);
      this.render();
    },
    delGoal(id) {
      if (!confirm("\u5220\u9664\u8FD9\u4E2A\u76EE\u6807\uFF1F\u5DF2\u5F52\u6863\u7684\u8BB0\u5F55\u4F1A\u4FDD\u7559\u3002")) return;
      Store.write(K.goals, Store.read(K.goals, []).filter((x) => x.id !== id));
      this.render();
    },
    retryRecord(rid) {
      const recs = Store.read(K.records, []);
      const rec = recs.find((r) => r.id === rid);
      if (!rec || !rec.excerpt) return;
      rec.category = "pending";
      const q = Store.read(K.queue, []);
      q.push({ recordId: rec.id, excerpt: rec.excerpt, retries: 0, nextAt: 0 });
      delete rec.excerpt;
      Store.write(K.records, recs);
      Store.write(K.queue, q);
      this.render();
      pumpQueue();
    },
    clearAll() {
      if (!confirm("\u6E05\u7A7A\u62FE\u77E5\u7684\u5168\u90E8\u6570\u636E\uFF08\u76EE\u6807\u3001\u8BB0\u5F55\u3001\u961F\u5217\uFF09\uFF1F")) return;
      Object.values(K).forEach((k) => Store.del(k));
      this.render();
    },
    render() {
      if (!this.root) return;
      const st = getState();
      this.els.workmode.checked = !!st.workMode;
      this.els.fab.classList.toggle("on", !!st.workMode);
      this.els.driver.textContent = "\u5B58\u50A8\uFF1A" + Store.driverLabel();
      this.els.tabs.forEach((t) => t.classList.toggle("act", t.dataset.tab === this.tab));
      if (this.tab === "goals") this.renderGoals();
      else this.renderRecords();
    },
    renderGoals() {
      const goals = Store.read(K.goals, []);
      const rows = goals.map((g) => `
    <div class="sz-grow" data-id="${esc(g.id)}">
      <span class="sz-gtitle" title="${esc(g.title)}">${esc(g.title)}</span>
      <span class="sz-badge ${g.status === "active" ? "on" : ""}">${g.status === "active" ? "\u8FDB\u884C\u4E2D" : "\u5DF2\u5B8C\u6210"}</span>
      <button class="sz-ibtn" data-act="toggle-goal" title="${g.status === "active" ? "\u6807\u8BB0\u5B8C\u6210" : "\u91CD\u65B0\u5F00\u542F"}">${ICONS.check}</button>
      <button class="sz-ibtn" data-act="del-goal" title="\u5220\u9664">${ICONS.trash}</button>
    </div>`).join("");
      this.els.body.innerHTML = `
    <div class="sz-add">
      <input class="sz-input" data-role="goal-input" placeholder="\u8F93\u5165\u5DE5\u4F5C\u76EE\u6807\uFF0C\u56DE\u8F66\u6DFB\u52A0" maxlength="80">
      <button class="sz-ibtn" data-act="add-goal" title="\u6DFB\u52A0\u76EE\u6807">${ICONS.plus}</button>
    </div>
    ${rows || '<div class="sz-empty">\u6682\u65E0\u76EE\u6807</div>'}`;
    },
    renderRecords() {
      const recs = Store.read(K.records, []);
      const goals = Store.read(K.goals, []);
      const groups = goals.map((g) => ({
        key: "goal:" + g.id,
        name: g.title,
        color: g.status === "active" ? "#16a34a" : "#9ca3af",
        items: []
      }));
      groups.push(
        { key: "slacking", name: "\u6478\u9C7C", color: "#d97706", items: [] },
        { key: "pending", name: "\u5206\u6790\u4E2D", color: "#6b7280", items: [] },
        { key: "error", name: "\u5206\u6790\u5931\u8D25", color: "#dc2626", items: [] },
        { key: "orphan", name: "\u5DF2\u79FB\u9664\u76EE\u6807", color: "#9ca3af", items: [] }
      );
      for (const r of recs) {
        let g = groups.find((x) => x.key === r.category);
        if (!g) {
          g = groups.find((x) => x.key === (String(r.category).startsWith("goal:") ? "orphan" : "pending"));
        }
        g.items.push(r);
      }
      const activeGoals = goals.filter((g) => g.status === "active");
      const selectHtml = (r) => {
        const known = r.category === "slacking" || activeGoals.some((g) => "goal:" + g.id === r.category);
        const opts = ['<option value="" disabled ' + (known ? "" : "selected") + ">\u79FB\u52A8\u5230\u2026</option>"].concat(activeGoals.map((g) => `<option value="goal:${esc(g.id)}" ${r.category === "goal:" + g.id ? "selected" : ""}>${esc(g.title)}</option>`)).concat([`<option value="slacking" ${r.category === "slacking" ? "selected" : ""}>\u6478\u9C7C</option>`]);
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
        <div class="sz-rmeta">${fmtTime(r.capturedAt)} \xB7 ${esc(r.summary || r.preview || "")}</div>
        ${movable ? selectHtml(r) : ""}
        ${r.category === "error" && r.excerpt ? `<button class="sz-retry" data-act="retry" data-rid="${esc(r.id)}">\u91CD\u8BD5</button>` : ""}
      </div>`;
        }).join("");
      }
      this.els.body.innerHTML = html || '<div class="sz-empty">\u6682\u65E0\u8BB0\u5F55</div>';
    },
    toast(text, kind) {
      if (!this.root) return;
      const t = document.createElement("div");
      t.className = "sz-toast " + (kind || "ok");
      t.textContent = text;
      this.els.toasts.appendChild(t);
      setTimeout(() => t.remove(), 3e3);
    }
  };

  // src/index.ts
  function boot() {
    hookHistory();
    Panel.mount();
    addEventListener("storage", (e) => {
      if (e.key && e.key.indexOf("shizhi.") === 0) Panel.render();
    });
    onLocationChange();
    pumpQueue();
    setInterval(pumpQueue, 1e4);
  }
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
})();
