// 端到端冒烟：jsdom 加载真实示例页面 HTML + mock LLMBridge，跑通 F1 全链路
// 运行：npm test（先构建，再执行）
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, "fixtures", "lxf-python-intro.html"), "utf8");
const SRC = fs.readFileSync(path.join(__dirname, "..", "glean.js"), "utf8");
const PAGE_URL = "https://liaoxuefeng.com/books/python/introduction/index.html";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootScenario({ goalTitle, llmResult, profileWorkPageCount = 0, profileResult }) {
  const dom = new JSDOM(HTML, {
    url: PAGE_URL,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  // 加速定时器 + 预置工作模式与目标
  window.localStorage.setItem("shizhi.settings", JSON.stringify({ settleMs: 10, dwellMs: 10, queueGapMs: 10 }));
  window.localStorage.setItem("shizhi.state", JSON.stringify({ workMode: true, activeSince: Date.now() }));
  window.localStorage.setItem("shizhi.goals", JSON.stringify([
    { id: "g_py", title: goalTitle, status: "active", createdAt: Date.now(), todos: [] },
  ]));
  if (profileWorkPageCount > 0) {
    window.localStorage.setItem("shizhi.profileWorkPageCount", JSON.stringify(profileWorkPageCount));
  }
  const calls = [];
  window.LLMBridge = {
    async chat(prompt) {
      calls.push(prompt);
      if (prompt.includes("归纳用户的画像")) return JSON.stringify(profileResult || { facts: [], preferences: [] });
      return JSON.stringify(llmResult);
    },
  };
  window.eval(SRC);
  await sleep(1500); // settle 10ms + dwell 10ms + 队列 + 间隔 10ms，留足余量
  const shadow = document.getElementById("shizhi-host")?.shadowRoot;
  const records = JSON.parse(window.localStorage.getItem("shizhi.records") || "[]");
  const queue = JSON.parse(window.localStorage.getItem("shizhi.queue") || "[]");
  const close = () => window.close();
  return { window, document, shadow, records, queue, calls, close };
}

test("F1 归档路径：相关网页自动记录并归档至目标", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    llmResult: {
      relevant: true,
      goalId: "g_py",
      summary: "Python 教程导言，介绍语言定位与特点",
      keywords: ["Python", "编程"],
      matches: [{ goalId: "g_py", relevance: 95, reasoning: "页面内容与 Python 学习目标高度相关", findings: ["关键发现测试"] }],
    },
  });
  try {
    // 抓取：恰好一条记录，标题/URL 正确
    assert.strictEqual(s.records.length, 1, "应产生 1 条记录");
    const rec = s.records[0];
    assert.ok(rec.title.includes("Python"), "记录标题来自页面");
    assert.strictEqual(rec.url, PAGE_URL);
    // 单次合并调用：恰好 1 次，prompt 含目标与正文、不含侧栏导航文本
    assert.strictEqual(s.calls.length, 1, "一页一调用");
    const prompt = s.calls[0];
    assert.ok(prompt.includes("g_py"), "prompt 含目标 id");
    assert.ok(prompt.includes("Python是一种计算机程序设计语言"), "正文摘录取到主内容");
    assert.ok(!prompt.includes("TCP/IP简介"), "正文摘录不含侧边导航");
    // 归档：category 落到目标、摘要入库、队列清空
    assert.strictEqual(rec.category, "goal:g_py");
    assert.strictEqual(rec.summary, "Python 教程导言，介绍语言定位与特点");
    assert.strictEqual(s.queue.length, 0, "队列消费完毕");
    // 面板：toast 提示归档、记录 Tab 分组渲染
    assert.ok(s.shadow, "Shadow DOM 已挂载");
    const toast = s.shadow.querySelector(".sz-toast");
    assert.ok(toast, "出现 toast");
    assert.ok(toast.textContent.includes("已归档至：学习 Python 编程"));
    s.shadow.querySelector('[data-tab="records"]').click();
    const body = s.shadow.querySelector(".sz-body").innerHTML;
    assert.ok(body.includes("学习 Python 编程"), "记录按目标分组");
    assert.ok(!body.includes("Python 教程导言"), "摘要不再显示在记录里");
    assert.ok(s.shadow.querySelector(".sz-rtitle")?.textContent?.includes("Python"), "记录标题仍显示");
    s.shadow.querySelector(".sz-expand").click();
    assert.ok(s.shadow.querySelector(".sz-body").innerHTML.includes("💡 关键发现"), "展开后显示关键发现");
    assert.ok(s.shadow.querySelector(".sz-body").innerHTML.includes("关键发现测试"), "展开后显示匹配到该分类的发现");
    s.shadow.querySelector('[data-tab="profile"]').click();
    const emptyProfile = s.shadow.querySelector(".sz-profile-empty");
    assert.ok(emptyProfile, "没有画像条目时显示画像功能说明");
    assert.ok(emptyProfile.textContent.includes("还没有用户画像"));
    assert.ok(emptyProfile.textContent.includes("每浏览 5 个工作网页，画像会自动更新"));
  } finally {
    s.close();
  }
});

test("画像自动更新：每第 5 个工作网页触发并移除手动生成按钮", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    profileWorkPageCount: 4,
    llmResult: {
      relevant: true,
      goalId: "g_py",
      summary: "Python 教程导言，介绍语言定位与特点",
      keywords: ["Python", "编程"],
      matches: [{ goalId: "g_py", relevance: 95, reasoning: "与学习目标相关", findings: [] }],
    },
    profileResult: {
      facts: ["正在学习 Python 编程"],
      preferences: ["偏好通过教程系统学习"],
    },
  });
  try {
    assert.strictEqual(s.calls.length, 2, "第 5 个工作网页应额外调用一次 AI 更新画像");
    assert.ok(s.calls[1].includes("工作网页浏览记录摘要"), "第二次调用使用工作记录生成画像");
    assert.strictEqual(JSON.parse(s.window.localStorage.getItem("shizhi.profileWorkPageCount")), 5);
    const profile = JSON.parse(s.window.localStorage.getItem("shizhi.profile") || "{}");
    assert.deepStrictEqual(profile.facts, ["正在学习 Python 编程"]);
    assert.deepStrictEqual(profile.preferences, ["偏好通过教程系统学习"]);

    s.shadow.querySelector('[data-tab="profile"]').click();
    assert.strictEqual(s.shadow.querySelector(".sz-profile-empty"), null, "已有画像时隐藏空状态说明");
    assert.strictEqual(s.shadow.querySelector('[data-act="ai-profile"]'), null, "画像页不再显示手动 AI 生成按钮");
    assert.ok(!s.shadow.querySelector(".sz-body").textContent.includes("根据记录 AI 生成"));
  } finally {
    s.close();
  }
});

test("F1 摸鱼路径：无关网页归入摸鱼分类", async () => {
  const s = await bootScenario({
    goalTitle: "调研竞品定价策略",
    llmResult: { relevant: false, goalId: null, summary: "Python 教程导言", keywords: [], matches: [] },
  });
  try {
    assert.strictEqual(s.records.length, 1);
    assert.strictEqual(s.records[0].category, "slacking");
    assert.strictEqual(s.window.localStorage.getItem("shizhi.profileWorkPageCount"), null, "摸鱼网页不计入画像更新阈值");
    const toast = s.shadow.querySelector(".sz-toast");
    assert.ok(toast.textContent.includes("已归入摸鱼"));
    assert.ok(toast.className.includes("idle"));
    s.shadow.querySelector('[data-tab="records"]').click();
    assert.ok(s.shadow.querySelector(".sz-body").innerHTML.includes("摸鱼"));
  } finally {
    s.close();
  }
});

test("模式切换：摸鱼模式仅显示摸鱼目标与记录", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    llmResult: {
      relevant: true,
      goalId: "g_py",
      summary: "Python 教程导言",
      keywords: ["Python"],
      matches: [{ goalId: "g_py", relevance: 95, reasoning: "与学习目标相关", findings: [] }],
    },
  });
  try {
    const records = JSON.parse(s.window.localStorage.getItem("shizhi.records") || "[]");
    records.push({
      id: "slacking-record",
      url: "https://example.com/fun",
      origin: "example.com",
      title: "摸鱼内容",
      h1: "",
      meta: "",
      capturedAt: Date.now(),
      excerptHash: "slacking",
      preview: "",
      category: "slacking",
      summary: "休闲内容",
      keywords: [],
    });
    s.window.localStorage.setItem("shizhi.records", JSON.stringify(records));

    s.shadow.querySelector('[data-act="panel-mode"][data-mode="slacking"]').click();
    let body = s.shadow.querySelector(".sz-body").textContent;
    assert.ok(body.includes("摸鱼"), "目标页保留摸鱼入口");
    assert.ok(!body.includes("学习 Python 编程"), "目标页隐藏普通目标");
    const state = JSON.parse(s.window.localStorage.getItem("shizhi.state"));
    assert.strictEqual(state.panelMode, "slacking", "持久化摸鱼模式");
    assert.strictEqual(state.workMode, true, "模式切换不关闭网页采集");

    s.shadow.querySelector('[data-tab="records"]').click();
    body = s.shadow.querySelector(".sz-body").textContent;
    assert.ok(body.includes("摸鱼内容"), "记录页显示摸鱼记录");
    assert.ok(!body.includes("学习 Python 编程"), "记录页隐藏普通目标分组");
    assert.ok(!body.includes("Python 教程导言"), "记录页隐藏目标记录");
  } finally {
    s.close();
  }
});

test("模式迁移：旧关闭状态映射为摸鱼模式并继续记录", async () => {
  const dom = new JSDOM(HTML, { url: PAGE_URL, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.document, "visibilityState", { value: "visible", configurable: true });
  window.localStorage.setItem("shizhi.settings", JSON.stringify({ settleMs: 10, dwellMs: 10 }));
  window.localStorage.setItem("shizhi.state", JSON.stringify({ workMode: false }));
  window.localStorage.setItem("shizhi.goals", JSON.stringify([{ id: "g_py", title: "x", status: "active" }]));
  let called = 0;
  window.LLMBridge = { async chat() { called++; return JSON.stringify({ relevant: false, goalId: null, summary: "摸鱼内容", keywords: [], matches: [] }); } };
  window.eval(SRC);
  await sleep(1500);
  try {
    const records = JSON.parse(window.localStorage.getItem("shizhi.records") || "[]");
    assert.strictEqual(records[0]?.category, "slacking", "旧关闭状态继续采集并归入摸鱼");
    assert.strictEqual(called, 1, "继续发起页面分析");
    const shadow = window.document.getElementById("shizhi-host")?.shadowRoot;
    assert.ok(shadow.querySelector('[data-mode="slacking"]').classList.contains("act"), "旧关闭状态显示为摸鱼模式");
  } finally {
    window.close();
  }
});

test("主题色：调色盘统一更新强调色与悬停色并持久化", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    llmResult: { relevant: false, goalId: null, summary: "摸鱼内容", keywords: [], matches: [] },
  });
  try {
    const paletteButton = s.shadow.querySelector('[data-act="theme-color"]');
    const palette = s.shadow.querySelector('[data-role="theme-color-pop"]');
    assert.ok(paletteButton && palette, "右上角显示主题色入口");
    paletteButton.click();
    assert.ok(palette.classList.contains("open"), "点击后展开调色盘");
    s.shadow.querySelector('[data-act="set-theme-color"][data-color="#3b82f6"]').click();
    assert.strictEqual(JSON.parse(s.window.localStorage.getItem("shizhi.themeColor")), "#3b82f6");
    const dock = s.shadow.querySelector(".sz-dock");
    assert.strictEqual(dock.style.getPropertyValue("--accent"), "#3b82f6");
    assert.strictEqual(dock.style.getPropertyValue("--bg-hover"), "#eff6ff");
    assert.strictEqual(s.shadow.querySelector('[data-role="theme-color-hex"]').textContent, "#3B82F6");
    s.shadow.querySelector('[data-act="theme-color"]').click();
    s.shadow.querySelector('[data-act="reset-theme-color"]').click();
    assert.strictEqual(JSON.parse(s.window.localStorage.getItem("shizhi.themeColor")), "#5f8f55");
  } finally {
    s.close();
  }
});

test("存储空间：仅统计拾知同源数据，可设置软上限并查看完整明细", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    llmResult: { relevant: false, goalId: null, summary: "Python 教程导言", keywords: [], matches: [] },
  });
  try {
    s.window.localStorage.setItem("host-site-token", "x".repeat(2 * 1024 * 1024));
    s.window.localStorage.setItem("shizhi.futureData", JSON.stringify({ future: true }));
    s.shadow.querySelector('[data-tab="settings"]').click();

    const card = s.shadow.querySelector(".sz-storage-card");
    assert.ok(card, "设置页显示存储空间概览卡");
    assert.strictEqual(s.shadow.querySelectorAll(".sz-setting-card").length, 3, "设置页其余区块全部使用统一卡片容器");
    assert.ok(card.textContent.includes("当前源数据"));
    assert.ok(card.textContent.includes("25 MB"), "默认软上限为 25 MB");
    assert.ok(!card.textContent.includes("2.0 MB"), "宿主网站自己的 localStorage 不计入拾知用量");

    const tabBar = s.shadow.querySelector(".sz-tabs");
    assert.strictEqual(tabBar.hidden, false, "设置页正常显示顶部标签栏");
    card.querySelector('[data-act="storage-manage"]').click();
    const manager = s.shadow.querySelector(".sz-storage-manager");
    assert.ok(manager, "可进入存储管理视图");
    assert.strictEqual(tabBar.hidden, true, "进入存储明细后隐藏顶部标签栏");
    for (const label of ["目标", "记录", "画像"]) {
      assert.ok(manager.textContent.includes(label), `明细包含${label}`);
    }
    for (const label of ["7 个维度", "分析队列", "设置", "界面状态", "其他拾知数据"]) {
      assert.ok(!manager.textContent.includes(label), `明细不显示${label}`);
    }

    manager.querySelector('[data-act="storage-limit"][data-value="50"]').click();
    assert.strictEqual(s.window.localStorage.getItem("shizhi.storageSoftCapMb"), "50");
    assert.ok(s.shadow.querySelector(".sz-storage-manager").textContent.includes("50 MB"));

    s.shadow.querySelector('[data-act="storage-close"]').click();
    assert.strictEqual(tabBar.hidden, false, "关闭存储明细后恢复顶部标签栏");
    s.shadow.querySelector('[data-act="storage-manage"]').click();

    s.shadow.querySelector('[data-act="storage-category"][data-category="records"]').click();
    assert.ok(s.shadow.querySelector('[data-tab="records"]').classList.contains("act"), "记录明细可跳转到记录管理");
  } finally {
    s.close();
  }
});

test("右键「问问 DeepSeek Harness」：选中内容经 URL hash 送往 dsh 输入框", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    llmResult: { relevant: false, goalId: null, summary: "Python 教程导言", keywords: [], matches: [] },
  });
  try {
    // 1. 页面选中文字后右键，菜单出现第三项「问问 DeepSeek Harness」
    const hostBody = s.document.body;
    const para = hostBody.querySelector("h1, h2, p") || hostBody;
    const range = s.document.createRange();
    range.selectNodeContents(para);
    const selection = s.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const menuEvt = new s.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    s.document.dispatchEvent(menuEvt);
    const menu = s.shadow.querySelector('[data-role="ctxmenu"]');
    assert.ok(menu.classList.contains("open"), "右键后弹出菜单");
    const dshBtn = menu.querySelector('[data-act="ask-dsh"]');
    assert.ok(dshBtn, "菜单包含「问问 DeepSeek Harness」项");

    // 2. 点击后经 window.open 打开 dsh 并带 hash 载荷
    let opened = null;
    s.window.open = (url, name) => { opened = { url, name }; return null; };
    dshBtn.click();
    assert.ok(opened, "调用了 window.open");
    assert.strictEqual(opened.name, "shizhi-dsh", "复用固定标签页名");
    assert.ok(opened.url.startsWith("http://127.0.0.1:3080/#sz-dsh-ask="), "URL 指向 dsh 且带标记 hash");
    const payload = JSON.parse(decodeURIComponent(opened.url.split("#sz-dsh-ask=")[1]));
    assert.ok(typeof payload.text === "string" && payload.text.length > 0, "载荷含指令+选中内容");
    assert.ok(payload.text.includes("请分析以下网页选中内容"), "消息包含指令模板");
    assert.ok(payload.text.includes("https://liaoxuefeng.com"), "消息包含来源链接");
  } finally {
    s.close();
  }
});

test("dsh 接收器：hash 中的消息被填入输入框且 hash 清理干净", async () => {
  const s = await bootScenario({
    goalTitle: "学习 Python 编程",
    llmResult: { relevant: false, goalId: null, summary: "Python 教程导言", keywords: [], matches: [] },
  });
  try {
    // 模拟 dsh 页面：放入一个 React 受控 textarea + 带 hash 的地址
    const ta = s.document.createElement("textarea");
    ta.placeholder = "描述你想要构建的内容";
    s.document.body.appendChild(ta);
    const message = "请分析以下网页选中内容：\n\n测试段落\n\n（来源：测试页\nhttps://example.com）";
    const hash = "#sz-dsh-ask=" + encodeURIComponent(JSON.stringify({ text: message, ts: Date.now() }));
    // jsdom 允许直接改 hash 并派发 hashchange
    s.window.location.hash = hash;
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(ta.value, message, "消息被完整填入 textarea");
    assert.ok(!s.window.location.hash.includes("sz-dsh-ask"), "hash 已被清理");

    // 非法载荷不应抛错也不应填入
    s.window.location.hash = "#sz-dsh-ask=not-json";
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(ta.value, message, "非法载荷不覆盖已有内容");
    assert.ok(!s.window.location.hash.includes("sz-dsh-ask"), "非法载荷的 hash 同样被清理");
  } finally {
    s.close();
  }
});
