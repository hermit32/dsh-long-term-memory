# SECURITY_AUDIT.md — 发布候选包安全审查

- 审查对象：`DSH-PUBLIC-RELEASE-REVIEW/`（82 个文本文件；包内没有图片、数据库、
  日志或备份，非文本文件只有矢量图标 `icon.svg` 和各许可证文本）
- 审查日期：2026-10-29
- 审查方式：自动模式扫描 + 逐目录人工核对 + 与运行环境比对
- 结论：**未在候选包中发现未处理的敏感信息。** 但自动扫描通过不等于安全，仍需独立
  人工审核（见文末“残留风险”）。

---

## 1. 扫描方法

1. **类别扫描**：`tests/privacy-scan.ps1` 对全部文本文件逐行匹配以下类别，只输出
   文件、行号、类别，不打印命中内容：
   - 本机用户目录（`<盘>:\Users\<名称>`）
   - 工作区 ID（`ws-` + 16 位十六进制）
   - IM bot / target / user 标识（`wx_*`、`tgt_*`、`*@im.wechat`、`*@im.bot`）
   - 常见密钥前缀（`sk-`、`ghp_`、`xox*-`、`AKIA*`）
   - 私钥头
   - 手机号、邮箱
   - 真实形态的会话 UUID
   - `DSH_*TOKEN*` 环境变量名
2. **人工核对**：对每个纳入目录逐个文件确认来源；对 `lib/`、`src/` 中的路径常量、
   默认值、日志格式做定点检查。
3. **反向核对**：在**生产目录**里搜索同一批模式，确认敏感数据的实际位置，然后逐项
   确认它们**没有**进入候选包（见第 3 节）。
4. **二进制检查**：不收录任何截图、图片、数据库、日志、备份。唯一的非文本文件是
   `icon.svg`（矢量图标，无元数据）与各 `LICENSE`/`LICENSE.md`。
5. **项目专用字面量检查（不随包分发）**：构建阶段另外用本项目历史上用过的昵称、
   用户名、工作区 ID 做了一次全文复查，最终计数为 0。这一步**没有**写进
   `tests/privacy-scan.ps1`，因为把真实昵称写进扫描脚本本身就是泄露；发布者如要
   复核，请在本地用 `-ExtraPatterns` 传入自己的黑名单。

## 2. 扫描结果

```text
[privacy-scan] scanned 82 text files
[privacy-scan] OK: no personal-data pattern matched
```

- 初始扫描有 2 处命中，均为**合成测试夹具**（`session-11111111-1111-4111-8111-111111111111`），
  已加入扫描器白名单并注明。
- 测试目录内存在若干**假密钥**（以 `sk-` 开头的合成字符串等），用于验证
  `detectSecrets` 确实会拒绝凭据。扫描器对 `test/` 与检测器源码的“密钥形态”类别
  豁免，其余类别照常扫描。本报告刻意不复述这些字符串，避免审计文档本身触发扫描。
- 未发现真实 API Key、Token、Cookie、IM 凭据、手机号、邮箱、真实会话 UUID。

## 3. 生产环境中发现、但**未**进入候选包的敏感数据

只报告位置与类别，不记录内容。

| 位置 | 类别 | 处理 |
| --- | --- | --- |
| `<DSH_HOME>/.credentials.yaml` | 账号/凭据存储 | 完全排除 |
| `<DSH_HOME>/integrations/dsh-weixin/config.json` | botId、ownerUserId、tokenRef、baseUrl | 完全排除；不提供示例值以外的字段 |
| `<DSH_HOME>/integrations/dsh-weixin/workspaces.json` | bot→工作区绑定、deliveryTarget、allowlist 用户 ID | 完全排除 |
| `<DSH_HOME>/assistant/notify-config.json` | botId、targetId、本机 appExe 绝对路径 | 完全排除；提供占位符模板 |
| `<DSH_HOME>/assistant/notify-state.json`、`notify-queue*.jsonl`、`logs/` | 去重状态、队列、发送日志（含消息正文） | 完全排除 |
| `<DSH_HOME>/memories-<private>/**` | 私人长期记忆原文、摘要、provenance、curator 日志 | 完全排除；测试使用临时目录 + 合成数据 |
| `<DSH_HOME>/sessions/**` | 聊天/执行记录 | 完全排除 |
| `<DSH_HOME>/storages/workspace.json` | 真实工作区 ID 与绝对路径 | 完全排除 |
| `<DSH_HOME>/storages/schedule.json`、`schedule-gate.json` | 定时任务内容与状态 | 完全排除 |
| 私人工作区根目录 `AGENTS.local.md` / `CLAUDE.md` / `AGENTS.md` | 私人角色描述、个人偏好、通知规则 | 完全排除；重写为 `examples/` 中性示例 |
| `<DSH_HOME>/AGENTS.md` | 全局通知规则（含真实路径与用户名） | 完全排除；重写为 `examples/AGENTS.global.example.md` |
| `<DSH_HOME>/assistant/backup/**` | 上述所有内容的备份（含截图） | 完全排除 |
| 插件 `CHANGELOG.md` / `docs/STATUS.md` / `docs/ROADMAP.md` / `FORK.md` | 含真实工作区 ID、本机路径、备份路径 | 不收录；`FORK-NOTES.md` 重写为中性版 |
| 备份截图 `assistant/backup/**/screenshots/*.png` | UI 截图，可能含会话标题/头像 | 完全排除 |
| 可选组件目录（推理强度滑块 / 行情 Skill） | 来源或独立许可证未完全核实；含 UI 截图 | 整体移出首版候选包，见 `THIRD_PARTY_NOTICES.md` |
| 会话删除插件 `docs/manual-*.png` | 上游截图（公网可获取） | 排除，保留上游链接 |

## 4. 已脱敏内容与脱敏方式

| 对象 | 原形态 | 发布包形态 |
| --- | --- | --- |
| 私人工作区绝对路径 | 本机用户目录 | `C:\Workspaces\private`（示例） |
| 第二/第三工作区路径 | 本机其他盘符路径 | `C:\Workspaces\work-a`、`C:\Workspaces\work-b` |
| 真实工作区 ID | `ws-<16 hex>` | `ws-0123456789abcdef` |
| 私人角色昵称 | 中文昵称 | “私人工作区”（文档）/ “助手”（代码语义） |
| 包名 / 模块名 | `dsh-memory-<昵称>` | `dsh-memory-scoped` |
| 默认 `privateWorkspace` | 本机用户目录 | `''`（留空即禁用，必须显式配置） |
| 通知 `appExe` 默认值 | 本机安装路径 | `''`（必须由 `notify-config.json` 提供） |
| 开发端口 | 本机一次运行的实际端口 | `18080`（客户端测试夹具） |
| 版本号 | `<x>-<昵称>.N` | `<x>-local.N` |

脱敏后功能验证：`plugins/memory` 测试 152 项（149 通过 / 3 跳过 / 0 失败），
`plugins/session-manager` 14/14，`tests/acceptance` 10/10。测试通过说明改名没有
破坏导入路径、设置命名空间或客户端 bundle 身份。

## 5. P0 安全修复核对

| P0 项 | 当前代码证据 | 测试证据 |
| --- | --- | --- |
| 旧设置端点未认证 | `lib/auth.js` 只认 `connection.requestRejection`，缺失返回 503；`web.js` / `console-web.js` 均先调用 | `web-settings.test.js`（fail-closed + 401）；`console-web.test.js`；`tests/acceptance` |
| 会话删除跨工作区 | `src/workspace-scope.js` + `src/index.js` 的 `resolveCallerWorkspace` / `assertTargetInCallerWorkspace`；删除前重读注册表 | `session-tool-scope.test.js` 6 项、`workspace-scope.test.js` 8 项 |
| 摘要 scrub 误删相似记忆 | `lib/summary-scrub.js` 只用归一化 exact match | `summary-scrub-exact.test.js`；`tests/acceptance` |
| 删除会话状态残留 | `lib/session-ledger.js` + `session-delete/deleted` 监听 + “确认不存在才清” | `session-ledger.test.js`；`tests/acceptance` |

未认证管理接口的验证方式：`memoryRequestRejection({ get: () => undefined }, ...)`
返回 503；`requestRejection` 返回 401/403 时原样拒绝；抛异常时按 403 拒绝。
**没有任何 loopback / same-origin 降级代码。**

## 6. 功能安全边界（设计层面）

- 记忆工具在注册前、执行前各校验一次 `isPrivateRoot`；非私人 agent 额外 `deny` 工具。
- 控制台请求体只能带 `action` 与记忆字段，不能带工作区、scope、目录、文件路径。
- 凭据检测没有 `allowSecret` 之类的绕过参数。
- 通知脚本只接受文本参数，不执行命令；目标 bot/target 只读自本机配置。
- `session_delete` 的模型工具与 UI 路由权限不同：UI 是用户全局管理，工具被工作区
  范围限制。

### 6.1 这些边界不是操作系统级文件隔离（重要）

上述隔离全部位于 **Harness 的模型工具层与提示词层**，不改变文件系统 ACL：

- 它只保证：非私人工作区的**会话**看不到 `memory_*` 工具、拿不到记忆注入、
  调不到删除工具；
- 它**不保证**：同一系统用户下的其他进程/Agent 无法读取 `<memoryDir>`。

如果工作区 A、工作区 B 的 Agent 与私人工作区使用同一个 Windows 用户，并且拥有任意文件读取
工具（`read`、`Get-Content`、`pwsh`、Python 等），它仍然可以直接读取该用户可访问的
记忆文件、`notify-config.json` 与插件源码。**工具隔离不等于 OS 隔离。**

需要更强隔离时，必须引入 Harness 之外的手段：

1. 用独立系统账户运行私人工作区的 Host；
2. 用 NTFS ACL 把 `<memoryDir>` 只授权给该账户；
3. 在沙箱 / 虚拟机 / 容器中运行其他工作区；
4. 移除不可信工作区的文件读取与 shell 权限。

本方案**不宣称**提供绝对安全隔离，也不声称能阻止同权限下的直接文件访问。公开文档
（`README.md`、`ARCHITECTURE.md`）与此处表述一致。

## 7. 残留风险（必须由人工评审确认）

1. **同用户文件系统访问（设计边界，不是缺陷）**。记忆工具/提示词隔离不阻止同系统
   用户的其他 Agent 直接用文件读取工具读取 `<memoryDir>`。这是本方案的能力边界，
   不是可以靠插件配置修掉的问题；需要 OS 级隔离时见 6.1。
2. **本地 IM 投递接口无认证**。`notify.ps1` 只校验“loopback + 进程可执行文件匹配 +
   路由探测”，但任何本机进程知道端口后都可以直接 POST 到
   `/api/dsh-im/delivery/messages`。这是上游 `@xmanrui/dsh-im` 的接口设计，本包没有
   修复。缓解：不要把 Host 端口暴露到局域网/公网；把机器视为单用户可信环境。
3. **管理接口依赖 `connection` 服务**。组合里没有该服务时接口返回 503——安全，但
   控制台不可用。这是有意的 fail-closed。
4. **记忆数据静态明文**。`raw_memories.md`、`memory_summary.md` 是普通文本，依赖
   操作系统文件权限；没有加密。备份/同步这些目录时要注意。
5. **路径比较不解析符号链接/联接点**。`privateWorkspace` 是字符串精确比较；用
   junction 把另一个目录映射到私人工作区路径，理论上可绕过。未测试。
6. **指令文件作用域**。DSH 从 project root 到 cwd 逐级加载 `AGENTS.md`/
   `AGENTS.local.md`。如果一个工作区的根是另一个工作区的祖先目录，persona 可能
   被下层工作区看到。`examples/AGENTS.local.example.md` 已写明检查方法，但本包
   没有自动检测。
7. **删除不可撤销**。`session_delete` 有工作区隔离，但删除本身没有回收站。
8. **测试夹具含假密钥**。这是检测逻辑的测试数据，不是真实凭据；独立扫描时应预期
   在 `test/` 下看到它们。
9. **未做 Git 历史审查**。本包不是从某个仓库 clone 出来的，没有 `.git`；如果发布
   时新建仓库，请确认不要把本机的备份/日志一起 `git add`。

## 8. 未纳入安全审查的范围

- DSH 本体、`@xmanrui/dsh-im` 上游代码、Windows 看门狗脚本、备份目录、生产记忆
  数据、微信会话内容。
- 运行中的 Host 端口、本机网络配置、防火墙规则。

## 9. 结论

- 候选包内未发现未处理的敏感信息；所有已知敏感源都被排除或替换为占位符。
- 脱敏没有破坏测试覆盖的关键功能。
- **本审查不能替代独立人工安全审核。** 发布前至少复核第 7 节的 1、4、5 三项。
