# MIGRATION — 从个人化包迁移到 `dsh-memory-scoped`

## 标识差异

| 项目 | 旧个人化包 | 本公开包 |
|---|---|---|
| 包名 | 个人化名称 | `dsh-memory-scoped` |
| 插件/加载行 ID | 旧 ID | `dsh-memory-scoped` |
| 设置命名空间 | 旧 ID | `dsh-memory-scoped` |
| 客户端 bundle ID | 旧 ID | `dsh-memory-scoped` |
| 默认 `privateWorkspace` | 可能硬编码 | `''`（必须显式配置） |

**不要同时加载旧包和本包。** 两个 bundle 的 loader row、设置命名空间和客户端
bundle 都不同；同时加载会产生两套工具/控制台和重复 curator。迁移时必须先从
profile `dsh.profile.bundles` 和 `cordis.patch.yml` 移除旧 bundle，禁用旧插件，
再加载本包并重启 DSH。

只读检查命令（旧 ID 不写死在包里，按实际旧 bundle ID 传入）：

```powershell
node scripts/check-migration.mjs --profile "$env:USERPROFILE\.dsh\profiles\desktop" --legacy-id "<old-bundle-id>"
```

## 数据格式

`pending-turns.json`、raw/summary/journal/provenance/curator-log 的格式保持兼容。
如果要把旧数据迁到新安装：

1. 停 Host；确认旧插件不再加载。
2. 复制旧 `memoryDir` 到新的独立目录（不要在原目录上双写）。
3. 新配置的 `memoryDir` 指向该副本；`privateWorkspace` 指向同一工作区。
4. 启动并检查 diagnostics 的 `plugin='dsh-memory-scoped'`、工具注册和
   pending 总量。

`pending-turns.json` 的 `owned`/`sessions` 仍按 session 保存；工作区总量按
`owned` 会话求和。迁移不会自动合并旧包与 scoped 包的不同设置命名空间。

## 风险

- 旧包的客户端 bundle/设置命名空间不会自动消失；未移除时可能同时出现两个控制台。
- 旧包若仍运行，会与本包同时写同一个 `memoryDir`，属于不支持的配置。
- 迁移前备份 `memoryDir`；不要用代码回滚覆盖真实记忆目录。
- 真实微信 `/new`、真实模型调用和完整 Desktop 重启仍需人工验收。
