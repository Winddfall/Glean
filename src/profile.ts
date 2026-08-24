// 用户画像自动更新：每归档固定数量的工作网页后，基于最近记录归纳画像

import { K } from "./core/constants.js";
import { parseJsonLoose } from "./core/utils.js";
import { Store } from "./store.js";
import type { BrowseRecord, Profile } from "./types.js";

export const PROFILE_UPDATE_EVERY_WORK_PAGES = 5;

export interface ProfileUpdateResult {
  facts: number;
  preferences: number;
}

export function recordWorkPage(): boolean {
  const saved = Store.read<number>(K.profileWorkPageCount, 0);
  const current = Number.isFinite(saved) && saved >= 0 ? Math.floor(saved) : 0;
  const next = current + 1;
  Store.write(K.profileWorkPageCount, next);
  return next % PROFILE_UPDATE_EVERY_WORK_PAGES === 0;
}

export async function updateProfileFromWorkRecords(): Promise<ProfileUpdateResult> {
  const bridge = window.LLMBridge;
  if (!bridge) throw new Error("未检测到 LLMBridge");

  const records = Store.read<BrowseRecord[]>(K.records, [])
    .filter((record) => record.summary && record.category.startsWith("goal:"));
  if (!records.length) throw new Error("暂无已归档的工作记录");

  const sample = records.slice(0, 20).map((record) => record.summary).join("\n---\n");
  const raw = await bridge.chat(
    "根据以下工作网页浏览记录摘要，归纳用户的画像。输出 JSON（不要输出其他内容）：" +
    '{"facts":["关于用户的事实","..."],"preferences":["用户的偏好","..."]}' +
    "规则：facts 和 preferences 各 1-5 条，每条一句话、具体、避免空泛。\n\n" + sample.slice(0, 4000),
    "json"
  );
  const parsed = parseJsonLoose(raw);
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const facts = normalizeProfileItems(obj.facts);
  const preferences = normalizeProfileItems(obj.preferences);
  if (!facts.length && !preferences.length) throw new Error("AI 未产出有效画像");

  const profile = Store.read<Profile>(K.profile, { updatedAt: 0, facts: [], preferences: [] });
  profile.facts = Array.from(new Set([...(profile.facts || []), ...facts])).slice(0, 20);
  profile.preferences = Array.from(new Set([...(profile.preferences || []), ...preferences])).slice(0, 20);
  profile.updatedAt = Date.now();
  Store.write(K.profile, profile);

  return { facts: facts.length, preferences: preferences.length };
}

function normalizeProfileItems(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .slice(0, 8)
    .map((item) => String(item).trim())
    .filter(Boolean);
}
