// 共享类型定义

export interface Goal {
  id: string;
  title: string;
  status: "active" | "done" | "archived";
  createdAt: number;
  todos: Todo[];
}

export interface Todo {
  id: string;
  text: string;
  contrib: Record<string, number>; // 记录id → 贡献分
  coverage: number;
  status: "open" | "done";
  manual: boolean;
}

export interface BrowseRecord {
  id: string;
  url: string;
  origin: string;
  title: string;
  h1: string;
  meta: string;
  capturedAt: number;
  excerptHash: string;
  preview: string;
  category: string; // "pending" | "goal:{id}" | "slacking" | "error"
  summary: string;
  keywords: string[];
  excerpt?: string; // 分析失败时留存，供重试
}

export interface QueueItem {
  recordId: string;
  excerpt: string;
  retries: number;
  nextAt: number;
}

export interface Settings {
  dwellMs: number;
  settleMs: number;
  queueGapMs: number;
  contentMaxChars: number;
  dedupeWindowMs: number;
  recordCap: number;
  excludedSites: string[];
}

export interface WorkState {
  workMode: boolean;
  activeSince: number;
}

export interface PageData {
  url: string;
  origin: string;
  title: string;
  h1: string;
  meta: string;
  text: string;
}

export interface AnalysisResult {
  relevant: boolean;
  goalId: string | null;
  summary: string;
  keywords: string[];
}

// Tabbit 注入的全局对象
declare global {
  interface Window {
    LLMBridge?: {
      chat(prompt: string, format?: "json" | { response_format: "json" }): Promise<string>;
    };
    __shizhiLoaded?: boolean;
  }
  
  const LLMBridge: Window["LLMBridge"];
}
