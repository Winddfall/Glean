---
name: shizhi-archive
title: 拾知归档助手
description: "接收用户从拾知浏览器扩展导出的记录（JSON），按目标/摸鱼/分析中/分析失败等分类归档到本地目录，同步到 SQLite 数据库，并在用户要求时汇总指定分类生成深度报告。"
when_to_use: "当用户发送拾知导出的记录文件（shizhi-export*.json）、要求整理/归档浏览器记录、或要求基于已归档记录生成报告时触发。关键词：拾知、归档、整理记录、生成报告、分析记录、JSON、浏览器记录。"
---

# 拾知归档助手

本 Skill 是拾知（Shizhi / Glean）浏览器扩展的配套 Agent 工具。用户在浏览器中收集的网页记录，通过扩展导出为 JSON 文件后，发送给 Agent：

1. **归档**：按 JSON 中的分类结构，将记录放入本地 `~/.shizhi/archive/`
2. **入库**：同步写入 SQLite 数据库，便于后续查询和报告生成
3. **报告**：根据用户指定的目标或分类，读取相关记录并生成结构化深度报告

## 数据路径

| 路径 | 用途 |
|------|------|
| `~/.shizhi/archive/` | 本地归档根目录，按分类文件夹存放 `.md` 记录文件 |
| `~/.shizhi/shizhi.db` | SQLite 数据库，所有记录的索引和结构化字段 |

Windows 下 `~` 解析为 `%USERPROFILE%`。

## JSON 结构预期

拾知扩展导出的 JSON 结构为：

```json
{
  "exportedAt": 1234567890123,
  "goals": [
    {
      "id": "g_xxx",
      "title": "目标名称",
      "status": "active",
      "createdAt": 1234567890123,
      "prompt": "...",
      "tasks": [
        {
          "id": "t_xxx", "title": "任务名称", "prompt": "...",
          "subtasks": [
            { "id": "s_xxx", "title": "子任务名称", "prompt": "..." }
          ]
        }
      ],
      "todos": [
        {
          "id": "todo_xxx", "text": "待办描述", "taskId": "t_xxx",
          "coverage": 0.5, "status": "open", "manual": false,
          "searchTerms": [
            { "display": "展示词", "query": "查询词" }
          ]
        }
      ]
    }
  ],
  "records": {
    "goal:g_xxx": [
      {
        "id": "r_xxx", "url": "https://example.com/page",
        "origin": "https://www.zhihu.com",
        "title": "页面标题", "h1": "H1标题", "meta": "meta描述",
        "capturedAt": 1234567890123, "excerptHash": "abc123",
        "preview": "页面预览文本...", "category": "goal:g_xxx",
        "summary": "摘要内容", "keywords": ["AI"],
        "relevance": 92,
        "findings": ["发现1", "发现2"],
        "notes": [
          { "topic": "主题A", "content": "笔记内容", "relevance": 92 }
        ],
        "matches": [
          {
            "goalId": "g_xxx", "taskId": "t_xxx", "subtaskId": "s_xxx",
            "title": "匹配标题", "relevance": 92, "reasoning": "匹配理由",
            "findings": ["发现1"], "notes": [...],
            "keyQuotes": [
              { "quote": "引用原文", "context": "上下文说明" }
            ]
          }
        ]
      }
    ],
    "slacking": [ ],
    "pending": [ ],
    "error": [ ]
  }
}
```

其中 `records` 按 `category` 分组，category 取值：
- `"goal:{goalId}"` —— 已归档到指定目标
- `"slacking"` —— 摸鱼/无关内容
- `"pending"` —— 分析中
- `"error"` —— 分析失败
- `"other"` —— 未分类/未知分类（fallback）

> **searchTerms 兼容性**：`searchTerms` 可能是字符串数组（旧格式），也可能是 `{display, query}` 对象数组（新格式，v0.2.0+）。处理时需兼容两种格式：字符串项直接用做 `query`，`display` 可省略或与 `query` 相同。
>
> **origin 字段**：JSON 中的 `origin` 为页面来源域名（如 `https://www.zhihu.com`），可直接提取域名部分作为 `domain`，无需从 `url` 解析。

## .md 文件格式示例

```markdown
---
url: "https://example.com/article"
title: "文章标题"
domain: "example.com"
captured_at: "2025-01-15T10:30:00+08:00"
relevance: 85
category: "goal:g_xxx"
keywords: ["AI", "大模型"]
---

## 摘要
这是页面摘要...

## 关键发现
- 发现1
- 发现2

## 笔记
### 主题A
笔记内容...
```

## 工作流程

### 模式一：接收 JSON 并归档

1. **解析 JSON**：读取顶层 `goals`（数组）和 `records`（按 category 分组的对象）
2. **建立 id→标题 映射**：`goalId → goal.title`
3. **遍历 `records` 的每个分类**，对每条记录：
   - 用 `category` 解析归档路径（文件夹名和文件名必须做安全处理）：
     - `"goal:{goalId}"` → `~/.shizhi/archive/{目标名称}/记录标题_时间戳.md`
     - `"slacking"` → `~/.shizhi/archive/摸鱼/记录标题_时间戳.md`
     - `"pending"` → `~/.shizhi/archive/分析中/记录标题_时间戳.md`（可选）
     - `"error"` → `~/.shizhi/archive/分析失败/记录标题_时间戳.md`（可选）
     - `"other"` → `~/.shizhi/archive/未分类/记录标题_时间戳.md`
   - **路径安全**：`goal.title` 和 `record.title` 来自用户输入的 JSON，视为不可信。拼路径前必须：
     1. 剔除 `..`、绝对路径前缀、控制字符、Windows 保留名（CON、PRN 等）
     2. 将剩余非法字符（`\/:*?"<>|` 及空字符）替换为 `_`
     3. 解析最终路径，确认其在 `~/.shizhi/archive/` 根目录内；若逃逸则拒绝写入并记录警告
   - 生成 `.md` 文件（frontmatter + 正文）
4. **统一归档步骤**：
   - 如果本地已存在同名文件夹，直接合并（不覆盖已有文件，同名文件加时间戳后缀）
   - 同步到 SQLite（插入/更新 `records` 表，详见下方 upsert 策略）
5. **归档目标元数据**（可选但推荐）：
   - 对每个 goal，生成 `{目标名}/_meta.md`，保存 goal 的完整结构：
     - `prompt`（研究目标描述）
     - `tasks` 列表（含 subtasks 层级）
     - `todos` 列表（含 `coverage` 进度、`status`、`searchTerms`）
   - 此文件帮助用户后续回顾研究框架和待办进度，不写入 SQLite（仅作本地文档索引）

**JSON → .md 字段映射**

| JSON 字段 | .md frontmatter / 正文 |
|-----------|----------------------|
| `url` | frontmatter `url` |
| `title` | frontmatter `title` |
| `origin`（来源域名，如 `https://www.zhihu.com`） | frontmatter `domain`（提取域名部分，如 `zhihu.com`） |
| `capturedAt`（毫秒时间戳） | frontmatter `captured_at`，转 ISO 8601 |
| `relevance` | frontmatter `relevance` |
| `category` | frontmatter `category` |
| `keywords` | frontmatter `keywords` |
| `h1` | frontmatter `h1`（页面主标题，可能与 `title` 不同） |
| `meta` | 正文 `## Meta 描述`（页面 meta description 原文） |
| `excerptHash` | frontmatter `excerpt_hash`（用于内容去重标识） |
| `preview` | 正文 `## 预览`（截取前 300 字符；超长 preview 与 `summary` 重复度高，截断可避免 .md 文件臃肿） |
| `summary` | 正文 `## 摘要` |
| `findings` | 正文 `## 关键发现`（每项一行 `- `） |
| `notes` | 正文 `## 笔记`（每条 `### {topic}`，内容含 `relevance` 分数） |
| `matches` | 正文 `## 分类匹配`（见下方详细规则） |

**`matches` 写入规则**：
每个匹配一节，标题格式为 `### {目标名}/{任务名}/{子任务名}`（为 null 的层级省略），并注明 `goalId`/`taskId`/`subtaskId`。节内保留：`title`（匹配标题）、`relevance`（匹配相关度）、`reasoning`（匹配理由）、`findings`（匹配发现）、`notes`（匹配笔记，格式同顶层 notes）、`keyQuotes`（关键引用，每条含 `quote` 原文和 `context` 上下文）。

**`content_hash` 生成规则**：
JSON 导出数据不包含 `content_hash`，需由 Agent 自行生成。推荐算法：`hashlib.md5(f"{url}|{excerptHash}|{capturedAt}".encode()).hexdigest()`，即对 `url + "|" + excerptHash + "|" + str(capturedAt)` 取 MD5。若 `excerptHash` 不存在，退化为 `url|capturedAt`。此哈希保证同一页面同一时刻的导出幂等（重复导入视为同一条记录）。

**增量导入 upsert 策略**：
同一页面可能在不同导出批次中发生变化（如首次导出时 `category` 为 `pending`，再次导出时已分析完成变为 `goal:g_xxx`）。归档时需：
1. 按 `content_hash` 查重。不存在则 `INSERT`（新记录）
2. 存在则对比关键字段：`category`、`excerptHash`、`summary`、`findings`、`relevance`
3. 任一关键字段有变化 → `UPDATE` 更新该记录的 SQLite 行和 `.md` 文件（重写文件）
4. 无变化 → 跳过，避免无意义的磁盘写入

> 注意：`.md` 文件路径可能因 `category` 变化而改变（如从 `分析中/` 移到 `目标名称/`），更新时需同时处理旧路径文件删除/移动。

> **YAML frontmatter 安全编码**：frontmatter 的值（尤其是 `title`、`url`、`summary`）可能含引号、换行符、冒号等 YAML 特殊字符。生成 frontmatter 时必须使用安全标量格式：
> - 字符串值统一用双引号包裹，内部双引号转义为 `\"`，换行符转义为 `\n`
> - 或使用 YAML 块标量 `|` 格式包裹多行内容
> - 数组（`keywords`）使用 JSON 格式 `["a", "b"]` 插入，避免 YAML 流式数组解析歧义

> **执行约束（必须遵守）**：生成 `.md`、写入磁盘、同步 SQLite 这三件事必须用**一个脚本一次性批量完成**（推荐 Python 标准库 `os`/`json`/`sqlite3`，或 PowerShell 批量），**禁止逐条调用 write 工具**逐文件写入。

### 模式二：生成报告

用户要求"帮我汇总 XX 目标的记录"或"分析一下 摸鱼 里的资料"时：

1. **查询 SQLite**：
   - **主记录**：按 `goal_path` 筛选记录（目标记录为目标文件夹名，分类记录为 摸鱼/分析中/分析失败）
   - **关联记录**：读取各记录的 `.md` 正文 `## 分类匹配` 节，筛选 `matches` 中 `goalId` 匹配当前汇总目标、且 `relevance ≥ 60` 的记录。这类记录虽归档在其他目标下，但对该目标有参考价值，应在报告中标注为"跨目标关联"
2. **读取记录内容**：获取每条记录的摘要、发现、笔记
3. **判断证据类型与置信度**：
   - 根据 `domain` 和页面内容判断证据类型
   - 根据内容质量和来源权威性评估置信度
4. **生成结构化报告**：
   - 报告标题和范围说明（含主记录数 + 关联记录数）
   - 按目标/分类分节组织
   - 每节包含：关键发现汇总、证据列表（含来源、置信度、引用，关联记录需标注来源目标）、待进一步确认的问题
   - 结论和建议

## SQLite Schema

Agent 使用 Python + sqlite3 操作数据库，无需额外安装。

```sql
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,        -- ~/.shizhi/archive/ 下的相对路径
    url TEXT,
    title TEXT,
    domain TEXT,                           -- 来源域名，用于判断证据类型
    goal_path TEXT,                        -- 目标文件夹名称或分类名（摸鱼/分析中/分析失败）
    captured_at TEXT,                      -- ISO 8601
    relevance INTEGER,                     -- 0-100
    summary TEXT,
    findings TEXT,                         -- JSON array
    notes TEXT,                            -- JSON array
    keywords TEXT,                         -- JSON array
    source_type TEXT,                      -- 证据类型推断值
    credibility_score INTEGER,             -- 0-100，Agent 评估
    credibility_reasoning TEXT,            -- 置信度评估理由
    content_hash TEXT UNIQUE,              -- 内容哈希，用于去重和幂等导入（重复哈希视为同一条记录）
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_records_goal ON records(goal_path);
CREATE INDEX IF NOT EXISTS idx_records_domain ON records(domain);
CREATE INDEX IF NOT EXISTS idx_records_captured ON records(captured_at);
```

## 证据类型判断规则

Agent 根据 `domain` 和页面内容判断每条记录的证据类型：

| 来源特征 | 证据类型 | 典型置信度 |
|---------|---------|----------|
| cnki.net, arxiv.org, ieee.org, aclanthology.org, nature.com | 学术论文 | 高（80-95） |
| github.com | 开源项目/代码 | 中-高（60-85） |
| zhihu.com, juejin.cn, csdn.net, medium.com | 技术博客/社区 | 中（40-70） |
| taobao.com, jd.com, amazon.com | 商品页 | 低-中（20-50） |
| weibo.com, twitter.com, x.com | 社交媒体 | 低（10-40） |
| 政府域名 (.gov.cn, .gov) | 官方信息 | 高（75-95） |
| 企业官网 / 产品文档 | 官方说明 | 中-高（50-80） |
| 新闻门户 (36kr, sina, bbc) | 新闻报道 | 中（40-65） |
| 未知/其他 | 一般网页 | 视内容质量而定 |

> **注意**：上述置信度是默认值，Agent 应根据实际内容质量、发表时间、作者权威性等进行调整。

## 报告生成规范

### 报告结构

```markdown
# {目标/分类名称} 汇总报告

> 生成时间：{时间}
> 数据来源：{记录数量} 条，来自 {域名列表}
> 证据类型分布：{统计}

## 一、核心发现

### 1.1 {主题/关键词A}
- **关键信息**：...
- **支撑证据**：
  - [高置信度] {来源域名}：《{标题}》— {简要引用}
  - [中置信度] {来源域名}：《{标题}》— {简要引用}

### 1.2 {主题/关键词B}
...

## 二、证据总览

| 序号 | 来源 | 类型 | 置信度 | 相关度 | 核心要点 |
|-----|------|------|-------|-------|---------|
| 1 | example.com | 博客 | 65 | 85 | ... |

## 三、待确认/待补充

- 问题1：...
- 建议补充的信息源：...

## 四、结论与建议

...
```

### 报告原则

1. **按目标判断用法**：同一篇记录在不同目标下可能有不同的价值。Agent 应根据当前汇总的目标/分类来判断每条记录的核心价值。
2. **标题展示优先用 `h1`**：`title` 常含平台前缀（如 `"(1 封私信) 为什么... - 知乎"`），而 `h1` 是干净的页面主标题。生成报告和引用记录时，优先以 `h1` 作为展示标题，`title` 作为备选（`h1` 不存在或为空时使用 `title`）。
3. **置信度透明**：明确标注每条关键信息的置信度等级（高/中/低）及理由。
4. **引用原文**：尽量使用 `.md` 文件中的笔记内容作为直接引用，保持证据链完整。
5. **去重合并**：同一主题下多篇记录的观点相近时，合并表述而非逐一罗列。
6. **指出空白**：如果某个目标下记录过少或质量偏低，应明确指出并建议补充。

## 环境要求

- Python 3.x（用于 SQLite 和文件操作）
- PowerShell 7+ 或 Python（用于文件操作）
- 无需额外 pip 包（sqlite3、os、json 均为标准库）

## 用户交互示例

**归档场景**
> 用户："这是我的拾知记录包，帮我归档一下"
> 用户发送文件：`~/Downloads/shizhi-export.json`
>
> Agent：解析 JSON → 遍历 goals 和 records → 按目标/摸鱼等分类归档到 `~/.shizhi/archive/` → 写入 SQLite → 汇报："已归档 15 条记录，涉及 3 个目标。其中「AI灵感收集」目标下有 7 条记录，「摸鱼」下有 2 条..."

**报告场景**
> 用户："帮我汇总一下 AI灵感收集 这个目标的记录"
>
> Agent：查询 SQLite → 读取 7 条记录 → 判断证据类型和置信度 → 生成结构化报告

**指定分类**
> 用户："分析一下 摸鱼 里的资料"
>
> Agent：按 goal_path="摸鱼" 筛选 → 生成报告

**非 goal 分类查询**
> 用户："帮我看看分析失败里有什么"
>
> Agent：按 goal_path="分析失败" 筛选 → 读取错误记录 → 汇总失败原因（如域名解析失败、内容提取超时等）→ 给出排查建议或建议重新分析哪些页面
