# AGENTS.md — dsh-memory-scoped

## 项目定位

`dsh-memory-scoped` 是 DeepSeek Harness 的单工作区长期记忆插件，基于
`haitang1/dsh-memory` v0.5.0 的受控分支。公开发布包使用 `dsh-memory-scoped`
作为包名、插件 ID、设置命名空间和客户端 bundle ID；**不要改回个人化包名**。

## 当前版本

`0.2.0`。单元测试 187 项（184 pass / 3 skip / 0 fail）。

## 不可破坏的边界

1. `privateWorkspace` 默认空字符串；为空即禁用自动记忆。部署必须显式配置。
2. 只对精确 cwd 的私人工作区 **根会话** 开放；子代理、其他工作区拒绝。
3. 不注册全局技能；不向非私人会话注入记忆。
4. `memory_add` / `memory_update` 始终检测凭据。**不存在 `allowSecret` 绕过参数**；
   文档、工具 schema、测试都不得重新引入它。独立 MCP server 的 add/update/merge
   同样不得引入；content 与最终 tags 都必须扫描。merge 的唯一计划必须来自
   `lib/store.js` 的 `planMergeEntries()`，不得在 MCP 重写“最长内容/标签并集/上限/
   顺序”规则；落盘前必须检查全部参与者与最终结果。其 scope 默认拒绝，只能使用
   `DSH_MEMORY_ALLOWED_ROOTS`。
5. 记忆写入使用锁、原子写、journal 和 summary CAS；不直接改 raw/summary 文件。
6. Curator 只允许 add/update/merge，禁止 delete；每条内容必须能追溯到本批对话行。
7. 工作区调度使用 `pending-turns.json` 的会话游标；不要用 `lifetimeTurns` 触发。
8. 不修改 DSH 官方核心；`@deepseek-ai/*` 只作为 peerDependencies。

## 关键实现

- `lib/index.js`：宿主接线、turn-stopping 计数、workspace curator、事件监听、
  process `/new` 桥接、工具注册。
- `lib/scoped.js`：工作区判定、pending 选择、curator 输入/操作校验。
- `lib/console.js`：控制台快照；`nextIn` 使用工作区 owned 会话总量。
- `lib/curator-log.js`：有界运行日志，保留 `sessionIds`/`deferredSessionIds`。
- `lib/provenance.js`：逐条来源。
- `acceptance/curator-harness.mjs`：临时目录中的真实 Curator 管线测试；不读生产数据。

## 测试与发布

```powershell
node --test
node scripts/check-release.mjs
node ..\patches\test-patch.mjs
node acceptance/curator-harness.mjs all   # 需要 DSH peer packages
```

发布前必须同时通过单元、集成、补丁矩阵、脱敏扫描和 release check。
真实微信 `/new`、真实外部模型和完整 Desktop 重启不能写成“已验收”。

## 迁移

不要同时加载 `<legacy-bundle-id>` 与 `dsh-memory-scoped`；插件 ID、设置命名空间、
客户端 bundle 和包名都不同。检查时用 `scripts/check-migration.mjs --legacy-id
"<old-bundle-id>"`；见 `MIGRATION.md`。
