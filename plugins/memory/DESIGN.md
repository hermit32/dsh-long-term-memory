# DESIGN — dsh-memory-scoped

## 目标

给一个显式配置的私人工作区提供可审计的长期记忆，同时保证其他工作区、子代理和
非根会话无法注入或调用记忆工具。

## 分层

| 层 | 文件 | 职责 |
|---|---|---|
| 策略 | `lib/scoped.js` | 精确 cwd、根会话判定、pending 统计/选择、curator 输入与操作校验 |
| 宿主 | `lib/index.js` | `apply()`、turn-stopping、workspace curator 调度、process `/new` 监听、工具注册 |
| 存储 | `lib/store.js` | raw/summary/journal、锁、原子写、summary history、provenance 侧车 |
| 控制台 | `lib/console.js` + `lib/client.js` | 快照、管理、参数；客户端 bundle ID = `dsh-memory-scoped` |
| 来源 | `lib/provenance.js` | 每条记忆的 session/event/evidence/curatorRunId |
| 日志 | `lib/curator-log.js` | 有界运行记录，含 `sessionIds`/`deferredSessionIds` |

## 工作区调度

- `pending-turns.json` 按 session 保存 `pendingTurns`、`cursorSeq`、`countedSeq`。
- 触发量 = 全部 `owned` 根会话的 `pendingTurns` 之和；`lifetimeTurns` 不参与。
- 一个 scope 同时只有一个 workspace run；每个 session 同时只有一个 curator。
- 每批最多 8 个 session；成功/空结果推进该 session 游标；失败保留 pending。
- 任务期间新回合不会清零；最多串行 8 批（64 session），剩余 deferred。
- 新会话 `agent/created` `source=startup`、微信 `/new` process 事件、孤儿兜底
  都进入同一个 workspace run。

## 来源与安全

- Curator 的每条 add/update/merge 必须在当前批 transcript 中找到依据；找不到就丢弃。
- `attributeCuratorOperations` 必须把 `lines` 放进 attribution context。
- 凭据检测没有 `allowSecret` 绕过参数；命中即整批拒绝。
- 私人工作区只做模型工具/提示词层隔离，不是操作系统级文件隔离；拥有同用户文件
  读取权限的其他工作区仍可能读取 `<memoryDir>`。需要更强隔离时使用独立账户/ACL/容器。
- 真实微信 `/new`、真实外部模型、完整 Desktop 重启属于人工验收项，不能由单元测试
  冒充。

## 失败恢复

- raw 写入成功但 cursor 保存失败时，`completeCurate` 恢复 record 和 `owned` 快照；
  `failCurate` 保存失败尝试。重试由 duplicate 检测避免重复 raw，游标不错误推进。
