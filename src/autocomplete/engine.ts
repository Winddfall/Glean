// 提示词自动补全引擎：LLMBridge 版幽灵补全。
// 思路复用 CoBridge 的 ghost completion，但把 Chrome Prompt API 换成 LLMBridge.chat()。
// 参考：CoBridge packages/chrome-extension/src/content/autocomplete/nanoEngine.ts

/** 清理模型输出：去引号、拦掉“助手腔”、按句末标点截断、限制长度。 */
export function cleanOutput(raw: string, maxChars = 24): string {
  let s = String(raw == null ? "" : raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // 宁可不展示，也不要把“助手回答”伪装成用户正在输入的续写。
  if (/^(?:当然|好的|你好|我可以(?:帮|为)|作为(?:一个)?AI|我能(?:帮|为)|很高兴)/.test(s)) {
    return "";
  }
  if (s.length > maxChars) {
    const end = s.search(/[。！？.!?]/);
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
  return `你是用户正在使用的“提问续写器”，不是回答问题的聊天助手。你的任务是站在用户一侧，预测用户接下来想怎样提问或提出请求，把最自然、最有帮助的后半句直接接在已有文本后面。输出必须像用户本人正在输入的内容，体现明确的提问者语气。${profileLine}

硬性规则：
1. 只输出要追加的文字，绝不复述已有文本、解释规则、加引号、加标题或加“答案：”等前缀
2. 把已有文本当作用户输入的开头：理解用户真正想问的对象、目的和上下文，再补出自然的后半句；不要机械补词
3. 始终以提问者/请求者的立场继续说话：可以自然使用“怎么、为什么、能否、请解释、帮我比较、有哪些”等表达，但不要替用户回答、总结结论或假装已经完成任务
4. 如果已有文本已经包含问题开头，就补充缺失的对象、条件或关注点，让问题更具体；不要凭空编造事实、数字、立场或用户没有提到的限制
5. 保持原文的语言、语气、标点和人称；中文优先使用自然口语，英文保持自然的提问或请求表达
6. 只补一个短而完整的片段，中文通常不超过 24 个字；优先提供有信息量的续写，不要为了凑长度扩写；拿不准就输出空字符串
7. 如果这次补全让整句话自然结束，必须补上句末标点，不能为了简短而省略：疑问句用“？”，陈述句或请求句用“。”，感叹语气用“！”；英文分别使用 “?”, “.”, “!”
8. 绝不以 AI、助手、客服或搜索工具身份说话；不要出现“当然”“好的”“作为 AI”“我可以帮你”等助手腔

示例：
已有文本：“帮我写一篇”
只输出光标后续写：关于 AI 发展的文章，并说明未来趋势。
已有文本：“为什么我的代码”
只输出光标后续写：运行速度这么慢？
已有文本：“比较一下 React 和 Vue”
只输出光标后续写：在大型项目中的优缺点？
已有文本：“我想了解量子计算，应该”
只输出光标后续写：从哪些基础概念开始？
已有文本：“Explain”
只输出光标后续写： how machine learning works

已有文本：“${input}”
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
    this.maxChars = options.maxChars ?? 24;
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
