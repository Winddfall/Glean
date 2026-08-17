// Core 纯函数单测：node --test test/
const test = require("node:test");
const assert = require("node:assert");
const { Core } = require("../拾知.js");

test("fnv1a 稳定且为 base36 字符串", () => {
  assert.strictEqual(Core.fnv1a("https://example.com|正文"), Core.fnv1a("https://example.com|正文"));
  assert.notStrictEqual(Core.fnv1a("a"), Core.fnv1a("b"));
  assert.match(Core.fnv1a("x"), /^[0-9a-z]+$/);
});

test("truncate 截断与空值", () => {
  assert.strictEqual(Core.truncate("abcdef", 3), "abc");
  assert.strictEqual(Core.truncate("abc", 10), "abc");
  assert.strictEqual(Core.truncate(null, 5), "");
});

test("parseJsonLoose 各种容错", () => {
  assert.deepStrictEqual(Core.parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(Core.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepStrictEqual(Core.parseJsonLoose('前面的话 {"a":1} 后面的话'), { a: 1 });
  assert.deepStrictEqual(Core.parseJsonLoose({ a: 2 }), { a: 2 }); // 对象直传
  assert.throws(() => Core.parseJsonLoose("不是JSON"));
});

test("validateAnalysis 归一化", () => {
  const goals = [{ id: "g1", title: "学Python" }, { id: "g2", title: "调研竞品" }];
  // 正常相关
  assert.deepStrictEqual(
    Core.validateAnalysis({ relevant: true, goalId: "g1", summary: "s", keywords: ["k"] }, goals),
    { relevant: true, goalId: "g1", summary: "s", keywords: ["k"] }
  );
  // 无关 → 摸鱼
  const off = Core.validateAnalysis({ relevant: false, goalId: null, summary: "s" }, goals);
  assert.strictEqual(off.relevant, false);
  assert.strictEqual(off.goalId, null);
  // 幻觉 goalId（不在目标列表）→ 降级为摸鱼
  const ghost = Core.validateAnalysis({ relevant: true, goalId: "g999", summary: "s" }, goals);
  assert.strictEqual(ghost.relevant, false);
  assert.strictEqual(ghost.goalId, null);
  // keywords 非数组容错、summary 截断
  const messy = Core.validateAnalysis({ relevant: "true", goalId: "g2", summary: "x".repeat(300), keywords: "nope" }, goals);
  assert.strictEqual(messy.summary.length, 200);
  assert.deepStrictEqual(messy.keywords, []);
  // 非对象抛错（走队列退避）
  assert.throws(() => Core.validateAnalysis([1, 2], goals));
});

test("backoffMs 退避序列", () => {
  assert.strictEqual(Core.backoffMs(1), 5000);
  assert.strictEqual(Core.backoffMs(2), 15000);
  assert.strictEqual(Core.backoffMs(3), 60000);
  assert.strictEqual(Core.backoffMs(99), 60000);
});

test("buildPagePrompt 结构", () => {
  const goals = [{ id: "g1", title: "学Python" }];
  const p = Core.buildPagePrompt(
    { url: "https://liaoxuefeng.com/books/python/introduction/index.html", title: "简介 - Python教程", h1: "简介", meta: "m", excerpt: "Python是一种计算机程序设计语言……" },
    goals
  );
  assert.ok(p.includes("g1"), "包含目标 id");
  assert.ok(p.includes("学Python"), "包含目标标题");
  assert.ok(p.includes("正文摘录"), "包含摘录段");
  assert.ok(p.includes('"relevant"'), "包含输出契约");
  assert.ok(p.includes("goalId 只能"), "包含约束规则");
});

test("esc 防注入", () => {
  assert.strictEqual(Core.esc('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});
