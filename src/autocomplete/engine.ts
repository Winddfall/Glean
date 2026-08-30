// 提示词自动补全引擎：LLMBridge 版幽灵补全。
// 思路复用 CoBridge 的 ghost completion，但把 Chrome Prompt API 换成 LLMBridge.chat()。
// 参考：CoBridge packages/chrome-extension/src/content/autocomplete/nanoEngine.ts

/** 清理模型输出：去引号、拦掉“助手腔”、按首个标点截断、限制长度。 */
export function cleanOutput(raw: string, maxChars = 15): string {
  let s = String(raw == null ? "" : raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // 宁可不展示，也不要把“助手回答”伪装成用户正在输入的续写。
  if (/^(?:当然|好的|你好|我可以(?:帮|为)|作为(?:一个)?AI|我能(?:帮|为)|很高兴)/.test(s)) {
    return "";
  }
  if (s.length > maxChars) {
    const end = s.search(/[。！？.!?，,]/);
    s = end > 0 ? s.slice(0, end + 1) : s.slice(0, maxChars);
  }
  return s;
}

/**
 * 边界归一化：模型可能重复输出衔接标点，ghost 文本是直接拼接的，
 * 前端必须保证两个片段之间不会出现“。，”“！！”这类重复。
 */
export function normalizeCompletionBoundary(input: string, completion: string): string {
  let result = completion.trimStart();
  const lastChar = input.trimEnd().slice(-1);
  if (/[，。！？；：、,.!?;:]/.test(lastChar)) {
    result = result.replace(/^[，。！？；：、,.!?;:]+\s*/, "");
  }
  return result;
}

function buildPrompt(input: string, profile: string): string {
  const profileLine = profile ? `\n[用户画像]\n${profile}` : "";
  return `你是输入法的幽灵补全（ghost completion），不是聊天助手。你正在替用户继续输入，把要追加的文字直接接在用户已有文本后面。${profileLine}

硬性规则：
1. 只输出要追加的文字，绝不复述已有文本、解释、加引号或加前缀
2. 采用用户的立场和人称继续说话；遇到问题时，续写用户会说的话，而不是回答或帮助用户
3. 绝不以 AI、助手、客服或搜索工具的身份说话；不要出现“我可以帮你”“当然”“好的”“作为 AI”
4. 只补一个自然的短语或一句话的剩余部分，中文最多 15 个字；拿不准就输出空字符串
5. 保持原文的语言、语气、标点和第一人称视角

示例：
已有文本："帮我写一篇"
只输出光标后续写：关于 AI 发展的文章
已有文本："用 Python 实现"
只输出光标后续写：一个快速排序算法
已有文本："Explain"
只输出光标后续写： how machine learning works

已有文本："${input}"
只输出光标后续写：`;
}

export interface CompletionEngineOptions {
  chat?: (prompt: string) => Promise<string>;
  maxChars?: number;
}

export class CompletionEngine {
  private readonly chat: (prompt: string) => Promise<string>;
  private readonly maxChars: number;
  private readonly cache = new Map<string, string>();

  constructor(options: CompletionEngineOptions = {}) {
    this.chat = options.chat ?? defaultChat;
    this.maxChars = options.maxChars ?? 15;
  }

  async complete(input: string, profile = ""): Promise<string> {
    const key = profile + "\u0000" + input;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const raw = await this.chat(buildPrompt(input, profile));
    const completion = cleanOutput(raw, this.maxChars);
    if (completion) this.cache.set(key, completion);
    return completion;
  }
}

function defaultChat(prompt: string): Promise<string> {
  const bridge = window.LLMBridge;
  if (!bridge) throw new Error("未检测到 LLMBridge");
  return bridge.chat(prompt);
}
