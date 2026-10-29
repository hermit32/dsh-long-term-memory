# dsh-plugin-session-cascade-delete（本地修改版）

> **安装前必读：本目录是本地修改版，不能用 npm 包名安装。**
> 在 DSH 插件管理器里输入 `@liuyu-f/dsh-plugin-session-cascade-delete`，或执行
> `dsh plugin --profile <profile> add @liuyu-f/dsh-plugin-session-cascade-delete`，
> 装到的是**上游未修改版**：没有 `session_delete` 的工作区隔离，也不会广播
> `session-delete/deleted` 事件。本仓库的安装方式见「安装（本地修改版）」。

[![license](https://img.shields.io/npm/l/@liuyu-f/dsh-plugin-session-cascade-delete)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)

> **适配 DeepSeek Harness `V0.2.0-rc.2` 到 `0.2.1-rc.2`。** 槽位名、服务签名会随版本变化，其他版本请自行核对。

---

> **本目录是本地修改版 `1.0.6-local.1`，不是上游发布包。**
> 上游：`@liuyu-f/dsh-plugin-session-cascade-delete` 1.0.6（MIT，
> Copyright (c) 2026 liuyu-f，基于 lsz-asd 的 `@huanlin/dsh-plugin-session-delete`）。
>
> 本地修改（相对上游 1.0.6）：
>
> 1. **模型工具按工作区隔离**：`session_delete` 的 `discover` / 标题解析 / 删除 /
>    `discoverTree` 只允许调用方根会话所属工作区；子代理沿 `origin=subagent` 父链
>    解析，fork 分支按自身归属处理；删除前重读注册表再次校验；无法证明归属时拒绝。
>    认证过的 UI 删除路由仍是全局用户管理面，行为不变。
> 2. **删除事件**：删除成功后广播 `session-delete/deleted {sessionId, at}`，供记忆
>    插件清理 pending/owned 状态（不会删除长期记忆条目）。
> 3. 新增 `src/workspace-scope.js` 与 `test/workspace-scope.test.js`、
>    `test/session-tool-scope.test.js`。
> 4. 版本号由 `1.0.6-<private>.1` 改为 `1.0.6-local.1`（匿名化）。
>
> 兼容性：上游声明 DSH 0.2.0-rc.2 ~ 0.2.1-rc.2；本修改版只在 **DSH 0.2.1-rc.3**
> 上跑过单元测试（14/14 通过），**没有做过完整安装后的端到端验收**。
>
> 删除按钮/菜单/`session_delete` 工具本身是上游已有能力，不是本项目自研；
> 本项目只增加了工作区隔离、删除事件和对应测试。

简单实用的会话删除工具，在 DeepSeek Harness 中彻底删除会话及其相关数据。

会话头部有一个垃圾桶按钮，侧栏会话行的 "..." 菜单中有一项「删除会话」。确认后会删除该会话的日志目录、投影缓存、工作区记账，以及**它拥有的子代理会话**；运行中的会话会先停止并释放。删除完成后，该会话立即从界面和会话列表消失，无需重启。适用于 Web 界面及一切基于 Web 外壳的客户端。

同时提供 agent 工具 `session_delete`。

![侧栏菜单里的「删除会话」](https://raw.githubusercontent.com/liuyu-f/dsh-plugin-session-cascade-delete/main/docs/manual-menu.png)
![删除确认弹窗](https://raw.githubusercontent.com/liuyu-f/dsh-plugin-session-cascade-delete/main/docs/manual-confirm.png)

## 安装（本地修改版）

> 不要执行 `dsh plugin add @liuyu-f/dsh-plugin-session-cascade-delete`：那是上游原版，
> 不含本目录的安全修复。插件管理器的“添加插件”输入包名同样会装上游版。

1. 把本目录放到一个稳定位置（不要放进任何工作区内部），例如
   `C:\Workspaces\plugins\dsh-plugin-session-cascade-delete`。
2. 在 profile 的 `package.json` 增加 link 依赖，并把包名加入 `bundles`：

   ```json
   {
     "dependencies": {
       "@liuyu-f/dsh-plugin-session-cascade-delete": "link:C:/Workspaces/plugins/dsh-plugin-session-cascade-delete"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "@liuyu-f/dsh-plugin-session-cascade-delete"
         ]
       }
     }
   }
   ```

3. 重启 DSH。
4. 验证装的是本地版，而不是上游版：

   - `package.json` 的 `version` 应为 `1.0.6-local.1`；
   - 目录里应存在 `src/workspace-scope.js`；
   - 若版本是 `1.0.6` 且没有该文件，说明装到了上游版，请按上面的 link 方式重装。

> 兼容性：本修改版只在 **DSH 0.2.1-rc.3** 上跑过单元测试（14/14 通过），
> **没有做完整安装后的端到端验收**；上游声明的 0.2.0-rc.2 ~ 0.2.1-rc.2 未逐一验证。

## 怎么用

| 入口       | 位置                            |
| ---------- | ------------------------------- |
| 头部垃圾桶 | 会话标题旁的动作区              |
| 菜单项     | 侧栏会话行 "..." → 「删除会话」 |
| agent 工具 | `session_delete`（参数见下）    |

侧栏菜单项与确认弹窗（截图为深色主题）：

**删掉一个父会话时，它拥有的子代理会话会被一并删除**（最深者先删）。

- **会话正在运行时**：先停止任务、释放运行中的 Agent 和会话，再删除；删除后立即从界面与会话列表移除。
- **分叉会话（fork）是独立的**：删掉一个分叉不会连带删除任何东西，也不会牵连子代理。
- **子代理归属"创建它的那个会话"**（DSH 机制）：若先在 A 会话里创建了子代理、再从 A 分叉出 B，那么**删除 B 对子代理没有影响，删除 A 才会删除它们**。分叉只复制对话上下文，不接管子代理的归属。

## agent 工具

agent 也能删除会话，并在结果里报告实际删掉了什么：

| 参数            | 作用                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`     | 直接指定要删的会话 id（推荐）                                                                                                      |
| `title`         | 只知道标题时用；**只有在标题唯一时才会删**，否则报错并列出候选                                                                     |
| `discover`      | 只列出本 profile 知道的会话，不删任何东西；当前会话在标题后标 `> (当前会话)`                                                       |
| `discoverTree`  | **只列出某一个会话拥有的子代理树**（id、深度、父级），不删任何东西。删除前不需要用它——删除本身就会级联，结果里会报告实际删掉了什么 |
| `keepSubagents` | 只删这一个会话，保留它的子代理会话（默认是连子会话一起删）                                                                         |

两条安全约束：

- **拒绝删除本次调用所在的会话**（工具结果必须写进那个日志），并拒绝删除"其树中包含本次调用所在会话"的会话。
- 注意区分：被拒绝的是"**本次工具调用所在的会话**"，不是"你界面上正打开着的会话"——后者可以正常删除。

## 配置（可选）

写在 profile 的 `cordis.patch.yml` 里（本插件不导出 `Config` schema，故设置页没有表单）：

```yaml
- id: session-delete
  name: "@liuyu-f/dsh-plugin-session-cascade-delete"
  config:
    deleteSubagents: false # 默认 true：删父会话时连子代理会话一起删
    sessionsRoot: "" # 可选：覆盖会话日志根目录，默认 $DSH_HOME/sessions
```

## 删掉了什么

一次删除会先停止并释放运行中的 Agent 与会话，再清理：会话日志目录 → 投影缓存（缓存行与磁盘文档）→ 工作区记账（所属工作区成员、归档、置顶）→ 子代理会话（由深到浅）→ 通知界面立即移除对应的行。删除后不需要重启 DSH。

任何一步没做成，都不会静默：结果报告里会有一条 `INCOMPLETE`，列出是哪一步、什么原因。**日志确认删净之后才会动记账**，所以不会出现"删一半、会话掉进未分组"的坏行。

## 更新与卸载

本插件以 `link:` 形式安装，更新时替换目录内容并重启 DSH 即可。

```sh
# 卸载（本地 link 形态）
dsh plugin --profile desktop remove @liuyu-f/dsh-plugin-session-cascade-delete
```

卸载后从 profile 的 `package.json` 删除对应 `dependencies` 与 `bundles` 行。

> **不要**用 `dsh plugin add <包名>` 更新：它会装回上游原版，覆盖掉本地的
> 工作区隔离与删除事件修复。

## 关于这个插件

`@huanlin/dsh-plugin-session-delete`（[上游仓库](https://github.com/lsz-asd/dsh-plugin-session-delete)）的新 DSH 适配版，改动与增强围绕子代理：级联删除、分支保护、活会话删除、会话 id 两种拼写的处理。维护者文档见 [DEVELOPMENT.md](https://github.com/liuyu-f/dsh-plugin-session-cascade-delete/blob/main/DEVELOPMENT.md)。

## 版本

| 版本  | 变更                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.6-local.1 | 模型工具 `session_delete` 按调用方根会话的工作区隔离：`discover`/标题解析/删除均只允许当前工作区；删除前重读注册表校验归属，跨工作区拒绝；认证 UI 路由仍保留全局用户管理。删除成功后广播 `session-delete/deleted` 供记忆插件清理 pending/owned。 |
| 1.0.5 | 删除运行中的会话时先释放 Agent 与会话（停止、注销、从会话存储移除），再清理日志与缓存；删除后界面与 `discover` 立即不再列出，无需重启。适配 DSH 0.2.1-rc.2                |
| 1.0.4 | 文档简化：`DEVELOPMENT.md` 移除发布流程与旧版更新日志，README 去掉钉版本说明；投稿收录清单 [PR #6699](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6699) |
| 1.0.3 | `discover` 列出会话时，当前会话的标记从行首移到标题之后（`标题 > (当前会话)`）：标题才是读者比对的字段，行首的标记跨行容易看错                                            |
| 1.0.2 | 删除当前打开的会话后清空主视图，不再新建会话。此前复用 `startSession()`（新建会话流程），每次删除都可能留下一个内存中的 `(untitled)` 会话，重启才消失                     |
| 1.0.1 | `discoverTree` 不再被描述成删除前的必要步骤。此前 agent 会先预览级联范围再删除，实际删除本身即级联、结果也会报告删除了什么，预览只在调用方明确要求时才需要                |
| 1.0.0 | 首个版本：界面删除入口（会话头部 + 侧栏菜单）、`session_delete` 工具、子代理级联删除、分支会话保护、运行中会话先停止                                                      |
