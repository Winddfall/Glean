// 存储适配层：同源 localStorage（v1.3 确认无跨源存储 API）

import { K, DEFAULT_SETTINGS } from "./core/constants.js";
import type { Settings, WorkState } from "./types.js";

export const Store = {
  get(k: string): string | null {
    return localStorage.getItem(k);
  },
  set(k: string, v: string): void {
    return localStorage.setItem(k, v);
  },
  del(k: string): void {
    return localStorage.removeItem(k);
  },
  read<T>(k: string, fallback: T): T {
    try {
      const raw = this.get(k);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  write<T>(k: string, v: T): void {
    this.set(k, JSON.stringify(v));
  },
  driverLabel(): string {
    return "localStorage（本站点）";
  },
};

export function settings(): Settings {
  return Object.assign({}, DEFAULT_SETTINGS, Store.read(K.settings, {}));
}

export function getState(): WorkState {
  return Object.assign({ workMode: false, activeSince: 0 }, Store.read(K.state, {}));
}
