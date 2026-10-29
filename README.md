# DeepSeek Harness Private AI Workspace · v0.1.0 技术预览版

> **技术预览版 / 非一键安装**：这是一套从实际使用的 DSH 本地扩展中整理、脱敏的参考实现。
> 单元与隔离测试已在 Windows 和 Linux（部分 Windows 专用测试会跳过）复核；**尚未完成干净环境完整安装、真实微信端到端链路与跨平台运行的全面验证**。
> 请先阅读 [功能状态](STATUS.md)、[安装指引](INSTALL.md)及[安全审计](review/SECURITY_AUDIT.md)。

## 架构图

![DeepSeek Harness 私人 AI 工作区架构图](./DeepSeek%20私人%20AI%20工作区架构图.png)

> 图片为**总体架构和演进蓝图**：其中“跨会话累计 20 轮”及“新建会话立即整理”为**规划功能，不属于 v0.1.0 的已实现范围**。以本 README 和 [STATUS.md](STATUS.md) 的功能状态为准。

## 关键链接

- [安装与复现说明](INSTALL.md) · [详细架构与信任边界](ARCHITECTURE.md) · [功能状态](STATUS.md)
- [隐私与安全审查](review/SECURITY_AUDIT.md) · [测试记录](review/TEST_RESULTS.md) · [第三方许可](THIRD_PARTY_NOTICES.md)
- 上游：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[dsh-memory](https://github.com/haitang1/dsh-memory)、[dsh-im](https://github.com/xmanrui/dsh-im)


## 命名约定

本包统一使用三个匿名名称：

- **私人工作区**：唯一允许使用长期记忆、并绑定 IM 的工作区；
- **工作区 A**、**工作区 B**：其他工作区，只能单向发送通知，不能读写私人记忆。

示例路径 `C:\Workspaces\private`、`C:\Workspaces\work-a`、`C:\Workspaces\work-b`
都是占位符，请替换为你自己的目录。

## 这是什么

一套运行在 **DeepSeek Harness** 上的「私人工作区」个性化框架：

- 一个只对指定工作区开放的**长期记忆**插件（后台模型定期整理、来源可追溯、带认证
  控制台）；
- 一个按工作区隔离的**会话删除**插件修改版（级联子代理、不误删长期记忆）；
- 一套“私人工作区接微信、工作区 A/工作区 B 只能单向发通知”的**共享通知**脚本；
- 人设/记忆规则/配置模板，以及可复现的测试与审计材料。

它解决的具体问题是：让 AI 助手在**私人工作区**里长期记住你，同时让工作区 A、工作区 B
既看不到也写不进这份记忆；并且让这些工作区能主动通知你，但拿不到微信的回复权限。

**重要边界**：这里的“看不到/写不进”是 Harness 的**工具与提示词隔离**，不是操作系统
级文件隔离。详见下文“这不是操作系统级隔离”。

## 首版范围

第一版只包含：

1. 核心记忆插件（`plugins/memory/`）；
2. 会话管理插件修改版（`plugins/session-manager/`）；
3. 通知脚本（`scripts/notify/`）；
4. 配置/人设/记忆规则模板（`examples/`）；
5. 测试与审计材料（`tests/`、`review/`）。

**可选组件不在 v0.1.0 公开范围内**，见文末“可选组件”。

## 目录

```text
dsh-private-ai-workspace/
├── .gitignore               排除真实配置、密钥、记忆、日志、队列、备份、依赖
├── README.md                项目主页
├── INSTALL.md               从干净环境复现的 14 步
├── ARCHITECTURE.md          组件、数据流、信任边界
├── STATUS.md                已完成 / 未实现 / 未验证
├── THIRD_PARTY_NOTICES.md    逐组件许可证核查
├── LICENSE.md               组件级许可与修改说明
├── plugins/
│   ├── memory/              dsh-memory-scoped（上游 fork，含测试）
│   └── session-manager/     session-cascade-delete（上游 1.0.6 修改版，含测试）
├── examples/                人设、记忆规则、全局规则、profile 配置、标签
├── scripts/notify/          单向通知脚本 + 主机发现 + 示例配置
├── tests/                   一键跑全部测试 + 隐私扫描 + 验收用例
└── review/                  文件清单、安全/许可/复现审计、测试结果
```

## 已实现（有代码 + 单元测试）

- 长期记忆：注入、14 个工具、按**会话**累计有效回合、后台 curator、provenance、
  journal/历史/回滚、并发锁与原子写、凭据拒绝。
- 记忆控制台：列表/搜索/筛选/增删改/来源与证据/历史恢复/整理记录/参数设置。
- 鉴权 fail-closed：没有 `connection.requestRejection` 时返回 503，没有 loopback
  降级。
- 会话删除：模型工具按调用方工作区隔离；删除成功后通知记忆插件清理 pending 状态，
  不删除长期记忆。
- 通知：运行时发现 Host 端口、进程归属校验、去重、失败队列、显式补发。

## 未实现 / 未验证（不要宣传成已完成）

- **全工作区统一累计回合：未实现。** 当前是**每个会话**独立累计 20 个有效回合。
- **新建会话立即整理：未实现。** 新建私人会话只会在 60 秒后触发一次“非活跃会话
  兜底扫描”，不会立即整理该会话。
- 微信 `/new` 触发整理：未验证；依赖上游 `dsh-im` 的事件映射。
- 真实 20 轮后 curator 成功写入的端到端链路：未验证。
- 干净环境安装：未复现。
- 微信以外的 IM 平台：未验证。
- 控制台 UI 视觉回归：未验证。
- Linux / macOS 上的实际 DSH 插件运行：尚未验证；本项目发布前已在 Linux / Node.js 22 上独立复测核心单元测试（详细结果见下文）。
- 看门狗 / 自动恢复：无可靠修复与测试证据，未纳入。

完整清单见 `STATUS.md`。

## 安全要点

- 记忆只对 `privateWorkspace` 的**精确路径 + 根会话**开放；子代理默认排除。
- 管理接口只认 DSH 的 `connection.requestRejection`，缺失即 503。
- 删除工具在每次删除前重新读取工作区注册表；归属不明一律拒绝。
- 通知只发文字，`botId`/`targetId` 只读自中央配置，没有入站/回复路径。
- **已知残留风险**：本地 IM 投递接口本身无认证，任何本机进程知道端口即可直接
  POST。这是上游插件的行为，本包没有修复，详见 `review/SECURITY_AUDIT.md`。

### 这不是操作系统级隔离（重要）

上面的“工作区隔离”只发生在 **Harness 的模型工具层和提示词层**：

- 它决定哪个会话能看到 `memory_*` 工具、能拿到记忆注入；
- 它**不改变文件系统权限**。

如果工作区 A/工作区 B 的 Agent 与你登录的是同一个系统用户，并且它拥有任意文件读取
能力（例如 `read`、`Get-Content`、`pwsh`），它仍然可以直接读取该用户有权访问的
`<memoryDir>`；同理也能读取通知脚本和本地配置。工具隔离不阻止这种访问。

需要真正的 OS 级隔离时，至少选择一项：

- 用独立的系统账户运行私人工作区的 Host；
- 用 NTFS ACL / 文件权限把 `<memoryDir>` 限制给专用账户；
- 在沙箱、虚拟机或容器里运行其他工作区的 Agent；
- 不把任意文件读取 / shell 工具授予不可信工作区。

**本方案不提供绝对安全隔离**，也不声称能阻止同一系统用户权限下的直接文件访问。

## 快速开始

见 `INSTALL.md`。最短路径：

1. 放好两个插件目录；
2. profile `package.json` 加 link 依赖与 bundle；
3. profile `cordis.patch.yml` 写入 `privateWorkspace` 与策略；
4. 重启 DSH；
5. 私人工作区根会话验证 `memory_*` 工具；工作区 A、工作区 B 验证看不到；
6. 打开设置 → “私人工作区记忆”。

## 测试

```powershell
cd tests; .\run-all.ps1
```

Windows 原始验收：记忆 152 项（149 通过 / 3 跳过 / 0 失败）、会话删除 14 项通过、验收用例 10 项通过。
独立 Linux / Node.js 22 复核：记忆 149 通过 / 3 跳过，会话管理 14 通过，验收 9 通过 / 1 项 Windows 专用用例跳过。
以上**不等于完整 DSH 插件在 Linux 环境中安装或运行成功**。候选包原始 Windows 测试详情见 `review/TEST_RESULTS.md`。

## 可选组件（不在 v0.1.0 公开范围内）

以下组件曾被评估，但**没有**放进首版候选包：

| 组件 | 许可证/来源状态 | 结论 |
| --- | --- | --- |
| 推理强度滑块 `dsh-codex-effort-slider` | MIT 文本存在，但 `package.json` 没有 repository/author，上游归属未核实 | 暂不收录；补核来源后再考虑 |
| 公开行情 Skill `okx-cex-market` | `SKILL.md` 声明 MIT、作者 okx，但原目录无独立 LICENSE，移植改动需单独说明 | 暂不收录；作为可选 Skill 单独发布 |
| `@local/reply-chime`、`schedule-gate`、`skills-panel` | 无 LICENSE（`private: true`） | 不收录 |
| 微信看门狗 / 自动恢复 | 计划任务已禁用、历史故障、无测试证据 | 不收录 |

## 许可

组件级许可见 `LICENSE.md`，第三方核查见 `THIRD_PARTY_NOTICES.md`。本包不包含
DeepSeek Harness 与 `@xmanrui/dsh-im` 的源码。

## IM 渠道说明

通过第三方 [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 接入即时通讯。**本方案只实际使用和验证过微信**；QQ、飞书、Telegram 等是上游插件所支持的渠道，不能据此认定本仓库的自定义通知和权限方案已在这些平台通过验证。

本项目为非官方社区技术实践，**与 DeepSeek 官方无隶属或背书关系**。

## 致谢

- DeepSeek Harness（MIT, DeepSeek）
- `dsh-memory` 上游作者（MIT）
- `dsh-plugin-session-cascade-delete` 作者 liuyu-f / lsz-asd（MIT）
- `dsh-im` 作者 xmanrui（MIT）
