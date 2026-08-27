// 「问问 DeepSeek Harness」：网页选中文字右键送到 dsh 会话输入框
// 传递机制：打开（或复用）名为 shizhi-dsh 的 dsh 标签页，消息经 URL hash 带过去；
// dsh 页面上本脚本同样运行，监听该 hash 并填入其输入框（不自动发送，留给用户确认）。
// dsh 无路径路由（会话是纯客户端状态），因此 hash 导航不会打断当前会话。

import { DSH_URL, DSH_ASK_HASH } from "./core/constants.js";

const MAX_ASK_CHARS = 5000; // hash 传参上限，超长截断
const INPUT_POLL_MS = 300;
const INPUT_WAIT_MAX_MS = 15000;

/** 组装发往 dsh 的消息：指令 + 选中内容（超长截断）+ 来源 */
export function composeDshAsk(sel: string, title: string, url: string): string {
  const body = sel.length > MAX_ASK_CHARS ? sel.slice(0, MAX_ASK_CHARS) + "\n…（内容过长已截断）" : sel;
  return "请分析以下网页选中内容：\n\n" + body + "\n\n（来源：" + title + "\n" + url + "）";
}

/** 打开（或复用）dsh 标签页，把消息通过 URL hash 传过去 */
export function askDsh(message: string, dshUrl: string = DSH_URL): void {
  const payload = encodeURIComponent(JSON.stringify({ text: message, ts: Date.now() }));
  window.open(dshUrl + "#" + DSH_ASK_HASH + "=" + payload, "shizhi-dsh");
}

/**
 * 在任意页面上运行（含 dsh 页面）：监听 hash 中的拾知消息，
 * 等 dsh 输入框渲染后填入。dsh 页面可能没有 LLMBridge，此逻辑独立于面板启动。
 */
export function initDshAskReceiver(): void {
  const tryFill = () => {
    const text = consumeAskHash();
    if (text === null) return;
    waitForDshInput().then((el) => { if (el) fillDshInput(el, text); });
  };
  tryFill();
  addEventListener("hashchange", tryFill);
}

/** 读取并清掉 hash 中的消息；无标记或解析失败返回 null */
function consumeAskHash(): string | null {
  const prefix = "#" + DSH_ASK_HASH + "=";
  if (!location.hash.startsWith(prefix)) return null;
  const raw = location.hash.slice(prefix.length);
  // 立即清掉：避免污染地址栏，也保证下次带新 hash 打开时能触发 hashchange
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const obj = JSON.parse(decodeURIComponent(raw));
    if (obj && typeof obj.text === "string") return obj.text;
  } catch { /* 非法载荷直接丢弃 */ }
  return null;
}

/** dsh 是 SPA，输入框可能尚未渲染，轮询等待 */
function waitForDshInput(): Promise<HTMLTextAreaElement | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = findDshInput();
      if (el) { resolve(el); return; }
      if (Date.now() - started >= INPUT_WAIT_MAX_MS) { resolve(null); return; }
      setTimeout(tick, INPUT_POLL_MS);
    };
    tick();
  });
}

/** dsh 输入框：优先按 placeholder 定位（class 是 CSS Module 哈希，不稳定），兜底第一个 textarea */
function findDshInput(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="描述你想要构建的内容"]')
    || document.querySelector("textarea");
}

/** React 受控 textarea：必须走原型 setter + input 事件才能同步进组件状态 */
function fillDshInput(el: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}
