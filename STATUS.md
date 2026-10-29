# STATUS.md — 已完成 / 未实现 / 未验证

本文件只记录**当前代码和测试能证明**的状态。历史报告里的“已完成”不作为证据。

图例：✅ 有代码且有自动化测试证据 · 🟡 有代码，只有单元/结构测试，缺端到端验收 ·
⬜ 未实现 · ❓ 未验证

## 一、记忆插件

| 能力 | 状态 | 证据 / 说明 |
| --- | --- | --- |
| 精确工作区判定（子目录不匹配） | ✅ | `test/scoped.test.js` 覆盖同名前缀、大小写、斜杠、空值 |
| 只对根会话开放（子代理排除） | ✅ | `isRootSession` + `restrictForAgent`；结构性测试在 `host-wiring.test.js` |
| 非私人会话空注入 | 🟡 | `systemPrompt.context` 逻辑在源码中；无宿主级测试 |
| 14 个记忆工具注册 + 执行前复检 | 🟡 | 注册与 `assertPrivateExec` 在源码；`host-wiring.test.js` 断言接线文本 |
| 按会话累计 20 个有效回合 | 🟡 | `countEffectiveTurn` + `pendingRecord`；状态机有单测，真实 20 轮未跑 |
| 全工作区统一累计 | ⬜ | **未实现**；`lifetimeTurns` 只展示、不参与触发 |
| 新建会话触发整理 | 🟡 | 只触发 60 秒后的**兜底扫描**，不是立即整理新会话 |
| 微信 `/new` 触发整理 | ❓ | 依赖 `@xmanrui/dsh-im` 是否发 `agent/created`；未验证 |
| Curator 严格 JSON / 禁 delete / 条数上限 | ✅ | `test/scoped.test.js`、`curator-store.test.js` |
| Curator 空结果正常 | ✅ | `shouldConsolidateAfterCuration` + `test/scoped.test.js` |
| Curator 凭据内容整批拒绝 | ✅ | `validateCuratorOperations` 测试 |
| 来源归属（evidence 必须对回原文） | ✅ | `test/attribution.test.js`（含“目录列表不能变成共同经历”） |
| provenance 侧车 | ✅ | `provenance.js` + 控制台测试 |
| curator 运行日志（有界 100） | ✅ | `curator-log.js` + `curator-store.test.js` |
| Journal / 历史版本 / 回滚 | ✅ | `store.test.js`（归档、裁剪、列表、恢复） |
| 摘要 exact-match scrub（不误删相似条目） | ✅ | `summary-scrub-exact.test.js`（A/B/C、恢复、paraphrase） |
| 跨进程锁 + 只读降级 | ✅ | `store.acquireLock` 测试 |
| 原子写（tmp + rename） | ✅ | `writeAtomic`；store 测试 |
| 凭据检测（无 `allowSecret` 绕过） | ✅ | `store.detectSecrets` + 工具测试 |
| 注入脱敏 | 🟡 | `redactSecrets` 分支在源码 + 单测；宿主注入未端到端 |
| 控制台：列表 / 搜索 / 筛选 / 增删改 | ✅ | `test/console.test.js` |
| 控制台：来源与证据展示 | ✅ | `console.test.js` + `client.js` 文案测试 |
| 控制台：历史恢复 | ✅ | `console.test.js`（restore-summary / restore-entry） |
| 控制台：curator 记录 | ✅ | `console.test.js` |
| 控制台：参数设置（最小补丁） | ✅ | `test/web-settings.test.js`（含“保存回默认值时不固化默认值”） |
| 未认证管理接口拒绝访问 | ✅ | `console-web.test.js` / `web-settings.test.js`：无 connection → 503；401/403 拒绝 |
| 客户端 bundle 身份 = 包名 | ✅ | `web-settings.test.js` 断言 `dsh-memory-scoped` |
| 控制台 UI 视觉/点击 | 🟡 | 只有客户端 bundle 的结构测试；未做截图回归 |

## 二、会话删除插件

| 能力 | 状态 | 证据 / 说明 |
| --- | --- | --- |
| 永久删除（日志目录/缓存/记账） | 🟡 | 上游实现；本包未在真实 Host 上重跑删除 |
| 级联删除子代理会话 | 🟡 | 上游实现；fork 分支排除逻辑有单测 |
| 模型工具按工作区隔离 | ✅ | `test/session-tool-scope.test.js`（6 项） |
| 无法证明归属时拒绝 | ✅ | 同上 |
| 删除前重读注册表 | ✅ | 代码路径 + scope 测试 |
| 跨工作区枚举/删除漏洞 | ✅（已修复） | 模型工具的 `discover`/`title`/`tree`/`delete` 全部限定调用方工作区 |
| UI 删除路由认证 | 🟡 | `rejectUnauthenticated` 在源码；无自动化测试覆盖该路由 |
| 子代理父链循环/缺失处理 | ✅ | `test/workspace-scope.test.js` |
| 广播 `session-delete/deleted` | 🟡 | 源码 + 记忆侧消费测试；无跨插件端到端 |
| 会话归档与恢复 | — | **DSH 原生功能**，不是本项目自研，本包不提供实现 |
| 删除会话不删除长期记忆 | ✅ | `test/session-ledger.test.js`（只清 pending/owned，不动 raw/summary） |
| 删除后记忆 pending 清理 | ✅ | 同上 + `cleanupDeletedSession` 的“确认不存在才清”逻辑 |

## 三、通知

| 能力 | 状态 | 证据 / 说明 |
| --- | --- | --- |
| 无固定端口，运行时发现 | ✅ | `lib/dsh-host.ps1` 只接受 loopback + 进程归属 + 路由探测 |
| 去重（10 分钟） | 🟡 | 源码完整；无独立自动化测试 |
| 失败入队 + 显式补发 | 🟡 | 源码完整；无独立自动化测试 |
| 工作区 A、工作区 B 只发文字 | ✅ | 接口只接受 `-Message/-Title/-Workspace`，无命令参数 |
| 通知不能取得回复权限 | ✅ | `botId`/`targetId` 只读自中央配置；无入站路径 |
| 每工作区独立状态目录 | ✅ | `notify.ps1` 解析逻辑 |
| 自动重试 | ⬜ | 看门狗已禁用，本包不包含：失败只能手动补发 |
| 本地投递接口认证 | ⚠️ | **无认证**，仅靠 loopback + 进程归属校验；见 `review/SECURITY_AUDIT.md` |

## 四、明确未验证

1. 干净环境从零安装（见 `review/REPRODUCTION_AUDIT.md`）。
2. 微信端 `/new` 与新建会话的真实事件映射。
3. 微信之外的其他 IM 平台。
4. 真实 20 轮之后 curator 成功写入 add/update/merge 的完整链路（P0 修复只验证了
   空结果、跳过、清理路径）。
5. 控制台 UI 的视觉与点击回归。
6. 桌面 App 整包重启后的状态恢复（只做过 profile 热重载）。
7. 看门狗 / 自动恢复（无可靠修复与测试证据，未纳入）。
8. 非 Windows 平台上的测试执行（本轮只在 Windows 运行；验收用例已做平台条件化）。
9. 可选组件（推理强度滑块、行情 Skill、本地 UI 插件）——本候选包不收录，属于可选件，
   不是本框架的必要组成。

## 五、已知限制

- 记忆只服务一个私人工作区；多私人工作区需要多实例或多份配置。
- **工具隔离不等于文件系统隔离**：同一系统用户下、拥有任意文件读取工具的 Agent 仍可
  直接读取 `<memoryDir>`。需要 OS 级隔离时用独立账户 / NTFS ACL / 沙箱。
- 跨进程锁的 stale 判定是 60 秒；Host 两次启动的间隔小于该值时可能出现短暂只读。
- `session_delete` 是删除，不可撤销；模型工具虽然有工作区隔离，仍建议对高风险删除
  保持人工确认。
- 通知脚本依赖 Windows PowerShell 5.1 的 `Get-NetTCPConnection` / `Get-CimInstance`
  （有 `netstat` 回退）。
