# FORK-NOTES.md — 与上游 `dsh-memory` 的差异

上游：`haitang1/dsh-memory` v0.5.0，commit `15de1c7`，MIT。
本目录是该上游的受控分支，只改变“自动记忆的触发、写入策略、工作区隔离和展示层”，
不重写存储 / 工具 / 合并引擎。

公开发布时做的**匿名化改名**（不是行为变更）：

| 原 | 现 |
| --- | --- |
| 包名 `dsh-memory-<private>` | `dsh-memory-scoped` |
| `lib/<private>.js` | `lib/scoped.js` |
| 默认 `privateWorkspace` = 某台机器的用户目录 | `''`（留空即禁用，必须显式配置） |
| 私人工作区昵称、真实工作区 ID、本机路径 | 已替换为中性名 / 占位符 |

## 行为差异

1. **工作区隔离**
   - `privateWorkspace` 只做精确路径比较（分隔符、尾分隔符、大小写归一），
     子目录不会被前缀匹配带入。
   - 只对私人工作区的 **根会话** 开放：子代理会继承父会话的 `header.cwd`，
     因此子代理一律排除（`isRootSession` 同时要求无 `parentSession` 且
     `origin !== 'subagent'`）。
   - `systemPrompt.context` 对非私人根会话返回空串。
   - 14 个 `memory_*` 工具在执行前再次校验；非私人 agent 还通过
     `agent.ctx.tools.restrict({ deny })` 隐藏工具。
   - `routeScope` 固定为 `workspace`；显式 `global` / `project` 直接拒绝。
   - 不注册全局 `auto-memory` 技能（会出现在所有工作区目录）；记忆规则改放在
     私人工作区的 `CLAUDE.md`。
2. **按有效回合触发（工作区统一累计）**
   - 每个真实用户消息 + 助手答复记 1 个有效回合；schedule / subagent / 系统注入不计。
   - 工作区内全部 owned 根会话的未整理回合之和达到 `curateEveryTurns`（默认 20）
     时触发一次工作区 curator；每个会话保留独立 cursor。
   - 一次任务按最久未整理优先，每批最多 8 个会话，最多串行 8 批（64 个会话）；
     剩余写入 `deferredSessionIds`，不静默丢弃。
   - `pending-turns.json` 只存 `cursorSeq / countedSeq / pendingTurns / lifetimeTurns /
     owned`，不存对话正文。
3. **后台 curator**
   - 输入：当前摘要、候选 raw 条目（含 id）、最近一段对话（有界）。
   - 输出：严格 JSON `{"operations":[...]}`，只允许 add/update/merge/no-op，
     **禁止 delete**。
   - 每批新增最多 `curateMaxAdds`（默认 3），总操作最多 `curateMaxOps`（默认 8）。
   - 空结果：不写 raw、不触发 consolidation，推进游标并记录一次空检查。
   - 写入后强制触发一次 consolidation，刷新注入摘要。
4. **兜底整理**
   - 启动 30 秒后、以及新建私人会话 60 秒后，检查 `pending-turns.json`。
   - 只有“不在 `ctx.sessions.list()` 活跃集合中、且最后活动超过 `orphanGraceMs`”
     的会话才提前整理。
   - 新建会话本身不因此被整理；无法确认活跃状态时保留游标，不删除。
5. **凭据与 MCP 作用域**
   - `memory_add` / `memory_update` 始终检测凭据；删除 `allowSecret` 参数，不能绕过。
   - 独立 MCP server 的 add/update/merge 同样始终检测；不存在 `allowSecret`，
     也没有环境变量可以关闭写入拒绝。
   - MCP 作用域默认拒绝：`workspace` / `project` 只允许 `DSH_MEMORY_ALLOWED_ROOTS`
     内的路径，`global` 需显式 `DSH_MEMORY_ALLOW_GLOBAL=1`；未知 scope 直接报错。
   - curator 的每条 content 也经过 `detectSecrets`，命中即拒绝整批。
6. **人设分离**
   - `seedFromAgentsMd: false`，不把人设灌进记忆。
   - curator 提示词禁止写人设 / 行为规则。
7. **来源归属（provenance）**
   - 只有本插件亲自登记为私人根会话的 session id 才允许 curator 整理；归属写入
     `pending-turns.json` 的 `owned` 账本，不再按 cwd 猜测。
   - 新增条目必须能在本批对话行中找到依据；文件列表 / 助手自述不能证明共同经历。
8. **摘要一致性**
   - 删除 / 编辑后本地 scrub 并提升摘要版本，再排队 LLM consolidation。
   - scrub 只移除归一化后 **完全相等** 的 bullet，避免误删相似事实。
   - consolidation 以版本 CAS 写入，过期结果丢弃。

## 0.6.0 新增：记忆控制台

- 入口：DSH 设置 → “私人工作区记忆”（`settings.section`；客户端 bundle id 与
  包名一致）。
- Host API：`/_dsh/memory/console`，只管理由 `privateWorkspace` 推导出的那一个
  scope；客户端不能指定 scope、目录或文件路径。
- 存储：复用 `MemoryStore` 的锁、原子写、journal、summary history；新增
  `provenance.json` 与 `curator-log.json` 两个有界侧车，不改变 raw/summary 格式。
- 来源字段：`sourceType`、`sourceSessionId`、`sourceEventSeq`、
  `sourceEventEndSeq`、`evidence`、`curatorRunId`、`createdAt`、`updatedAt`。
  旧条目没有记录时显示“来源未知”。
- 参数：`autoSummarize`、`curateEveryTurns`、`curateMaxOps`、`curateMaxAdds`、
  `curateMaxBytes`、`maxBytes`、`injectTokens`、`maxActiveSummaries` 通过
  `settings.mutate` 保存；`privateWorkspace`、`memoryDir`、`scopedMemory`、
  `readOnlyScopes`、`seedFromAgentsMd` 在页面只读。

## 安全修复（P0，已包含在本包）

- `lib/auth.js` 统一认证：只认 `connection.requestRejection`；`connection` 缺失
  返回 503（fail closed），**没有** loopback / same-origin 降级。
- `lib/console-web.js`、`lib/web.js` 的所有 GET/POST 都先走该认证。
- `lib/summary-scrub.js` 只用归一化 exact match 删除摘要 bullet，删除旧的模糊匹配。
- `lib/console.js` / `lib/index.js` 在更新前快照旧条目，避免 scrub 针对新文本。
- `lib/session-ledger.js`：删除会话后清理 pending/owned，但 **不删除任何长期记忆
  条目**。
- `lib/index.js` 监听 `session-delete/deleted`，仅在确认会话已不存在时清理状态；
  无法确认时保留游标由兜底扫描重试。

## 文件裁剪说明

公开发布包没有收录上游的 `README.md`、`README.zh.md`、`CHANGELOG.md`、
`AGENTS.md`（开发指引）、`docs/STATUS.md`、`docs/ROADMAP.md`、
`docs/DESIGN.md`、`docs/AUDIT-PHASE-A.md`、`scripts/*` 和 CI 配置。原因：

- 上游 README / CHANGELOG 描述的是上游行为，直接保留会与本分支不一致；
- `STATUS.md` / `ROADMAP.md` 是历史记录，包含“已完成”的历史断言，容易与当前代码
  混淆；
- `scripts/*.ps1` 是某台机器的部署脚本，含本机路径假设；
- CI 与 `scripts/check-release.mjs` 依赖被裁掉的 README/CHANGELOG 及其测试数约定。

实现本身（`lib/`、`bin/`、`test/`）完整保留，测试可在无 DSH 宿主的环境直接运行。
