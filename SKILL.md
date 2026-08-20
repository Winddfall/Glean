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
    { "id": "g_xxx", "title": "目标名称", "status": "active", "tasks": [...], "prompt": "..." }
  ],
  "records": {
    "goal:g_xxx": [ { "id": "...", "url": "...", "title": "...", ... } ],
    "slacking": [ ... ],
    "pending": [ ... ],
    "error": [ ... ]
  }
}
```

其中 `records` 按 `category` 分组，category 取值：
- `"goal:{goalId}"` —— 已归档到指定目标
- `"slacking"` —— 摸鱼/无关内容
- `"pending"` —— 分析中
- `"error"` —— 分析失败

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
   - 用 `category` 解析归档路径：
     - `"goal:{goalId}"` → `~/.shizhi/archive/{目标名称}/记录标题_时间戳.md`
     - `"slacking"` → `~/.shizhi/archive/摸鱼/记录标题_时间戳.md`
     - `"pending"` → `~/.shizhi/archive/分析中/记录标题_时间戳.md`（可选）
     - `"error"` → `~/.shizhi/archive/分析失败/记录标题_时间戳.md`（可选）
   - 生成 `.md` 文件（frontmatter + 正文）
4. **统一归档步骤**：
   - 如果本地已存在同名文件夹，直接合并（不覆盖已有文件，同名文件加时间戳后缀）
   - 同步到 SQLite（插入/更新 `records` 表）

**JSON → .md 字段映射**

| JSON 字段 | .md frontmatter / 正文 |
|-----------|----------------------|
| `url` | frontmatter `url` |
| `title` | frontmatter `title` |
| `url` 的域名 | frontmatter `domain` |
| `capturedAt`（毫秒时间戳） | frontmatter `captured_at`，转 ISO 8601 |
| `relevance` | frontmatter `relevance` |
| `category` | frontmatter `category` |
| `keywords` | frontmatter `keywords` |
| `summary` | 正文 `## 摘要` |
| `findings` | 正文 `## 关键发现`（每项一行 `- `） |
| `notes` | 正文 `## 笔记`（每条 `### {topic}` + 内容） |

> **执行约束（必须遵守）**：生成 `.md`、写入磁盘、同步 SQLite 这三件事必须用**一个脚本一次性批量完成**（推荐 Python 标准库 `os`/`json`/`sqlite3`，或 PowerShell 批量），**禁止逐条调用 write 工具**逐文件写入。

### 模式二：生成报告

用户要求"帮我汇总 XX 目标的记录"或"分析一下 摸鱼 里的资料"时：

1. **查询 SQLite**：按 `goal_path` 或 `category` 筛选记录
2. **读取记录内容**：获取每条记录的摘要、发现、笔记
3. **判断证据类型与置信度**：
   - 根据 `domain` 和页面内容判断证据类型
   - 根据内容质量和来源权威性评估置信度
4. **生成结构化报告**：
   - 报告标题和范围说明
   - 按目标/分类分节组织
   - 每节包含：关键发现汇总、证据列表（含来源、置信度、引用）、待进一步确认的问题
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
    content_hash TEXT,                     -- 内容哈希，用于去重
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
2. **置信度透明**：明确标注每条关键信息的置信度等级（高/中/低）及理由。
3. **引用原文**：尽量使用 `.md` 文件中的笔记内容作为直接引用，保持证据链完整。
4. **去重合并**：同一主题下多篇记录的观点相近时，合并表述而非逐一罗列。
5. **指出空白**：如果某个目标下记录过少或质量偏低，应明确指出并建议补充。

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
> Agent：按 category="slacking" 筛选 → 生成报告
