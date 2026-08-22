---
name: shizhi-contribute
description: 全流程陪同协作者完成拾知（shizhi）仓库的版本管理与贡献：以主仓库 winddfall/Glean 为上游，先同步最新代码、创建主题分支、开发、验证（typecheck/测试/构建）、提交、rebase、解决冲突、推送到自己的 fork、向主仓库发 PR。当协作者需要同步主仓库、创建分支、提交推送、rebase、解决冲突，或不确定贡献是否已就绪时使用。尤其适合不熟悉 git 的协作者——由 agent 把版本管理做得井井有条。
---

# 拾知贡献流程

agent 以"版本管理管家"身份全程陪同协作者完成贡献：每个 git 写操作前，先用一句大白话向用户说明"现在在做什么、为什么"；遇到意外（冲突、分支分叉、测试失败）先停下解释再继续；绝不让仓库处于半完成状态，绝不静默丢失任何工作。本流程尤其适用于不熟悉 git 的协作者。

## 仓库拓扑（先搞清楚这一节）

- **主仓库 = `winddfall/Glean`，是唯一的事实来源（上游）。** 所有 PR 都合到这里；每次开发前，本地 main 必须先跟主仓库的 main 同步。若本地尚未配置指向主仓库的 remote，先添加（见第 1 节第 2 步），不要跳过同步直接开工。
- **协作者各自 fork 一个仓库**，最终 push 到自己的 fork，再从 fork 向主仓库的 main 发 PR。例如 `SkillRatLab/Glean` 就是一个协作者 fork（在本仓库里被命名为 `PR-repo`）。
- 站在不同克隆里 remote 名字不同，以 `git remote -v` 的 URL 为准，不要凭名字猜：主仓库本人克隆里主仓库通常是 `origin`；协作者 fork 克隆里主仓库通常叫 `upstream`、自己的 fork 是 `origin`。

涉及 LLMBridge 调用逻辑时，先读 `llm-bridge-chat-guidance` skill，然后回到本 skill 完成贡献流程。

## 陪同原则（agent 必须遵守）

- 每次执行 git 写操作前，用一句大白话告诉用户"现在在做什么、为什么"。
- 永不 `git reset --hard` / `git clean` 丢弃未提交或已提交但未推送的工作；确需丢弃前先备份或征求明确同意。
- 永不 force-push，除非用户明确同意。
- 只在主题分支上开发，绝不直接往主仓库的 main 提交或推送。
- 冲突和分支分叉是正常流程，不是错误；停下来，解释双方差异，选最稳妥的方案，而不是随手选一边。
- 每一步做完后，`git status --short --branch` 都应处于可解释的状态。

## 1. 出发前检查（Preflight）

1. `git status --short --branch`：确认当前分支和工作区状态。与任务无关的未提交改动（如 `.DS_Store`、其他半成品）**不要动**，在汇报中如实披露。
2. `git remote -v`：确认哪个 remote 指向主仓库 `winddfall/Glean`（下文记作 `<main-remote>`），哪个指向自己的 fork。协作者若还没把主仓库配成 remote，先添加：`git remote add upstream git@github.com:winddfall/Glean.git`（remote 名字随意）。
3. 明确任务：要做什么、涉及哪些文件、目标分支（默认走单一主题分支，目标是主仓库 `main`）。
4. `git fetch --all`：拉取所有 remote，重点是主仓库。
5. 读 [repo-traps.md](references/repo-traps.md)，避开会浪费 review 轮次的仓库特定坑。

出发前检查完成的标准：当前分支与工作区状态清楚、主仓库和自己的 fork 都已识别并 fetch、无关工作被保留。

## 2. 同步主仓库 main 并创建分支（Sync & branch）

1. 切到 main：`git checkout main`。
2. 把本地 main 同步到主仓库最新：
   - 只落后、无独有提交：`git pull --ff-only <main-remote> main`（快进，不产生合并提交）。
   - 有未推送的独有提交（已分叉）：**不要丢弃**。直接从当前 main 开分支，让这些提交随分支带走，之后在分支上 rebase 到 `<main-remote>/main`（见第 4 节）。若这些独有提交是废弃实验，先问用户再处理。
   - 协作者 fork 自己的 main 不是基准：不要拿它当同步源，它只有合入主仓库后才有意义。
3. 从最新 main 创建单一主题分支（`git switch -c <分支名>`），并遵守分支命名规则：
   - **格式** `<type>/<简述>`，type 与提交信息保持一致：
      - feat: - 新功能
      - fix: - 错误修复
      - docs: - 文档更改
      - chore: - 维护任务
      - refactor: - 代码重构
      - test: - 添加或更新测试
   - **名字要有信息量**：一眼能看出改什么，避免 `test`、`dev`、`fix1`、纯日期或序号这类无信息量的名字；
   - **一个任务一个分支，一个分支只做一个任务**：做一半要换任务时，先提交或保存当前进度，再开新分支；
   - **只从主仓库最新 main 开分支**：不要从旧分支或其他 fork 的分支上再开，也不要复用已合并/已删除的旧分支名；
   - 分支最终 PR 回主仓库 `main`，分支本身不直接合入其他分支；不要在 main 上直接开发。

## 3. 开发与验证（Develop & verify）

1. 按 AGENTS.md 的 Four Checks 开发：先说明意图，做最小且聚焦的改动，不顺手重构无关代码。
2. 验证命令（按顺序）：

   ```bash
   npm run typecheck   # tsc --noEmit，类型检查
   npm test            # 先 npm run build 再跑 node --test test/smoke.test.js
   npm run build       # 生成/刷新 glean.js 产物（已被 gitignore，不提交）
   git diff --check    # 检查空白错误
   git status --short
   ```

3. 注意：`npm test` 只跑 `test/smoke.test.js`；`test/core.test.js` 目前在 ESM 项目里因 `require` 无法直接运行（见 repo-traps），不要假装它能过。
4. 每一条没跑或跑不了的命令都要记下原因（如缺 gemini-voyager 的 jsdom），如实说明，不假装通过。

验证完成的标准：每条适用的检查都有真实结果，工作区与"被测快照"一致，没跑的项目都有明确理由。

## 4. 提交、rebase 与推送（Commit, rebase & push）

1. `git status` + `git diff` 复查最终改动，只暂存任务相关路径。**绝不暂存 `.DS_Store` 或 `glean.js`。**
2. 提交信息用 Conventional Commits + 中文描述（仓库历史风格）：`feat: 支持...`、`fix: 修复...`、`docs: ...`、`refactor: ...`。标题简洁，不要把分支名当标题，不提交 "WIP" 草稿。Codex 代写的提交保留协作署名：
   ```text
   Co-authored-by: Codex <codex@users.noreply.github.com>
   ```
3. `git show --stat --format=fuller HEAD` + `git status --short` 检查提交内容。任务相关路径应无残留暂存/未暂存改动；无关的既有工作保留并如实披露。
4. **推送前先 rebase 到主仓库最新**：`git fetch <main-remote>` 后 `git rebase <main-remote>/main`，把分支提交挪到主仓库最新代码之上，避免 PR 冲突。
5. 冲突处理：
   - `git status` 查看冲突文件，逐个打开，理解两边各是什么，保留本任务的意图；两边都有价值时两边都保留。
   - 逐个 `git add <文件>` 标记已解决，然后 `git rebase --continue`。
   - 绝不盲目选一边；搞不定就 `git rebase --abort` 停下来向用户解释。
6. **推送到自己的仓库**：`git push -u <自己的-remote> <分支名>`。协作者推到自己的 fork；主仓库 owner 的日常分支可以推主仓库。**绝不直接往别人的仓库推。** 若分支已推送过又 rebase，需要 force-push 时先征求用户明确同意。
7. **开 PR 回主仓库**：目标仓库是 `winddfall/Glean` 的 `main`，head 是协作者自己 fork 上的分支。`gh` 可用且已登录就用 `gh pr create --repo winddfall/Glean`，否则给出网页创建链接。不要往别处开 PR。

提交推送完成的标准：聚焦改动在主题分支上，已 rebase 到主仓库最新且无冲突，PR 准确说明改动内容与验证情况，用户拿到 PR 链接。

## 5. 收尾汇报（Handoff）

用大白话汇报：做了什么、改了哪些文件、跑了哪些验证（哪些没跑、为什么）、PR 链接、还需要谁做什么（review、补测等）。任何未完成的环节要明确列出，不要含糊带过。
