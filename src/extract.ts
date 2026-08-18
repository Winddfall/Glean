// 正文提取：通用算法 = 清理克隆 → 语义容器候选 → 文本密度（链接惩罚）兜底

import { truncate } from "./core/utils.js";
import { settings } from "./store.js";
import type { PageData } from "./types.js";

export function extractPage(): PageData {
  const title = document.title || "";
  const h1 = ((document.querySelector("h1") || {}).textContent || "").trim();
  const metaEl = document.querySelector('meta[name="description"]');
  const meta = (metaEl?.getAttribute("content") || "").trim();
  const text = extractMainText();
  return { url: location.href, origin: location.origin, title, h1, meta, text };
}

function extractMainText(): string {
  const max = settings().contentMaxChars;
  const clone = document.body.cloneNode(true) as Element;
  clone.querySelectorAll(
    'script,style,noscript,iframe,svg,form,button,select,textarea,input,nav,aside,header,footer,[aria-hidden="true"],[class*="comment"],[id*="comment"],[class*="sidebar"],[id*="sidebar"]'
  ).forEach((el) => el.remove());
  const norm = (s: string | null | undefined): string => truncate(
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
    d.querySelectorAll("a").forEach((a) => { lt += (a.textContent || "").length; });
    const score = t.length - lt * 1.5;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return norm(best.textContent);
}
