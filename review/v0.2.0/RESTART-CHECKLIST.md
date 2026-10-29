> **历史 RC3 验收记录（脱敏副本）**：记录的是发布前候选测试与限制。本文的“未上传 GitHub / 未就绪”描述为当时状态；v0.2.0 已以**技术预览版**形式公开，未完成的真实微信/外部模型/冷启动验收仍然未完成。

# DSH Desktop 冷启动检查

本检查需人工执行；自动测试没有重启 Desktop，也没有终止生产 DSH 进程。

1. 关闭并重新打开 DSH Desktop（不要用强制结束进程代替正常关闭）。
2. 在 profile 的 bundle 列表中确认只有 `dsh-memory-scoped`，没有旧的个人化
   `<legacy-bundle-id>`。可用：

   ```powershell
   node .\dsh-memory-scoped\scripts\check-migration.mjs --profile "$env:USERPROFILE\.dsh\profiles\desktop"
   # 已知旧 bundle ID 时追加： --legacy-id "<old-bundle-id>"
   ```

3. 确认 `dsh-memory-scoped` 和 `@xmanrui/dsh-im` 均 active；没有第二个 memory
   bundle/控制台。
4. 打开 `<memoryDir>/diagnostics.json`：
   - `plugin` 为 `dsh-memory-scoped`；
   - `fixVersion` 为 `workspace-curation-20261029.2-scoped.1`；
   - 工具注册数量与 baseline 一致。
5. 新建一个私人工作区根会话，发送一条真实用户消息并等待助手回复；确认
   turn-stopping 后工作区 pending 增加。
6. 累计到阈值后确认只出现一个 workspace curator run；检查日志
   `sessionIds`/`deferredSessionIds` 和 pending。
7. 打开已有会话/应用启动恢复，确认不会立即重复 curator。
8. 真实微信 `/new` 必须由用户手动发送；确认下一次 diag 出现 `wechat-new`
   触发或对应 `sessionIds`。不要由自动测试发送微信。
9. 记录任何差异；如果 Desktop 起不来，保留日志，不要删除真实 memory/session。

**本检查未自动执行。** 插件热重载不等于冷启动；在完成前不要宣称“已完成完整
重启验收”。
