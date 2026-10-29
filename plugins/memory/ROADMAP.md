# ROADMAP — dsh-memory-scoped 0.2.0

## 已完成

- 私人工作区精确隔离；根会话 gating；子代理排除。
- 14 个 `memory_*` 工具；无 `allowSecret` 绕过；凭据检测。
- 每轮有效回合计数 + 每 session 游标。
- 工作区总量累计（owned 会话 pending 之和；不使用 `lifetimeTurns`）。
- 跨会话分批 curator；最多 8 批/64 会话；deferred 记录。
- 来源 attribution、provenance、curator-log、summary CAS、原子写。
- 桌面新建 `startup` 触发；`resume` 不触发。
- 微信 `/new` 本地 dsh-im process 事件桥接（需补丁）。
- 失败/空结果/部分写入恢复；raw 成功后 cursor 保存失败回滚。
- 已认证控制台和工作区参数面板。
- 可复现集成 harness（A/B/C、微信事件、partial、17 会话、fault）。
- 发布包脱敏、POSIX ZIP、SHA256、补丁矩阵、check-release。

## 未完成/待人工验收

- 真实微信 `/new` 端到端。
- 真实外部模型 20 轮输出质量。
- 完整 DSH Desktop 重启后的冷启动验证。
- 控制台 UI 的视觉/点击回归。
- 后台创建的 fresh private root 与用户主动新建的区分。
- 超过 64 个待整理会话的自动继续（当前留 deferred）。
- dsh-im 升级后的补丁重放（脚本会 fail-loud，但仍需人工执行）。

## 不做

- 不重写存储/合并引擎。
- 不恢复已删除的旧会话/记忆。
- 不修改 DSH 官方核心。
- 不提供操作系统级文件隔离。
- 不自动上传 GitHub 或自动发送微信消息。
