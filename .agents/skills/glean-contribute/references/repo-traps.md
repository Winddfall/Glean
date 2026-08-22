# 拾知仓库陷阱（repo-traps）

agent 开工前必读。这些都是真实存在的坑，踩中会浪费至少一轮 review 或白白浪费时间。

## 测试与构建

- **`npm test` 只跑 `test/smoke.test.js`，不含 `test/core.test.js`。** package.json 的 test 脚本是 `npm run build && node --test test/smoke.test.js`。改完逻辑不要以为 `npm test` 绿了就算测完。
- **`test/core.test.js` 目前跑不起来。** 它用 `require("node:test")`，但项目是 `"type": "module"`，Node 20+ 下直接报 `require is not defined in ES module scope`。不要顺手"修好"它（改测试属于范围外，可单独提）；验证记录里如实写明即可。
- **冒烟测试依赖本机绝对路径的 jsdom。** `test/smoke.test.js` 第 11 行硬编码 `require("/Users/windfall/Developer/gemini-voyager/node_modules/jsdom")`，仓库自己的 node_modules 里没有 jsdom。`npm test` 只在这台机器、且有 gemini-voyager 兄弟项目 checkout 时才能过；换机器或新克隆会失败。同样不要顺手加 jsdom 依赖，除非用户要求。
- **测试跑的是构建产物。** `test/smoke.test.js` 和 `test/core.test.js` 都加载构建出的 `glean.js`，改完源码必须先构建再测。`npm test` 内部会先 build，这一步通常够；但单独 `node --test` 不会。
- **`glean.js` 是 gitignore 产物，永远不要提交。** `npm run build` / `npm run build:min` 会生成或覆盖它。

## Git 与仓库结构

- **主仓库才是基准。** `winddfall/Glean` 是唯一的事实来源（上游）：PR 都合到这里，任何开发前先跟它的 main 同步。在主仓库本人克隆里它通常是 `origin`；在协作者 fork 克隆里应配成 `upstream`。协作者 fork 的 main（本仓库视角下的 `PR-repo` = SkillRatLab/Glean）不是基准——它的提交只有通过 PR 合入主仓库后才有意义，不要拿它当同步源。
- **本地 main 经常落后。** 本地 main 可能落后主仓库 main 几十个提交，甚至带未推送的独有提交。永远先同步再开分支；同步目标是主仓库 main，不要用 `git reset --hard` 丢弃本地独有提交。
- **push 到自己的 fork，PR 回主仓库。** 协作者 push 到自己的 fork（如 SkillRatLab/Glean），再向 `winddfall/Glean` 的 main 发 PR；绝不直接 push 到主仓库（除非本人是主仓库 owner 且这是自己的日常分支）。
- **`.DS_Store` 没被 .gitignore 覆盖。** 根目录和 src/ 下会反复出现 `.DS_Store`，导致 `git status` 一直有 untracked。不要 stage 它，也不要顺手改 .gitignore（可作为建议提出，等用户同意）。
- **提交信息风格。** 仓库历史统一用 Conventional Commits + 中文描述（`feat:`/`fix:`/`docs:`/`refactor:`）。不要用分支名当提交标题，不要提交 "WIP" 草稿。
