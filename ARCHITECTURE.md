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

### 一次自动整理的时序

```text
agent/turn-stopping
  └─ countEffectiveTurn(agent)
       ├ 非私人根会话 → 返回
       ├ 读 pending-turns.json（按 scope）
       ├ 有新事件 + hasHumanExchange → pendingTurns += 1, lifetimeTurns += 1
       └ pendingTurns >= curateEveryTurns
            └─ scheduleCurate(sessionId, 'threshold')
                 └─ setTimeout(0) → runCurator()
                      ├ 取本会话游标之后的原始事件
                      ├ 构造 transcript（有界）+ 当前摘要 + 候选条目
                      ├ llm.text(...)  （后台模型，reasoningEffort=off）
                      ├ validateCuratorOperations（禁 delete/限条数/查凭据）
                      ├ attributeCuratorOperations（对回原文，丢弃无依据条目）
                      ├ 应用 add/update/merge + 写 provenance
                      ├ advancePendingAfterCuration（推进游标、扣减 pending）
                      └ 有写入 → requestConsolidation → 刷新注入摘要
```

并发控制：同一 session 一个 curator；所有 store 写入经 `withLock` 串行；跨进程
`.memory.lock`。

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
