# ARCHITECTURE.md — 组件与数据流

## 总览

```text
                    ┌──────────────────────────────────────────────┐
                    │ DSH Host (0.2.1-rc.3, desktop profile)        │
                    │                                              │
  IM 消息 ─────────▶│  @xmanrui/dsh-im ──▶ 私人工作区根会话          │
  (仅微信已验证)      │                        │                     │
                    │                        ├─ 指令文件            │
                    │                        │   <ws>/AGENTS.local.md│
                    │                        │   <ws>/CLAUDE.md     │
                    │                        │   ~/.dsh/AGENTS.md   │
                    │                        │                     │
                    │  dsh-memory-scoped ────┘                     │
                    │   ├ 注入摘要 (systemPrompt.context)           │
                    │   ├ 14 个 memory_* 工具                       │
                    │   ├ 回合计数 → curator → consolidation         │
                    │   └ /_dsh/memory/{console,settings} (认证)    │
                    │                                              │
                    │  session-cascade-delete                      │
                    │   ├ UI 删除路由 (认证)                        │
                    │   ├ session_delete 工具 (按工作区隔离)         │
                    │   └ emit session-delete/deleted ──▶ 记忆清理   │
                    └──────────────────────────────────────────────┘
                                    ▲
 工作区 A、工作区 B ── notify.ps1 ─────────┘（只发文字，不改绑定/不回复）
```

## 三层职责

| 层 | 组件 | 职责 | 不是它做的 |
| --- | --- | --- | --- |
| DSH 核心 | `dsh-agent-instructions`、`dsh-settings`、`dsh-tools`、`connection`、`sessions` | 指令文件发现、设置接缝、工具注册、请求认证、会话列表 | 不提供长期记忆、不提供删除插件策略 |
| 本项目插件 | `dsh-memory-scoped`、`session-cascade-delete`（修改版） | 记忆策略、curator、控制台、按工作区隔离的会话删除 | 不重写 DSH 存储、不修改 DSH 核心 |
| 本地脚本 | `notify.ps1` + `lib/dsh-host.ps1` | 发现 Host、校验进程归属、去重、排队、补发 | 不接收消息、不改变绑定、不执行主工作区操作 |

## 长期记忆的数据流：提取与整合是两步

本项目不是对每个会话进行一次静态压缩，而是将对话中的**可持续使用的信息**抽取为持久条目，再生成供后续提示词使用的摘要：

```text
user/assistant 对话事件
    ↓  agent/turn-stopping：每个私人根会话按事件序号累计 pending
工作区总 pending ≥ curateEveryTurns（默认 20）
    ↓  也可由新建私人根会话、微信 /new 补丁事件、孤儿兜底触发
runWorkspaceCurator()：按最久未整理顺序选择 owned 会话
    ↓  每个会话单独获取 cursor 之后的 transcript
runCurator() → LLM 的 add/update/merge/no-op 提案
    ↓  validateCuratorOperations() → attributeCuratorOperations()
MemoryStore：raw_memories.md / journal.jsonl / provenance.json
    ↓  成功后推进该会话 cursor；失败保留 pending
Consolidation → memory_summary.md（有界摘要）
    ↓  下一次生成 prompt 时重新读取并注入
新的私人工作区会话使用已保存记忆
```

- **Curator = 提取与更新。** 分析未处理的对话，提出记忆操作，验证事实来源，不把无根据的推测写入长期记忆。
- **Consolidation = 整合与摘要。** 有有效写入时，整理已有条目为可注入提示词的摘要；不需要把所有历史原文重新传给新会话。
- **工作区任务 ≠ 单一混合会话。** A=8、B=6、C=6 共 20 个有效回合触发一次工作区任务，但每个会话有自己的 transcript、cursor 和 provenance。
- **失败与空结果。** 失败批次不扣 pending；有效 no-op 可以推进已检查的游标而不生成新记忆；运行中产生的新回合留待下一次处理。
- **范围和验证。** 当前默认最多 8 批 × 8 会话。模拟模型隔离 harness 有通过证据，真实外部模型/微信 `/new`/Desktop 冷启动仍待端到端验收。见 [STATUS.md](STATUS.md)。

## 记忆插件内部

```text
lib/index.js        宿主接线：apply()、Config、工具定义、回合计数、
                    curator、consolidation、注入、事件监听
lib/scoped.js       纯策略：工作区判定、pending 状态机、curator 输入/校验、提示词
lib/store.js        存储原语：raw/journal/summary 解析、原子写、锁、作用域、
                    归档、BM25+向量搜索、凭据检测
lib/attribution.js  来源归属：把 curator 建议对回对话行
lib/provenance.js   provenance 侧车（有界）
lib/curator-log.js  curator 运行日志（有界）
lib/summary-scrub.js 摘要的确定性清理（exact match）
lib/console.js      控制台服务：快照、增删改、恢复、设置
lib/console-web.js  /_dsh/memory/console 路由
lib/web.js          /_dsh/memory/settings 路由 + 设置补丁归一化
lib/auth.js         统一认证（fail closed）
lib/client.js       Web 客户端 bundle（设置页 UI）
lib/automation.js   蒸馏/合并提示词与文本工具
lib/volatile.js     DSH settings 的 volatile/secret 兼容层
bin/dsh-memory-mcp.mjs 独立 stdio MCP server（9 个工具）
```

### v0.2.0 自动整理与记忆注入时序

```text
私人工作区根会话 A / B / C 的 agent/turn-stopping
  └─ countEffectiveTurn（各自保存 pendingTurns 和 cursor）
      └─ workspacePendingTotal = Σ owned 根会话 pendingTurns
          ├ 合计未达到 curateEveryTurns（默认 20）→ 持续累计
          └ 达到阈值 → scheduleWorkspaceCuration(scopeKey, 'threshold')
              └─ runWorkspaceCurator（工作区任务锁）
                  ├ 扫描 owned、未遗忘且 pending > 0 的会话
                  ├ 按最久未处理排序；8 会话/批，最多 8 批
                  ├ 每会话独立 cursor → transcript → LLM curator
                  ├ 校验操作 + 基于 transcript lines 的 attribution
                  ├ 应用记忆、写入 provenance、journal
                  ├ 成功/空结果：只推进本会话 cursor、扣本次回合
                  ├ 失败：保留 pending；处理中新增回合保留
                  └ 有写入 → consolidation → 后续提示词注入摘要
```

- **桌面新建**：`agent/created`、`source=startup`、私人根会话时触发同一整理入口，`resume` 不触发。
- **微信 `/new`**：可选 [`patches/`](patches/README.md) 为 dsh-im 提供 `dsh-im/new-session` 进程事件；监听器复核工作区和前一会话后触发。
- **孤儿兜底**：保留非活跃会话定时整理。跨会话批次中每个来源 session 仍有独立游标及 provenance。
- **局限**：模拟事件通过，但真实微信 `/new`、完整 DSH 冷启动及真实外部模型多会话整理尚未全部验收。

**独立 MCP 的安全边界：** `bin/dsh-memory-mcp.mjs` 使用 `DSH_MEMORY_ALLOWED_ROOTS` 白名单限制 scope，写入前拒绝内容与 tags 的凭据；`memory_merge` 使用存储层唯一 `planMergeEntries()` 计划。该附加入口与 Cordis 宿主 `memory_merge`/`memory_delete` 的安全措施尚未完全一致，不可把 MCP 的专项加固结论直接外推到全部宿主工具。

### 作用域键

`scopeKeyForCwd(cwd)` = `ws-` + SHA-256(小写化、去尾分隔符的绝对路径) 前 16 位。
因此 IM 会话与桌面会话只要是同一个工作区路径，就共享同一份记忆；路径不同即隔离。

## 会话删除插件内部

```text
src/index.js           宿主接线、删除核心、UI 路由、session_delete 工具
src/workspace-scope.js 纯函数：路径归一路径、workspace 归属、root 父链解析
src/client.js          UI（头部按钮 + 侧栏菜单 + 确认弹窗）
```

删除核心（`deleteSessionCore`）：

1. 解析目标 id 的多种拼写（`session-<uuid>` / uuid / 目录名）；
2. 模型工具路径：`assertTargetInCallerWorkspace()` 用**新鲜的**注册表数据校验；
3. 释放运行中的 agent 与 live session；
4. 递归枚举 `ctx.subagents.listDescendants()`（只沿 `origin=subagent` 父链；
   fork 分支不算）；
5. 删除日志目录、投影缓存、工作区记账、归档/置顶；
6. 再次校验工作区归属（缩小并发移动窗口）；
7. 广播 `session-delete/deleted`。

UI 路由没有 `callerWorkspace`，是全局管理员面；`session_delete` 工具必须有可证明的
调用方工作区，否则拒绝。这是**有意的不对称**。

## 通知链路

```text
notify.ps1
  ├ 解析工作区根（workspace.json 注册表 → workspace-labels.json → 目录名）
  ├ 选择 state 目录（工作区根/.dsh-notify 或中央目录）
  ├ 去重（10 分钟窗口，SHA-256）
  ├ Resolve-DeliveryEndpoint
  │   ├ loopback-only 校验
  │   ├ 端口 → 拥有进程 → 可执行文件路径 == appExe
  │   └ dsh-im 路由探测（必须回 404 unknown-bot/unknown-target）
  ├ POST {botId, targetId, text}
  └ 失败 → 入队（JSONL，有界、可过期）；成功 → 清队列
```

没有固定端口；`endpoint` 覆盖项也走同一套校验。

## 信任边界

| 边界 | 规则 |
| --- | --- |
| 工作区 → 记忆 | 精确路径 + 根会话；其他一律空注入 + 工具拒绝 |
| 模型 → 删除 | 只能操作调用方工作区内、可证明归属的会话 |
| 本机进程 → 管理接口 | 必须有 DSH 签名的浏览器会话 cookie；无 connection 即 503 |
| 本机进程 → 通知接口 | 只能向 loopback 上由 Harness 进程拥有的端口发送；**接口本身无认证**（已知限制） |
| 工作区 A、工作区 B → 微信 | 只能发文字；botId/targetId 只读自中央配置；无回复通道 |
| 通知内容 → 外发 | 由调用方负责不写入凭据；脚本不做内容审查 |

### 这些边界不代表文件系统隔离（重要）

“工作区 → 记忆”这一行是 **Harness 层的工具与提示词隔离**：它决定哪个会话能调用
`memory_*`、能收到记忆注入。它**不改变操作系统权限**。

- 同一系统用户下运行的其他工作区 Agent，如果拥有任意文件读取工具（`read`、
  `Get-Content`、`pwsh` 等），仍然可以读取 `<memoryDir>` 里的记忆文件；
- 它也可以读取 `notify-config.json`、`.dsh-notify` 状态和插件源码；
- 本插件没有、也无法在纯插件层阻止这种访问。

若需要 OS 级隔离，应组合使用：独立系统账户运行 Host、NTFS ACL 限制 `<memoryDir>`、
沙箱/容器运行不可信 Agent、或移除其文件读取与 shell 权限。当前方案**不宣称**
绝对安全隔离。

## 数据与文件

```text
<memoryDir>/                     记忆数据（见 plugins/memory/README.md）
<DSH_HOME>/AGENTS.md             全局指令
<ws>/AGENTS.local.md             工作区 persona（DSH 原生加载）
<ws>/CLAUDE.md                   记忆规则（DSH 原生加载）
<ws>/.dsh-notify/                非私人工作区的通知状态
<DSH_HOME>/assistant/            私人工作区的通知状态与脚本
<DSH_HOME>/integrations/         IM 插件配置（不要手改）
<DSH_HOME>/profiles/<p>/          profile bundle 与 patch
<DSH_HOME>/storages/workspace.json  工作区注册表（子代理/通知共用）
```
