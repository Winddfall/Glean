// 共享类型定义

export interface Goal {
  id: string;
  title: string;
  status: "active" | "done" | "archived";
  createdAt: number;
  prompt?: string;          // 目标级分类提示词
  tasks?: Task[];           // 二级：任务
  todos: Todo[];
}

export interface Task {
  id: string;
  title: string;
  prompt?: string;          // 任务级提示词
  searchTerms?: string[];   // 搜索词推荐
  subtasks?: Subtask[];     // 三级：子任务
}

export interface Subtask {
  id: string;
  title: string;
  prompt?: string;
}

export interface Todo {
  id: string;
  text: string;
  contrib: Record<string, number>; // 记录id → 贡献分
  coverage: number;
  status: "open" | "done";
  manual: boolean;
  searchTerms?: string[];          // 搜索词推荐
}

export interface NoteEntry {
  topic: string;
  content: string;
  relevance: number; // 0-100
}

export interface KeyQuote {
  quote: string;
  context: string;
}

export interface MatchEntry {
  goalId: string;
  taskId: string | null;
  subtaskId: string | null;
  title?: string; // AI 针对该分类生成的标题（替代原始网页标题）
  relevance: number; // 0-100
  reasoning: string;
  findings: string[];
  notes: NoteEntry[];
  keyQuotes: KeyQuote[];
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
  relevance?: number; // 0-100，LLM 分析产出
  findings?: string[]; // 关键发现
  notes?: NoteEntry[]; // 提取笔记
  matches?: MatchEntry[]; // 多分类结果（goal/task/subtask 各自分析）
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
  linkedUrl: string;          // 当前关联网址（搜索跳转目标）
  analysisPrompt: string;     // 记录分析提示词（空 = 用预设）
}

export interface Profile {
  updatedAt: number;
  facts: string[];
  preferences: string[];
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
  goalId: string | null; // 主分类（relevance 最高）
  summary: string;
  keywords: string[];
  relevance: number; // 0-100 主分类相关度
  findings: string[]; // 主分类关键发现（兼容现有渲染）
  notes: NoteEntry[]; // 主分类笔记（兼容现有渲染）
  matches: MatchEntry[]; // 完整多分类结果
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
