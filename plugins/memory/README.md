# dsh-memory-scoped — 私人工作区长期记忆插件

> Current release: **0.2.0**
>
> **实际使用状态**：本方案源自维护者长期使用的真实 DSH 记忆部署，相关长期记忆及微信交互能力已经投入日常使用；本仓库的匿名化公开 v0.2.0 包另有自动化测试。下方“未完成验收”是指特定触发链路及公开部署兼容性的可复现证据仍待补齐，**并不表示项目尚未被使用**。

> 本包是 **`dsh-memory` 的受控分支**，不是上游发布包。上游为 `haitang1/dsh-memory`
> v0.5.0（commit `15de1c7`，MIT）。为公开发布，包名、模块名和默认值已做匿名化处理；
> 行为逻辑保留真实实现。改动清单见 `FORK-NOTES.md`。

## 它做什么

给 **一个指定工作区** 提供长期记忆：

- 每次提示词注入一份有界的记忆摘要（`systemPrompt.context`，order 2000）。
- 提供 14 个 `memory_*` 工具，供模型读写记忆。
- 私人工作区内全部 owned 根会话的未整理 **有效回合** 累计达到阈值后，由后台模型
  （curator）统一整理；每个会话保留独立 cursor 和来源。
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
   `examples/config.example.yml`）。**必须**设置 `privateWorkspace`；
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
| `curateEveryTurns` | `20` | `20` | 所有 owned 私人根会话的未整理有效回合**总和**达到此值时触发一次工作区整理；不是单个会话达到 20。 |
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

## 为什么分成 Curator 和 Consolidation？

“自动总结”分为两种不同工作：

- **Curator（提取记忆）**：从各会话游标之后的真实对话事件提取长期有价值的事实、偏好和约定；可提出 `add`、`update`、`merge` 或 no-op。提案必须经过来源归属和凭据检查，不能因为模型自己说了某件事就当成用户经历。
- **Consolidation（整合摘要）**：在有有效记忆写入后，基于已保存的条目生成有长度限制的摘要；每次构建私人会话提示词时，插件读取这份摘要并注入。它不是把 20 轮原文直接粘贴进下一个对话。

例如私人会话 A=8 轮、B=6 轮、C=6 轮，共 20 轮待整理：触发的是**一次工作区调度任务**，任务中分别处理 A/B/C、保存各自来源与游标，再根据有效更新整合摘要。没有值得记录的事实时可以不新增记忆；Curator 与真实外部模型的端到端效果仍需人工验收。

## 触发机制（当前实现，已核对代码）

**按工作区统一累计，不是按单个会话累计。**

- `countEffectiveTurn()`（`lib/index.js`）在 `agent/turn-stopping` 时执行，只处理
  配置的私人工作区根会话。
- 每个 session 在 `pending-turns.json` 的 `sessions[sessionId].pendingTurns` 里
  独立保存；工作区总量是 `owned` 会话 `pendingTurns` 的和，`lifetimeTurns` 只展示、
  **不参与触发**。
- 总量达到 `curateEveryTurns`（默认 20）时，`runWorkspaceCurator()` 扫描全部
  pending owned 会话，按最久未整理优先，每批最多 8 个会话，串行执行。
- 每个会话保留自己的 cursor、transcript、provenance；只有成功/空结果的批次推进
  游标。失败批次保留 pending；任务期间新产生的回合保留。
- 一次任务最多串行 8 批（64 个会话）；17 个会话分 3 批完成，剩余进入
  `deferredSessionIds`，不会静默丢弃。

**桌面新建和微信 `/new`：**

- 桌面新会话：`agent/created` 且 `source === 'startup'`、私人根会话；`resume`
  （打开已有/启动恢复）、子代理、其他工作区不触发。
- 微信 `/new`：dsh-im 本地补丁在清除绑定后发出 `dsh-im/new-session` process 事件；
  记忆插件校验 workspace/上一会话 header 后触发。未安装补丁时，最迟在下一条消息
  创建新会话时由 `startup` 触发。
- 孤儿兜底仍保留：启动 30 秒后、新建私人会话 60 秒后，只处理非活跃且超过
  `orphanGraceMs` 的会话。

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
- `memory_add` / `memory_update` / `memory_merge` 命中即拒绝；**没有** `allowSecret` 之类的绕过参数。
- curator 的每条 content 也过同一检测，命中即拒绝整批。
- `redactSecrets` 在注入前再脱敏一次。
- 管理接口全部要求 DSH 的 `connection.requestRejection`（Host/Origin + 签名会话
  cookie）；`connection` 缺失时 **fail closed 返回 503**，没有 loopback 降级。
- 控制台请求体只能指定 action 和记忆字段，不能指定工作区、scope、目录或文件路径。

> **安全范围说明（v0.2.0）**：以下独立 MCP 服务已接受额外的内容、标签、合并计划与删除 journal 脱敏回归测试。Cordis 宿主工具 `memory_merge` / `memory_delete` 尚未完全同步这些附加防护，不能将 MCP 的安全结果视为所有入口一致。

### 独立 MCP server（`bin/dsh-memory-mcp.mjs`）

- 写入路径 `memory_add` / `memory_update` / `memory_merge` 始终检测凭据，命中即拒绝；
  content 和 `normalizeTags()` 之后的**最终 tags** 都会扫描，没有 `allowSecret` 参数，
  也没有环境变量可以关闭扫描（`DSH_MEMORY_REDACT=0` 不影响写入行为）。
- `memory_update` 校验“写入后的最终状态”（content + tags），因此历史遗留的含凭据条目
  不能通过只改 importance/tags 继续保留；需先删除或整条改写。
- `memory_merge` 的唯一合并计划由 `lib/store.js` 的 `planMergeEntries()` 生成，MCP 与
  `MemoryStore` 不再各自实现“最长内容 / 标签并集 / 16 项上限 / 顺序”规则；所有参与
  条目（content 与 tags）都在落盘前检查，拒绝重复 ID、缺失 ID 和非法 `keepId`，
  校验的就是即将写入的对象，失败时 raw 与 journal 都不变。
- `memory_delete` 对历史含凭据条目只把元数据写入 journal，content/tags 用占位符替换，
  避免删除动作把凭据复制到另一个持久化文件。
- 错误信息不回显用户原文：超长 tag 只报长度上限，未知 scope/tool、缺失条目也不再
  回显输入值。
- 作用域默认拒绝：`workspace` / `project` 只接受 `DSH_MEMORY_ALLOWED_ROOTS` 内的
  路径（`path.delimiter` 分隔的绝对路径，Windows 用 `;`），每个配置的根目录对应
  一个 `ws-` 作用域，子目录不会派生出新作用域；`global` 需要显式设置
  `DSH_MEMORY_ALLOW_GLOBAL=1`。客户端传入的 `cwd` 不会被当成任意作用域。
- 未知 `scope` 值直接报错，不会静默回退到 `global`。
- 客户端配置示例见 `examples/mcp-config.json`（只设置 `DSH_MEMORY_DIR` 与
  `DSH_MEMORY_ALLOWED_ROOTS`；该示例不启用 `global`）。
- 回归测试 `test/mcp.security.test.js` 由 `scripts/check-release.mjs` 单独运行并
  断言；任一项失败都会让发布检查以非零退出。

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
cd dsh-memory-scoped
node --test
```

The test suite runs 187 tests: 184 pass, 3 skip, 0 fail. 本包实测：**187 项，184 通过，3 跳过，0 失败**（跳过项需要外部 embeddings 服务 /
MCP 运行时）。测试是纯 Node，不需要 DSH 宿主。

额外可复现集成 harness：`node acceptance/curator-harness.mjs all`（需要 DSH peer packages；
只用临时目录和合成事件，见 `acceptance/README.md`）。

## 已知限制与待补的专项验收

1. **真实使用与 `/new` 专项测试是两回事**：维护者已有真实微信日常交互经验；process 监听器和 dsh-im 补丁通过模拟测试，但 `/new` → Curator → 落盘的完整运行日志尚未独立复核。
2. **真实模型使用与 20 轮可复现验收是两回事**：维护者已在真实 DSH 中持续使用记忆方案；集成 harness 使用确定性 LLM stream，不能据此证明每个真实模型的提取质量或完整 20 轮链路。
3. **完整 Desktop 冷启动专项测试**：尚未完成可复现的独立记录；历史热重载不等同冷启动，见 `RESTART-CHECKLIST.md`。
4. 后台自动创建的新鲜私人根会话仍无法与用户主动新建在 `agent/created` 层完全区分。
5. 超过 64 个待整理会话仍会留 deferred；需要下一次触发/手动整理。
6. 宿主接线（`apply()` / 工具注册 / 注入）没有端到端自动化测试，只有 `test/host-wiring.test.js` 的结构性断言；真实部署仍需手工验收。
7. 控制台 UI 的可视化验证依赖人工点击；本包只覆盖 host 侧 HTTP 行为。

