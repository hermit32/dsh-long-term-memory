# 私人工作区记忆控制台（第三阶段）

设置 → **私人工作区记忆**。页面只管理私人工作区 `C:\Workspaces\private` 的独立记忆库
（scope `ws-0123456789abcdef`），不读取 global、project 或其他工作区。

## 1. 入口与运行方式

| 层 | 文件 | 职责 |
|---|---|---|
| 浏览器 UI | `lib/client.js` | `window.__ModuleLoader__.load({ id: 'dsh-memory-scoped' })`；向 `settings.section` 注册 `私人工作区记忆`；三个标签；不直接读写 Markdown。 |
| 路由 | `lib/console-web.js` | `/_dsh/memory/console`（prefix）；认证、同源/Host 校验、JSON/CSP、body 上限。 |
| 服务 | `lib/console.js` | 快照、条目详情、增删改、摘要版本、参数视图/保存；复用 `MemoryStore`。 |
| 宿主接线 | `lib/index.js` | 创建服务、注入 scope/store/runtime、curator 状态、settings 读取。 |

认证：存在 `connection` 服务时，请求必须带 DSH 签名的浏览器会话 cookie；缺失/过期
返回 401，跨站或 Host 不可信返回 403。没有 `connection` 的部署退化为 loopback +
同源检查（不低于旧设置端点）。客户端不能传 scope、目录、文件路径。

## 2. 长期记忆

- 摘要：`memory_summary.md`，显示版本、字节、更新时间；`历史版本` 列出
  `summary_history/` 并可恢复（恢复前归档当前版本）。
- 条目：`raw_memories.md` 活动条目 + `archive/raw-*.md`；`显示已归档` 打开归档。
- 搜索/筛选/排序在浏览器内完成（数据由一次快照提供）。
- 详情：ID、正文、标签、重要程度、创建/修改、来源类型、来源会话、事件序号、
  证据、记录方式；旧条目无 provenance 时显示「来源未知」。
- 新增/编辑/删除：Host 端用 `validateContent`、`normalizeTags`、`detectSecrets`
  校验；删除必须 `confirm: true` 且带条目 revision；编辑带 `expectedEntryRevision`，
  冲突返回 409。
- 修改历史：`journal.jsonl` 中同一 id 的 add/update/delete 快照，可从任意历史版本
  恢复（`restoreRawEntry`）。
- 已删除：`显示已删除` 从 journal 的 delete 快照还原条目（带「已删除」标签），
  点击后可恢复。
- 摘要即时性：删除/编辑在同一请求内 scrub 掉对应 bullet 并提升摘要版本；随后排队
  一次正常 consolidation。consolidation 写入前比较摘要版本，若期间被手动 scrub/
  回滚改写则丢弃过期模型结果。

## 3. 整理记录

- `curator-log.json`：最多 100 条运行记录，字段包括 runId、开始/结束、会话、触发
  方式（threshold/orphan/manual）、状态（ok/empty/failed/skipped）、处理回合、LLM
  调用与失败、add/update/merge/duplicate/dropped、摘要版本前后、错误、重试次数、
  新增/更新/合并的 id。不保存提示词或模型原文。
- 兼容旧数据：升级前只有 `diagnostics.json` 的聚合计数器，页面把它作为一条
  「旧版汇总」记录显示，第一次新运行后由真实日志取代。
- 待整理：`pending-turns.json` 的 `sessions` + `owned` 账本；显示每个会话的
  pendingTurns、距阈值剩余、最近整理时间、是否活跃、是否由本插件登记。
- 手动「立即整理」只处理已登记且有 pending 的会话；不会为未登记的历史会话按 cwd
  猜测归属。
- 累计有效回合：`pending-turns.json.lifetimeTurns`，从本版本开始记录（升级前的回合
  没有在该字段中，页面明确标注）。

## 4. 参数设置

| 字段 | 默认/推荐 | 生效 |
|---|---|---|
| `autoSummarize` | true | 即时 |
| `curateEveryTurns` | 20 | 即时（下一次计数/整理） |
| `curateMaxOps` | 8 | 即时（下一次整理） |
| `curateMaxAdds` | 3 | 即时 |
| `curateMaxBytes` | 40000 | 即时 |
| `maxBytes` | 3000 | 即时（下一次注入） |
| `injectTokens` | 1200 | 即时 |
| `maxActiveSummaries` | 1 | 即时 |

保存走 `settings.mutate(ns, ops, expectedRevision)`，只写用户层最小补丁（与默认/继承
值相同则 unset，避免把默认值钉进 user 层）。冲突 409 时页面提示并刷新。
`curateEveryTurns` 等原先属于 structural 的字段已移入 volatile 集，否则
`settings.mutate` 会以 “not volatile” 拒绝写入。

只读：`privateWorkspace`、`memoryDir`、`scopedMemory`、`readOnlyScopes`、
`seedFromAgentsMd`、`embeddingApiKey`（只显示是否配置）。这些需要 profile patch /
重新加载插件。

## 5. 来源与 curator 约束

`provenance.json`（每 scope 一个，按条目 id）：

```json
{
  "version": 1,
  "entries": {
    "mem-xxxxxxxx": {
      "sourceType": "user_statement | session_task | file_fact | assistant_claim | model_tool | manual | import | unknown",
      "recordedBy": "curator | model_tool | manual | manual_edit | import",
      "sourceSessionId": "session-...",
      "sourceEventSeq": 123,
      "sourceEventEndSeq": 145,
      "curatorRunId": "cur-...",
      "evidence": "对话原文（≤500 字符）",
      "createdAt": "2026-10-28 11:40",
      "updatedAt": "2026-10-28T...Z",
      "deletedAt": "...",
      "mergedInto": "mem-yyy"
    }
  }
}
```

curator 的 `add/update/merge` 输出仍只允许这三种操作。Host 在写入前做确定性归属：

1. 把本次输入对话压成带 `seq`/角色/工具名的行；
2. 对每条内容计算与对话的 token 覆盖，低于阈值直接拒绝（`dropped`）；
3. 选最佳匹配行：用户行 → `user_statement`；写类工具行（write/edit/pwsh 的写命令等）
   且本批有真实人类交互 → `session_task`；只读工具/文件 → `file_fact`；助手自述 →
   `assistant_claim`（拒绝作为 add 来源）；
4. 涉及用户个人事实必须是 `user_statement`；涉及「一起/共同/陪用户」等共同经历
   必须是 `user_statement` 或 `session_task`；仅文件列表/助手推测 → 拒绝；
5. 通过的内容才写入 raw，并记录来源。

这条规则直接覆盖了「看 Downloads 文件名就推断曾一起整理医学资料」的事故：
目录列表是 `file_fact`，不能支撑共同经历。

会话归属：`countEffectiveTurn` 只在 `isPrivateRoot` 为真时把 session id 写进
`pending-turns.json.owned`；`runCurator` 对不在账本中的 id 返回 `skipped` 并清零
pending，不按历史会话 cwd 猜测。

## 6. 安全清单

- 认证：`connection.requestRejection(req)`（Host/Origin fence + 浏览器 cookie），
  `console` 与 `settings` 两个入口共用 `lib/auth.js`。
- 失败关闭：`connection` 缺失或没有 `requestRejection` 时返回 **503**，**没有**
  loopback / same-origin 降级。旧版本曾用「loopback + Host 头 + sec-fetch-site」
  兜底，该路径已在 P0 修复中删除，不应重新引入。
- 方法：GET 快照/详情；POST 只接受 `action` 白名单。
- 数据：客户端不能指定 scope/目录/文件；id 必须匹配 `^mem-[A-Za-z0-9_-]{4,64}$`。
- 凭据：`detectSecrets` 拒写；`embeddingApiKey` 只返回 `configured`。
- 并发：条目 `expectedEntryRevision`；设置 `expectedRevision`；删除 `confirm: true`。
- 渲染：React 转义；不使用 `dangerouslySetInnerHTML`；摘要按行渲染为文本节点。
- 故障隔离：页面/接口错误只在设置页显示；curator 与注入路径不读取 console 状态；
  页面关闭不影响 Host。

## 7. 运维与回滚

- 数据：`<memoryDir>\scopes\ws-<hash>\`
  - `raw_memories.md`、`memory_summary.md`、`journal.jsonl`、`summary_history/`
  - `provenance.json`、`curator-log.json`、`pending-turns.json`
- 回滚代码：用上一版插件目录覆盖并重新加载 profile；
  回滚数据：把 `<memoryDir>` 整体还原（先停 Host），或只删除新增侧车
  `provenance.json` / `curator-log.json`（它们不影响旧工具读取）。
- 参数回滚：设置页「恢复推荐默认值」或编辑 profile patch；已保存的 user 层最小补丁
  可用 `unset` 清除。
