# dsh-memory-scoped — 私人工作区长期记忆插件

> 本包是 **`dsh-memory` 的受控分支**，不是上游发布包。上游为 `haitang1/dsh-memory`
> v0.5.0（commit `15de1c7`，MIT）。为公开发布，包名、模块名和默认值已做匿名化处理；
> 行为逻辑保留真实实现。改动清单见 `FORK-NOTES.md`。

## 它做什么

给 **一个指定工作区** 提供长期记忆：

- 每次提示词注入一份有界的记忆摘要（`systemPrompt.context`，order 2000）。
- 提供 14 个 `memory_*` 工具，供模型读写记忆。
- 按会话累计 **有效回合**（真实用户消息 + 助手答复），达到阈值后由后台模型
  （curator）整理成长期条目。
- 定期做 consolidation，把 raw 条目和 rollout 摘要蒸馏成注入摘要。
- 记录条目来源（provenance）、curator 运行日志、摘要历史版本，支持回滚。
- 提供一个需要认证的记忆控制台（DSH 设置 → “私人工作区记忆”）。

记忆只对 `privateWorkspace` 精确匹配的 **根会话** 开放。其他工作区拿不到注入，
也看不到工具。

## 环境要求

- DSH **0.2.1-rc.3**（本包实际运行与单测环境）。上游声明的 peer 范围更宽，但
  DSH 处于 pre-1.0，跨小版本存在破坏性变更，换版本请自行验证。
- Node.js **>= 20.3**（实测 24.x）。
- 零运行时第三方依赖，只用 Node 内置模块；`@deepseek-ai/*` 全部是 peerDependency。

## 安装

1. 把本目录放到任意稳定位置，例如
   `C:\Workspaces\plugins\dsh-memory-scoped`。
2. 在 profile 的 `package.json` 里用 link 依赖指向它：

   ```json
   {
     "dependencies": {
       "dsh-memory-scoped": "link:C:/Workspaces/plugins/dsh-memory-scoped"
     },
     "dsh": {
       "profile": {
         "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-memory-scoped"]
       }
     }
   }
   ```

3. 在 profile 的 `cordis.patch.yml` 里写入策略行（见
   `../../examples/config.example.yml`）。**必须**设置 `privateWorkspace`；
   留空等于禁用记忆。
4. 重启 DSH。`<memoryDir>/diagnostics.json` 会记录工具注册、curator 计数和错误。

## 配置（关键字段）

| 键 | 代码默认 | 本方案示例 | 作用 |
| --- | --- | --- | --- |
| `privateWorkspace` | `''`（禁用） | `C:\Workspaces\private` | 唯一允许使用记忆的工作区绝对路径。**安全边界**。 |
| `memoryDir` | `$DSH_HOME/memories` | `<workspace>\.dsh\memories-scoped` | 记忆数据目录。 |
| `scopedMemory` | `false` | `true` | 必须为 `true`，记忆才会落到工作区作用域而不是全局。 |
| `readOnlyScopes` | `[]` | `['global']` | 只读作用域（例如 `global`）。 |
| `seedFromAgentsMd` | `true` | `false` | 是否用 `$DSH_HOME/AGENTS.md` 初始化摘要。示例关掉，避免人设进入记忆。 |
| `autoSummarize` | `true` | `true` | 总开关。关闭后不计数、不整理。 |
| `curateEveryTurns` | `20` | `20` | **每个会话**累计多少个有效回合触发一次整理。 |
| `curateMaxOps` / `curateMaxAdds` | `8` / `3` | `8` / `3` | 单次整理的操作数 / 新增数上限。 |
| `curateMaxBytes` | `40000` | `24000` | 一次 curator 输入的字节预算。 |
| `curateEntriesShown` | `80` | `80` | 提供给 curator 的已有条目数上限。 |
| `curateMaxTokens` | `2000` | `2000` | curator 输出的 token 上限。 |
| `orphanGraceMs` | `300000` | `300000` | 兜底整理的空闲宽限期（5 分钟）。 |
| `flushOrphansOnStart` / `flushOrphansOnNewSession` | `true` | `true` | 启动 30 秒后 / 新建私人会话 60 秒后各跑一次兜底整理。 |
| `captureSubagents` | `true` | `false` | 是否把子代理最终答复摘录进 rollout。 |
| `maxBytes` | `16000` | `3000` | 注入摘要的总字节上限。 |
| `scopeMaxBytes` | `2400` | `1200` | 工作区摘要的字节上限。 |
| `injectTokens` | `0`（不限制） | `1200` | 注入的 token 上限。 |
| `maxActiveSummaries` | `4` | `1` | 并发摘要上限。 |
| `redactSecrets` | `true` | `true` | 注入前脱敏。 |
| `embeddingApiKey` | `''` | 未配置 | 可选远程 embeddings；schema 标记为 secret，任何接口都不回显明文。 |

`privateWorkspace`、`memoryDir`、`scopedMemory`、`readOnlyScopes`、
`seedFromAgentsMd` 是结构性字段：改动需要重新加载插件，控制台里只读。
其余可热更新字段通过 `settings.mutate` 保存。

## 触发机制（当前实现，已核对代码）

**按会话累计，不是全工作区统一累计。**

- `countEffectiveTurn()`（`lib/index.js`）在 `agent/turn-stopping` 时执行，只处理
  私人工作区的根会话。
- 每个 session 在 `pending-turns.json` 的 `sessions[sessionId].pendingTurns` 里
  独立累加；`lifetimeTurns` 只是展示用总数，**不参与触发**。
- 当 `pendingTurns >= curateEveryTurns` 时，`scheduleCurate()` 为该 session 启动
  一次 curator；结束后按已处理回合数扣减，并把游标推进到本批最后一条事件。
- 有效回合的判定：本批事件里至少有一条 `user/message` 且 `source.kind === 'user'`
  和一条非空 `assistant/message`（`hasHumanExchange`）。schedule、subagent、
  系统注入都不算。

**“全工作区统一累计”没有实现。** `lifetimeTurns` 只出现在
`pending-turns.json` 和 curator 状态展示里，没有任何阈值读取它。这是规划功能，
不是已实现功能。

**新建会话 / 微信 `/new` 的效果**：

- `agent/created` 且是私人根会话时，60 秒后跑一次 `flushOrphans('new-session')`。
- 该兜底只整理“不在 `ctx.sessions.list()` 活跃集合里、且最后活动超过
  `orphanGraceMs`”的会话；它 **不会** 整理正在新建的这个会话（此时它还没有
  待整理回合），也不会强制整理其他仍然活跃的会话。
- 微信 `/new` 是否映射到同一个 `agent/created` 事件，属于 `@xmanrui/dsh-im` 的
  行为，**本次未验证**；桌面端新建会话走的是同一事件。

## 后台 curator

- 输入：当前摘要 + 已有条目（带 id）+ 本批对话（有界，含工具调用/结果）。
- 输出：严格 JSON `{"operations":[...]}`；只允许 `add` / `update` / `merge` /
  no-op，**禁止 delete**。
- 校验：操作数、新增数、id 已知性、content 长度、疑似凭据，任一失败整批拒绝。
- 归属：`attributeCuratorOperations()` 要求每条新增能在本批对话行里找到依据；
  文件列表、助手自述不能证明“共同经历”。
- 空结果：不写 raw、不触发 consolidation，推进游标并记录一次空检查。
- 有写入：强制触发一次 consolidation 刷新注入摘要。
- 并发：同一 session 同时最多一个 curator（`curatorRunning`）；跨进程用记忆目录
  锁，非持锁实例只读。

## 会话来源与 provenance

- `lib/provenance.js` 维护 `provenance.json`（有界）：
  `sourceType`（`user_statement` / `session_task` / `file_fact` /
  `assistant_claim` / `model_tool` / `manual` / `import` / `unknown`）、
  `sourceSessionId`、`sourceEventSeq`、`sourceEventEndSeq`、`evidence`、
  `curatorRunId`、`createdAt`、`updatedAt`。
- `lib/curator-log.js` 维护 `curator-log.json`（最多 100 次运行），记录触发原因、
  状态、增删改数量、丢弃数、LLM 调用数、摘要版本前后值。
- 旧条目没有 provenance 时，控制台显示“来源未知”，不猜测。

## 作用域

- `routeScope()` 固定 `workspace`；显式传 `global` / `project` 会被拒绝。
- 作用域键 = 工作区绝对路径的 SHA-256 前 16 位，形如 `ws-<hash>`（
  `scopeKeyForCwd`，Windows 下先小写归一）。路径不同即作用域不同。
- 数据落在 `memoryDir/scopes/ws-<hash>/`。
- 非私人根会话：`systemPrompt.context` 返回空串；14 个工具在执行前再次校验；
  非私人 agent 还会通过 `agent.ctx.tools.restrict({ deny })` 隐藏工具。
- **这不等于操作系统级隔离**：隔离只作用于 Harness 的工具与提示词。同一系统用户下、
  拥有任意文件读取工具的其他工作区 Agent，仍可直接读取 `memoryDir` 里的文件。需要
  OS 级隔离时，请用独立系统账户、NTFS ACL、沙箱或容器；本插件不宣称绝对安全隔离。

## 注入

- 每次组装提示词时同步重读摘要文件，写入后下一步生效；读失败返回空串，不阻塞会话。
- `scopedMemory: true` 时：全局摘要预算为 `maxBytes - scopeMaxBytes`，工作区摘要
  追加在 `## Workspace memory` 段。
- `injectTokens > 0` 时按 token 上限再截断。
- `redactSecrets: true` 时注入前脱敏。

## Journal、历史版本、回滚

- `journal.jsonl`：`{seq, op, id, ts, entry}` 追加日志；合并按 seq 消费；损坏行跳过
  且游标保持落后。
- `summary_history/<version>.<ts>.<uuid8>.md`：每次合并/回滚前归档当前摘要，按
  `keepSummaryVersions`（默认 20）保留。
- 工具 `memory_history` 列出历史版本，`memory_rollback` 恢复指定版本。
- 控制台也提供“恢复摘要版本”和“恢复已删除条目”（`restore-entry`）。

## 并发锁与原子写入

- 写入：同目录临时文件 + `rename` 原子替换（`writeAtomic`）。
- 跨进程锁：`<memoryDir>/.memory.lock`，`wx` 创建，默认 60 秒判定为 stale 后可被
  接管；拿不到锁的实例 `writeBlocked = true`，读（注入/搜索）继续，写抛错。
- 进程内：`MemoryStore.chain` 串行化所有读改写。
- 控制台编辑带 `revision`（raw 文件内容哈希前 16 位），过期编辑被拒绝。

## 凭据检测与安全限制

- `detectSecrets()` 识别常见 API key / token / 私钥 / 连接串形态。
- `memory_add` / `memory_update` 命中即拒绝；**没有** `allowSecret` 之类的绕过参数。
- curator 的每条 content 也过同一检测，命中即拒绝整批。
- `redactSecrets` 在注入前再脱敏一次。
- 管理接口全部要求 DSH 的 `connection.requestRejection`（Host/Origin + 签名会话
  cookie）；`connection` 缺失时 **fail closed 返回 503**，没有 loopback 降级。
- 控制台请求体只能指定 action 和记忆字段，不能指定工作区、scope、目录或文件路径。

## 记忆控制台

- 路由：`/_dsh/memory/console`（GET 快照 / GET `entry?id=` / POST 变更）与
  `/_dsh/memory/settings`（兼容用的小设置接口，同样要认证）。
- 功能：长期记忆列表、搜索/筛选（含已删除）、添加/修改/删除、来源与证据展示、
  摘要历史恢复、curator 运行记录、参数设置。
- 客户端 bundle id 必须等于包名（`dsh-memory-scoped`），否则设置页不出现。
- 详见 `docs/CONSOLE.md`。

## 数据布局

```text
<memoryDir>/
  memory_summary.md            全局注入摘要
  raw_memories.md              追加式条目
  journal.jsonl                变更日志
  summary_history/             摘要历史
  archive/                     超限归档
  rollout_summaries/<sid>.md   每会话轮次摘要
  state.json                   版本/游标
  diagnostics.json             启动诊断
  .memory.lock                 跨进程锁
  scopes/ws-<hash>/            私人工作区独立记忆库（含 pending-turns.json、
                               provenance.json、curator-log.json）
```

## 测试

```bash
cd plugins/memory
node --test
```

本包实测：**152 项，149 通过，3 跳过，0 失败**（跳过项需要外部 embeddings 服务 /
MCP 运行时）。测试是纯 Node，不需要 DSH 宿主。

## 已知限制（不要当成已实现）

1. 全工作区统一累计回合：**未实现**（见上）。
2. 微信 `/new` 触发整理：**未验证**；桌面新建会话只触发 60 秒后的兜底扫描。
3. 兜底整理只处理“非活跃且超时”的会话；活跃会话仍按各自 20 回合阈值触发。
4. 宿主接线（`apply()` / 工具注册 / 注入）没有端到端自动化测试，只有
   `test/host-wiring.test.js` 的结构性断言；真实部署仍需手工验收。
5. 控制台 UI 的可视化验证依赖人工点击；本包只覆盖 host 侧 HTTP 行为。
