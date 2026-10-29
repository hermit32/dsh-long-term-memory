# v0.2.0 功能状态与限制

**本项目的首要目标是为 DeepSeek Harness 提供长期记忆解决方案。** 本表区分“有代码”“自动化测试通过”“真实用户环境端到端验收”。标记不是对生产可靠性的保证。

| 能力 | 状态 | 依据与限制 |
| --- | --- | --- |
| 工作区级统一有效回合计数（默认 20） | ✅ 逻辑测试 | owned 私人根会话的 `pendingTurns` 总和；不使用 `lifetimeTurns` |
| 跨会话 Curator 整理（按会话独立游标、来源） | ✅ 隔离集成有证据 | A=8/B=6/C=6 的历史模拟模型 harness，实际写入 3 条、pending 归零；最新 MCP 修复后未重跑 harness |
| 多会话批量与 deferred | ✅ 隔离集成有证据 | 17 会话分 8+8+1；每个任务最多 64 个会话，剩余待下一次触发 |
| 新建私人会话触发、`resume` 排除 | 🟡 模拟事件通过 | `agent/created` 的 `startup` 会触发；后台自动新鲜根会话可能误触发；未完成冷启动实测 |
| 微信 `/new` 桥接 | 🟡 事件/补丁测试通过 | 需要安装 [`patches/`](patches/README.md) 补丁；真实微信命令未发送验证 |
| 记忆注入 / 14 个工具 / 控制台 | ✅/🟡 自动测试 | 提示词注入、来源、搜索、编辑、版本/回滚有测试，浏览器 UI 视觉回归未完成 |
| Curator attribution、防无来源新增 | ✅ 逻辑与隔离 harness | transcript lines 传给归因；来源会话和事件记录在 provenance 中 |
| 成功写入后游标保存失败的重试 | ✅ 隔离故障注入有证据 | pending 保留且重复写入被去重；未在真实 LLM/真实 Host 中注入故障 |
| 独立 MCP 的凭据拒写 / 作用域白名单 | ✅ 本地安全测试 | 22/22 通过；包括内容、标签、合并计划、journal 删除快照。历史读取不自动脱敏 |
| 宿主 Cordis 工具与 MCP 安全策略完全一致 | ⚠️ **尚未完成** | 宿主 `memory_merge`/`memory_delete` 未完全同步 MCP 专项校验；不能误称全入口加固 |
| 会话删除（修改版） | ✅/🟡 单元测试通过 | v0.1.0 既有 14/14；真实 Host 端到端删除未执行 |
| 其他工作区单向通知 | 🟡 代码与部分验证 | Windows PowerShell 脚本；真实 IM 发送本次未复验；本地投递接口无认证 |
| 工作区隔离 | ✅ 应用层 | 记忆工具/提示词层隔离，不提供 OS 文件系统隔离 |

## 本轮发布验收

- `plugins/memory`: **187 tests / 184 pass / 3 skip / 0 fail**（独立 Linux Node 22.16.0 复测）。
- `test/mcp.security.test.js`：**22 项全部通过**；补丁矩阵、发布反向检测通过。
- `plugins/session-manager`: v0.1.0 既有 **14 项通过**，本次未修改该插件。
- `plugins/memory/acceptance/curator-harness.mjs`: 早前在具备 DSH peer 的隔离环境运行 `abc/wechat/partial/deferred/fault` 有通过证据；**最新轮次未能独立复跑**。
- Windows DSH Host 实际插件热加载的历史报告存在，但**完整 Desktop 重启未执行**。

## 未验证与边界

1. 真实微信用户发送 `/new` 到 dsh-im、触发后台整理并检查数据。
2. 使用真实外部模型整理跨会话 20 个有效回合。
3. DSH Desktop 完整冷启动，以及从公开 v0.1.0 实际部署升级的迁移。
4. 干净环境照文档从零安装；Linux/macOS 的 DSH 桌面插件加载。
5. 记忆控制台浏览器点击与视觉回归。
6. 同一系统账户下的其他 Agent 拥有任意文件读取工具时，仍可读取记忆文件。
7. IM 只验证过微信通道的既有使用场景；其他 IM 渠道、看门狗不包含在本方案的验收范围。

详细证据见 [v0.2.0 验收记录](review/v0.2.0/ACCEPTANCE.md) 和 [TEST-REPORT](review/v0.2.0/TEST-REPORT.md)。旧版状态保留在 Git 历史中，不应与 v0.2.0 当前功能混淆。
