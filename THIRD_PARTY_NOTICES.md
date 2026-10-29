# THIRD_PARTY_NOTICES.md

本 v0.2.0 技术预览版包含第三方代码的修改版。逐项核对结果如下。许可证原文保留在各组件
目录内；本文件只做索引与合规说明。

## 1. 随包分发的组件

| # | 组件 | 版本 | 许可证 | 版权 | 本包中的位置 | 是否修改 | 再分发 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | DeepSeek Harness（`@deepseek-ai/dsh-*`） | 0.2.1-rc.3 | MIT | Copyright (c) 2026 DeepSeek | 未分发；仅作为运行环境 | 否 | 不需要（未复制） |
| 2 | `dsh-memory`（上游） | v0.5.0 / commit `15de1c7` | MIT | Copyright (c) 2026 dsh-memory contributors | `plugins/memory/` | **是**（fork） | 允许，保留 LICENSE |
| 3 | `@liuyu-f/dsh-plugin-session-cascade-delete` | 1.0.6 | MIT | Copyright (c) 2026 liuyu-f；Copyright (c) 2026 lsz-asd | `plugins/session-manager/` | **是**（本地修改版） | 允许，保留 LICENSE |
| 4 | `@xmanrui/dsh-im` | 5.6.0 | MIT | Copyright (c) 2026 xmanrui | 未分发；`INSTALL.md` 给出安装链接 | 否 | 不需要（未复制） |

## 2. DeepSeek Harness

- 上游：<https://github.com/deepseek-ai/deepseek-harness>
- 本机实测版本：desktop runtime `0.2.1-rc.3`。
- 本包**没有**复制 DSH 源码。文中引用的模块名（如
  `@deepseek-ai/dsh-agent-instructions`）仅用于说明接口。
- DSH 桌面应用本身由其发布方分发；MIT 许可适用于 npm 包。

## 3. dsh-memory（记忆插件上游）

- 上游：`haitang1/dsh-memory` v0.5.0，commit `15de1c7`。
- 保留 `plugins/memory/LICENSE`（MIT，Copyright (c) 2026 dsh-memory
  contributors）。
- 修改说明：`plugins/memory/FORK-NOTES.md`（工作区隔离、按工作区统一累计回合触发、跨会话 curator、
  provenance、控制台、P0 安全修复、匿名化改名）。
- 本版包含公开候选的 README、CHANGELOG、DESIGN、ROADMAP 与测试/验收说明。具体 fork 范围见 FORK-NOTES.md。

## 4. session-cascade-delete

- 上游：<https://github.com/liuyu-f/dsh-plugin-session-cascade-delete> 1.0.6。
- 保留完整 `LICENSE`，其中包含 liuyu-f 与 lsz-asd 两条版权行；`package.json` 的
  `author` / `contributors` 字段原样保留。
- `icon.svg` 取自上游仓库（MIT），是本包中唯一的二进制矢量资源；不含个人数据。
- 修改说明：`plugins/session-manager/README.md` 顶部“本地修改版”一节
  （模型工具工作区隔离、`session-delete/deleted` 事件、测试、版本号匿名化）。
- 包名保留上游 scope（`@liuyu-f/...`）是为了让 `cordis.patch.yml` 的加载行仍然
  有效；`package.json` 已标记 `"private": true` 并移除 `publishConfig`，不会被
  误发布到上游 npm scope。**本包没有**向任何 npm 包发布内容。
- **安装提示**：必须用本地 `link:` / `file:` 安装。`dsh plugin add <包名>` 会安装
  上游未修改版，见 README 顶部警告。

## 5. dsh-im

- 上游：<https://github.com/xmanrui/dsh-im> 5.6.0。
- 本包不分发该插件完整运行库；另提供针对上游 5.6.0 的**本地事件桥接补丁** `patches/`（含源代码 diff 和应用脚本），须保留上游 MIT 著作权及许可，不代表上游官方支持。
- 只验证了微信通道；其他通道见 `STATUS.md` 的未验证清单。

## 6. 未纳入的组件

### 6.1 可选组件（来源/许可证待核实，本候选包不收录）

| 组件 | 状态 | 未纳入原因 |
| --- | --- | --- |
| `dsh-codex-effort-slider` 1.1.3（推理强度滑块） | MIT 文本存在；`package.json` 无 `repository` / `author` | 上游归属未核实；首版范围只收核心组件 |
| `okx-cex-market` skill 1.4.3（公开行情 Skill） | `SKILL.md` 声明 MIT、作者 okx；原目录无独立 LICENSE | 需单独补 LICENSE/移植说明，首版不收录；作为可选 Skill 单独发布 |

两者都**不在**本候选包内，`package.json`、测试脚本与文档也不再引用它们。
后续如需纳入，应先补齐：来源确认、独立 LICENSE、修改说明与测试。

### 6.2 因许可证不明确而排除

| 组件 | 原因 |
| --- | --- |
| `@local/reply-chime` | `private: true`，无 LICENSE，无测试 → 许可证不明确 |
| `@local/schedule-gate` | 同上 |
| `@local/skills-panel` | 同上 |
| 微信看门狗 / 自动恢复 | 计划任务已禁用，历史故障，无测试证据 → 许可证与可靠性都不满足 |

## 7. 合规检查清单

- [x] 每个被再分发的 MIT 组件都保留原始版权行与许可全文。
- [x] 每个被修改的组件都有修改说明。
- [x] 未复制 `node_modules` 中的依赖树。
- [x] 未复制上游完整仓库，只取必要源码与测试。
- [x] 许可证不明确的组件未纳入。
- [x] 来源未完全核实的组件移出首版候选包。
- [x] 本仓库原创部分署名为 `miyouchen52-bot`，见 `LICENSE.md`。
