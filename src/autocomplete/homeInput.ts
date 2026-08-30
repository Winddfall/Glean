// Tabbit 首页（web.tabbit.com/newtab）提示词输入框适配器：
// 选择器、ghost 渲染、事件监听、接受写入、MutationObserver 防 DOM 被悄悄改写。
// 思路复用 CoBridge 的 chatAutocomplete.ts，输入框从 textarea 换成 contenteditable="plaintext-only"。

import { backoffMs, esc } from "../core/utils.js";
import { K } from "../core/constants.js";
import { Store } from "../store.js";
import type { Profile } from "../types.js";
import { CompletionEngine, normalizeCompletionBoundary } from "./engine.js";

// 稳定锚点优先，找不到时降级到更泛化的 contenteditable 选择器，再找不到就静默退出。
const INPUT_SELECTORS = [
  '[data-chip-editor="true"]',
  '[contenteditable="plaintext-only"][role="textbox"]',
] as const;

const MIN_CHARS = 3;
const DEBOUNCE_MS = 600;
const GHOST_CLASS = "shizhi-ghost-text";

function isTabbitHome(): boolean {
  return /(^|\.)tabbit\.com$/i.test(location.hostname);
}

function findEditor(): HTMLElement | null {
  for (const selector of INPUT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.isContentEditable) return el;
  }
  return null;
}

function readEditorText(el: HTMLElement): string {
  return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ").trim();
}

function buildProfileContext(): string {
  const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
  const facts = (profile.facts || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
  const preferences = (profile.preferences || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
  const lines: string[] = [];
  if (facts.length) lines.push("用户事实：" + facts.join("；"));
  if (preferences.length) lines.push("用户偏好：" + preferences.join("；"));
  return lines.join("\n");
}

/** 把补全文本插到 contenteditable 末尾，并走浏览器原生输入链路让 React 受控组件接收。 */
function insertTextAtEnd(el: HTMLElement, text: string): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    // 回退：直接改 textContent + 派发 input，让 React 受控组件接收。
    el.textContent = (el.textContent || "") + text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
}

class HomeInputAutocomplete {
  private readonly engine = new CompletionEngine();
  private inputElement: HTMLElement | null = null;
  private ghostElement: HTMLSpanElement | null = null;
  private currentCompletion = "";
  private ghostInputText = "";
  private debounceTimer: number | null = null;
  private pollTimer: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private generation = 0;
  private inFlight = false;
  private retries = 0;
  private cooldownUntil = 0;
  private pending: { text: string; generation: number } | null = null;

  start(): void {
    const initial = findEditor();
    if (initial) this.setInputElement(initial);
    document.addEventListener("input", this.handleGlobalInput, true);
    this.observeInputDom();
    this.pollTimer = window.setInterval(() => {
      const live = findEditor();
      if (live && live !== this.inputElement) this.setInputElement(live);
    }, 2000);
  }

  private setInputElement(el: HTMLElement): void {
    if (el === this.inputElement) return;
    this.inputElement = el;
    el.addEventListener("keydown", this.handleKeydown);
    el.addEventListener("blur", this.handleBlur);
    el.addEventListener("scroll", this.handleScroll);
    this.setupGhostElement(el);
    console.log("[拾知] Tabbit 首页提示词补全已启用");
  }

  private setupGhostElement(inputEl: HTMLElement): void {
    const parent = inputEl.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    if (!this.ghostElement) {
      this.ghostElement = document.createElement("span");
      this.ghostElement.className = GHOST_CLASS;
      this.ghostElement.setAttribute("aria-hidden", "true");
      this.ghostElement.style.cssText =
        "position:absolute;top:0;left:0;pointer-events:none;color:rgba(148,148,148,.55);" +
        "white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;" +
        "z-index:10;display:none;background:transparent;";
    }
    if (this.ghostElement.parentElement !== parent) {
      parent.appendChild(this.ghostElement);
    }
  }

  private observeInputDom(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = new MutationObserver(() => {
      const live = findEditor();
      if (!live) {
        this.detach();
        return;
      }
      if (live !== this.inputElement) {
        this.setInputElement(live);
        return;
      }
      // 框架可能把 ghost 节点连同父容器一起重建，这里把它重新挂回。
      if (this.ghostElement && !this.ghostElement.isConnected) {
        this.setupGhostElement(live);
        this.hideGhost();
        return;
      }
      // 编辑器仍在、但文本与生成 ghost 时不一致 → 立即失效。
      if (this.ghostInputText && readEditorText(live) !== this.ghostInputText) {
        this.invalidateGhost();
      }
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  private detach(): void {
    this.hideGhost();
    this.clearDebounce();
    this.generation++;
    if (this.ghostElement) {
      this.ghostElement.remove();
      this.ghostElement = null;
    }
    this.inputElement = null;
  }

  private handleGlobalInput = (event: Event): void => {
    const live = findEditor();
    if (!live || !(event.target instanceof Node) || !live.contains(event.target)) return;
    if (live !== this.inputElement) this.setInputElement(live);

    const text = readEditorText(live);
    this.generation++;
    this.hideGhost();
    if (text.length < MIN_CHARS) {
      this.clearDebounce();
      return;
    }
    this.clearDebounce();
    const generation = this.generation;
    this.debounceTimer = window.setTimeout(() => {
      this.requestCompletion(text, generation);
    }, DEBOUNCE_MS);
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Tab" && this.currentCompletion) {
      event.preventDefault();
      this.acceptCompletion();
      return;
    }
    if (event.key === "Escape" || event.key.startsWith("Arrow") || event.key === "Enter") {
      this.hideGhost();
    }
  };

  private handleBlur = (): void => {
    this.hideGhost();
  };

  private handleScroll = (): void => {
    if (!this.ghostElement || !this.inputElement) return;
    this.ghostElement.style.transform = `translate(${-this.inputElement.scrollLeft}px, ${-this.inputElement.scrollTop}px)`;
  };

  private async requestCompletion(text: string, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (this.inFlight) {
      this.pending = { text, generation };
      return;
    }
    if (Date.now() < this.cooldownUntil) return;

    this.inFlight = true;
    try {
      const completion = await this.engine.complete(text, buildProfileContext());
      if (generation !== this.generation || !this.isLiveInput(text)) {
        this.hideGhost();
        return;
      }
      this.retries = 0;
      const normalized = normalizeCompletionBoundary(text, completion);
      if (normalized) this.showGhost(text, normalized);
    } catch {
      this.retries = Math.min(this.retries + 1, 3);
      this.cooldownUntil = Date.now() + backoffMs(this.retries);
    } finally {
      this.inFlight = false;
      const next = this.pending;
      if (next && next.generation === this.generation) {
        this.pending = null;
        this.requestCompletion(next.text, next.generation);
      }
    }
  }

  /** 只信任此刻仍在 DOM 中、且文本未变化的编辑器。 */
  private isLiveInput(expectedText: string): boolean {
    const live = findEditor();
    return !!live && live === this.inputElement && live.isConnected
      && readEditorText(live).length >= MIN_CHARS
      && readEditorText(live) === expectedText;
  }

  private showGhost(inputText: string, completion: string): void {
    if (!this.ghostElement || !this.inputElement || !completion || !this.isLiveInput(inputText)) {
      this.hideGhost();
      return;
    }
    this.currentCompletion = completion;
    this.ghostInputText = inputText;

    const inputEl = this.inputElement;
    const styles = getComputedStyle(inputEl);
    const ghost = this.ghostElement.style;
    const copy = [
      "font-family", "font-size", "font-style", "font-weight", "font-variant", "line-height",
      "letter-spacing", "word-spacing", "text-indent", "text-transform", "text-rendering",
      "font-kerning", "font-feature-settings", "font-optical-sizing", "text-align",
      "white-space", "word-break", "overflow-wrap",
      "padding-top", "padding-right", "padding-bottom", "padding-left",
      "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
      "box-sizing",
    ];
    for (const prop of copy) {
      ghost.setProperty(prop, styles.getPropertyValue(prop));
    }
    ghost.top = inputEl.offsetTop + "px";
    ghost.left = inputEl.offsetLeft + "px";
    ghost.width = inputEl.offsetWidth + "px";
    ghost.height = inputEl.offsetHeight + "px";
    ghost.transform = `translate(${-inputEl.scrollLeft}px, ${-inputEl.scrollTop}px)`;
    ghost.display = "block";
    this.ghostElement.innerHTML = `<span style="color:transparent">${esc(inputText)}</span>${esc(completion)}`;
  }

  private hideGhost(): void {
    if (this.ghostElement) this.ghostElement.style.display = "none";
    this.currentCompletion = "";
    this.ghostInputText = "";
  }

  private invalidateGhost(): void {
    if (!this.ghostInputText) return;
    this.generation++;
    this.hideGhost();
  }

  private acceptCompletion(): void {
    const el = this.inputElement;
    const completion = this.currentCompletion;
    if (!el || !completion) return;
    this.generation++;
    this.hideGhost();
    insertTextAtEnd(el, completion);
  }

  private clearDebounce(): void {
    if (this.debounceTimer != null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

export function initTabbitAutocomplete(): void {
  if (!isTabbitHome()) return;
  new HomeInputAutocomplete().start();
}
