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

async function bootScenario({ goalTitle, llmResult }) {
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
  const calls = [];
  window.LLMBridge = {
    async chat(prompt) {
      calls.push(prompt);
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
      matches: [{ goalId: "g_py", relevance: 95, reasoning: "页面内容与 Python 学习目标高度相关" }],
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
    assert.ok(body.includes("Python 教程导言"), "摘要显示在记录里");
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
    const toast = s.shadow.querySelector(".sz-toast");
    assert.ok(toast.textContent.includes("已归入摸鱼"));
    assert.ok(toast.className.includes("idle"));
    s.shadow.querySelector('[data-tab="records"]').click();
    assert.ok(s.shadow.querySelector(".sz-body").innerHTML.includes("摸鱼"));
  } finally {
    s.close();
  }
});

test("F1 闸门：工作模式关闭时不产生记录", async () => {
  const dom = new JSDOM(HTML, { url: PAGE_URL, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.document, "visibilityState", { value: "visible", configurable: true });
  window.localStorage.setItem("shizhi.settings", JSON.stringify({ settleMs: 10, dwellMs: 10 }));
  window.localStorage.setItem("shizhi.state", JSON.stringify({ workMode: false }));
  window.localStorage.setItem("shizhi.goals", JSON.stringify([{ id: "g_py", title: "x", status: "active" }]));
  let called = 0;
  window.LLMBridge = { async chat() { called++; return "{}"; } };
  window.eval(SRC);
  await sleep(800);
  try {
    assert.strictEqual(window.localStorage.getItem("shizhi.records"), null, "无记录写入");
    assert.strictEqual(called, 0, "不发起 LLM 调用");
  } finally {
    window.close();
  }
});
