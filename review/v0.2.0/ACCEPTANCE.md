> **历史 RC3 验收记录（脱敏副本）**：记录的是发布前候选测试与限制。本文的“未上传 GitHub / 未就绪”描述为当时状态；v0.2.0 已以**技术预览版**形式公开，未完成的真实微信/外部模型/冷启动验收仍然未完成。

# dsh-memory-scoped rc3 验收报告

- 候选：`dsh-memory-scoped 0.2.0-rc3`
- 基线：GitHub 公开 `dsh-memory-scoped` v0.1.0（包内 `0.6.0-local.1`）
- 插件 ID / 包名 / 设置命名空间 / 客户端 bundle：`dsh-memory-scoped`
- 本包只修改公开发布副本；生产 DSH、真实配置、会话、长期记忆未修改。
- 未上传 GitHub。

## 1. 自动检查

| 项目 | 结果 |
|---|---|
| 单元测试 | 187 tests / 184 pass / 3 skip / 0 fail |
| MCP 安全 | merge 计划统一由 `store.planMergeEntries()` 生成；content/tags 全参与者预检；落盘前校验同一计划；22/22 磁盘+journal 级测试通过 |
| 集成 harness | 上一轮 `abc`, `wechat`, `partial`, `deferred`, `fault` 全部通过；本轮 MCP 修复未重跑（工作区缺 peer 包），curator 代码未改 |
| 工作区总量 | A=8/B=6/C=6 合计 20，由 owned session pending 求和，不使用 `lifetimeTurns` |
| 跨会话批处理 | 17 会话 3 批（8+8+1），最终 pending 0 |
| 每会话游标 | 成功/空结果只推进本会话；失败保留 pending；新回合不被清零 |
| 来源追溯 | A/B/C provenance 指向各自 session；attribution 接收 transcript lines |
| 微信 process 桥接 | 合成 `dsh-im/new-session` 被实际监听；非私人 workspace 忽略 |
| 故障恢复 | raw 1 后 cursor 保存失败：pending 6/cursor 0；重试 raw 1/cursor 6/pending 0 |
| 补丁矩阵 | uninstalled/installed/repeat/source-only/bundle-only/mismatch/**comment-only/mixed/duplicate** 全部通过 |
| `--check` | 只有完整 source+bundle 代码块都在才 0；注释标记不通过 |
| release check | 通过；反向测试中 187 项含 1 失败时正确返回 1 |
| 迁移守卫 | 仅旧包时提示移除；同时存在旧包+scoped 时返回 1 |
| 脱敏 | 真实用户目录/assistant 名称/workspace/session ID 0 匹配 |
| ZIP | 全部 POSIX `/`，无 `node_modules` |
| 文档路径 | `examples/config.example.yml` 等必需文件存在，独立下载路径检查通过 |

## 2. 主要修复

1. **结构化补丁校验**：`stateOf()` 要求 `sourceNew`/`bundleNew` 各唯一、旧分支不存在；
   mixed old+new 和 duplicate new block 都不算安装。补丁矩阵新增 comment-only、mixed、duplicate 反向用例。
2. **release check 不忽略失败**：检查测试进程 `status` 和 `fail` 计数；新增
   `scripts/check-release-negative.mjs`，构造 187 项含 1 失败，确认返回非零。
3. **命名迁移**：以公开 `dsh-memory-scoped` v0.1.0 为基线移植工作区调度；保留
   包名、loader row ID、设置命名空间、客户端 bundle。新增 `MIGRATION.md` 和只读
   `scripts/check-migration.mjs`，禁止旧包与新包同时加载。
4. **旧部署脚本**：未放入最终包；`scripts/` 只保留 release/migration 检查，没有
   `start-dsh-logged.ps1`、`restart-dsh.ps1`、`sync-install.ps1`、
   `verify-after-restart.ps1`。
5. **文档一致性**：README/README.zh/AGENTS/DESIGN/ROADMAP 统一写明
   `allowSecret` 绕过参数已删除，不存在；`FORK-NOTES` 改为工作区统一累计。
6. **运行行为回归**：单元 + 集成 + 故障恢复 + 迁移守卫复测。
7. **MCP 安全（P0）**：删除 `allowSecret` schema 与绕过分支；`memory_update`、
   `memory_merge` 补上凭据扫描；移除 `DSH_MEMORY_REDACT=0` 关闭写入拒绝的能力；
   作用域改为白名单（`DSH_MEMORY_ALLOWED_ROOTS`）且 `global` 默认拒绝；新增
   `test/mcp.security.test.js` 并把 MCP 安全检查接入 `check-release`。
8. **MCP 第二轮审核修复**：`memory_merge` 拒绝重复 ID（原 `targets.length` 比较可被
   重复 ID 绕过）、校验全部目标与 `keepId`、写入前检查最终 content 与合并 tags；
   add/update/merge 均检查最终 tags；update 校验写入后的最终状态，历史含凭据条目
   不能通过改 importance/tags 继续保留。新增 6 项磁盘级回归，安全测试共 16 项。
9. **MCP 第三轮根因修复**：合并计划抽为 `lib/store.js` 的唯一纯函数
   `planMergeEntries()`；`mergeRawEntries(ids, keepId, { validate })` 在 `writeAtomic`
   前把**即将写入的同一计划**交给校验器，消除请求顺序/存储顺序、等长 content、
   16 项 tag 上限导致的“预检查对象 ≠ 落盘对象”。所有参与条目的 content 与 tags
   都扫描；`memory_delete` 的 journal 快照对含凭据条目的 content/tags 脱敏；
   `normalizeTags` 与 MCP 的未知 scope/tool、缺失条目错误不再回显输入。
   新增 `test/merge-plan.test.js` 与排列组合用例，安全测试 22 项。

## 3. 限制

- 真实微信 `/new` 未发送；只有合成 process 事件和 dsh-im 补丁矩阵。
- 真实外部模型 20 轮未调用；harness 使用确定性 stream。
- 完整 DSH Desktop 重启未执行；见 `RESTART-CHECKLIST.md`。
- 后台自动创建的新鲜私人根会话仍无法与用户主动新建完全区分。
- 超过 64 个待整理会话仍会 deferred。
- dsh-im 升级后需要重新运行补丁；模式失配会 fail-loud。

**不能声明“可直接公开”**；上述人工项未完成。
