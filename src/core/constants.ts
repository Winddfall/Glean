// 存储键与默认配置（纯数据，Node 可测）

import type { Settings } from "../types.js";

export const K = {
  state: "shizhi.state",
  goals: "shizhi.goals",
  records: "shizhi.records",
  queue: "shizhi.queue",
  settings: "shizhi.settings",
  theme: "shizhi.theme",
  themeColor: "shizhi.themeColor",
  profile: "shizhi.profile",
  profileWorkPageCount: "shizhi.profileWorkPageCount",
  recSort: "shizhi.recSort",
  fabPos: "shizhi.fabPos",
  panelSize: "shizhi.panelSize",
} as const;

// DeepSeek Harness（dsh）本地服务：右键「问问 DeepSeek Harness」跳转目标
export const DSH_URL = "http://127.0.0.1:3080";

export const DEFAULT_SETTINGS: Settings = {
  dwellMs: 3000,        // 停留闸：可见且连续停留 >= 3s 才记录
  settleMs: 1500,       // 页面/路由变化后等待渲染的时间
  queueGapMs: 2000,     // 两次 LLM 调用的最小间隔
  contentMaxChars: 3000, // 正文摘录截断
  dedupeWindowMs: 30 * 60 * 1000,
  recordCap: 500,
  excludedSites: [],     // 子串匹配 URL，命中不记录
  linkedUrl: "",         // 关联网址
  analysisPrompt: "",    // 分析提示词（空 = 预设）
  askDsh: true,          // 右键「问问 DeepSeek Harness」默认开启
  dshUrl: DSH_URL,      // DeepSeek Harness 服务地址
};

// 经 URL hash 向 dsh 页面传递选中内容的标记（hash 形如 #sz-dsh-ask=<payload>）
export const DSH_ASK_HASH = "sz-dsh-ask";
