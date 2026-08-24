// 拾知同源存储统计：只读取当前页面 origin 的 localStorage。

import { K } from "./core/constants.js";

export const STORAGE_SOFT_CAP_OPTIONS_MB = [25, 50, 100] as const;
export const DEFAULT_STORAGE_SOFT_CAP_MB = 25;
export const STORAGE_SOFT_CAP_KEY = "shizhi.storageSoftCapMb";
export const STORAGE_QUOTA_WARNING_RATIO = 0.8;
export const STORAGE_QUOTA_CRITICAL_RATIO = 0.95;

export type StorageSoftCapMb = (typeof STORAGE_SOFT_CAP_OPTIONS_MB)[number];
export type StorageCategoryId = "goals" | "records" | "profile" | "queue" | "settings" | "ui" | "other";

export interface StorageCategoryUsage {
  id: StorageCategoryId;
  bytesInUse: number;
  keys: readonly string[];
  clearable: boolean;
}

export interface StorageQuotaSnapshot {
  measuredAt: number;
  origin: string;
  bytesInUse: number;
  softCapMb: StorageSoftCapMb;
  softCapBytes: number;
  usageRatio: number;
  categories: readonly StorageCategoryUsage[];
}

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CATEGORY_KEYS: Record<Exclude<StorageCategoryId, "other">, readonly string[]> = {
  goals: [K.goals],
  records: [K.records],
  profile: [K.profile, K.profileWorkPageCount],
  queue: [K.queue],
  settings: [K.settings, K.state, STORAGE_SOFT_CAP_KEY],
  ui: [K.theme, K.recSort, K.fabPos, K.panelSize],
};

const CATEGORY_META: Record<StorageCategoryId, { clearable: boolean }> = {
  goals: { clearable: false },
  records: { clearable: false },
  profile: { clearable: false },
  queue: { clearable: true },
  settings: { clearable: false },
  ui: { clearable: false },
  other: { clearable: false },
};

function bytesFor(key: string, value: string | null): number {
  if (value == null) return 0;
  try {
    return new TextEncoder().encode(key + value).byteLength;
  } catch {
    // TextEncoder is available in supported browsers; this keeps old WebViews usable.
    return (key.length + value.length) * 2;
  }
}

function normalizeSoftCap(value: unknown): StorageSoftCapMb {
  const parsed = typeof value === "string" ? Number(value) : value;
  return STORAGE_SOFT_CAP_OPTIONS_MB.includes(parsed as StorageSoftCapMb)
    ? parsed as StorageSoftCapMb
    : DEFAULT_STORAGE_SOFT_CAP_MB;
}

function getKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith("shizhi.")) keys.push(key);
  }
  return keys;
}

export function getStorageQuotaSnapshot(
  storage: StorageLike = localStorage,
  origin = typeof location === "undefined" ? "当前源" : location.origin,
): StorageQuotaSnapshot {
  const keys = getKeys(storage);
  const known = new Set(Object.values(CATEGORY_KEYS).flat());
  const categories: StorageCategoryUsage[] = (Object.keys(CATEGORY_KEYS) as Array<Exclude<StorageCategoryId, "other">>).map((id) => {
    const categoryKeys = keys.filter((key) => CATEGORY_KEYS[id].includes(key));
    return {
      id,
      bytesInUse: categoryKeys.reduce((sum, key) => sum + bytesFor(key, storage.getItem(key)), 0),
      keys: categoryKeys,
      clearable: CATEGORY_META[id].clearable,
    } satisfies StorageCategoryUsage;
  });
  const otherKeys = keys.filter((key) => !known.has(key));
  categories.push({
    id: "other",
    bytesInUse: otherKeys.reduce((sum, key) => sum + bytesFor(key, storage.getItem(key)), 0),
    keys: otherKeys,
    clearable: false,
  });

  const bytesInUse = keys.reduce((sum, key) => sum + bytesFor(key, storage.getItem(key)), 0);
  const rawCap = storage.getItem(STORAGE_SOFT_CAP_KEY);
  const softCapMb = normalizeSoftCap(rawCap);
  const softCapBytes = softCapMb * 1024 * 1024;
  return {
    measuredAt: Date.now(),
    origin,
    bytesInUse,
    softCapMb,
    softCapBytes,
    usageRatio: Math.max(0, bytesInUse / softCapBytes),
    categories,
  };
}

export function saveStorageSoftCapMb(
  value: StorageSoftCapMb,
  storage: StorageLike = localStorage,
): void {
  if (!STORAGE_SOFT_CAP_OPTIONS_MB.includes(value)) throw new RangeError("存储软上限只能设置为 25、50 或 100 MB");
  storage.setItem(STORAGE_SOFT_CAP_KEY, String(value));
}

export function formatStorageBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${Math.round(safe)} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(safe < 10 * 1024 ? 1 : 0)} KB`;
  if (safe < 1024 * 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(safe < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(safe / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function storageQuotaStatus(ratio: number): "normal" | "warning" | "critical" {
  if (ratio >= STORAGE_QUOTA_CRITICAL_RATIO) return "critical";
  if (ratio >= STORAGE_QUOTA_WARNING_RATIO) return "warning";
  return "normal";
}
