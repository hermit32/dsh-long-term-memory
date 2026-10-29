> **历史 RC3 验收记录（脱敏副本）**：记录的是发布前候选测试与限制。本文的“未上传 GitHub / 未就绪”描述为当时状态；v0.2.0 已以**技术预览版**形式公开，未完成的真实微信/外部模型/冷启动验收仍然未完成。

# 与 GitHub `dsh-memory-scoped` v0.1.0 的兼容性

## 基线

本候选以 GitHub 公开版本 `dsh-memory-scoped` v0.1.0 为基线；该公开包内部版本为
`0.6.0-local.1`，公开包名、插件 loader row、设置命名空间和客户端 bundle 均为
`dsh-memory-scoped`。本包内部版本为 `0.2.0`；没有改回个人化命名。

## 保留的标识

| 标识 | 值 |
|---|---|
| npm/package name | `dsh-memory-scoped` |
| `cordis.patch.yml` loader row id | `dsh-memory-scoped` |
| 设置命名空间 | 优先 `dsh-memory-scoped`，兼容旧 upstream `dsh-memory` 探测 |
| 客户端 bundle id | `dsh-memory-scoped` |
| `package.json` `dsh.bundle.patch` | `./cordis.patch.yml` |
| 默认 `privateWorkspace` | `''` |

因此从 v0.1.0 升级时，loader row、设置文档命名空间和客户端注册不会改变；不会
因为本功能包而产生第二套 scoped 客户端。

## 与旧个人化包的关系

旧 `<legacy-bundle-id>` 与本包是 **不同 bundle/不同 ID**。两者同时存在会导致：

- 两套工具和两套控制台；
- 两套 curator 同时写同一 `memoryDir`（不支持的配置）；
- 设置命名空间/客户端 bundle 冲突或重复。

迁移必须按 `plugins/memory/MIGRATION.md`：先移除旧 bundle/row、停 Host，
再加载本包。`scripts/check-migration.mjs` 对 profile 做只读检查；同时发现两者
返回 1。旧 ID 不硬编码：检查时传入 `--legacy-id "<old-bundle-id>"`（或设置
`DSH_LEGACY_MEMORY_ID`），以保留旧版本迁移识别而不暴露具体私人命名。

## 数据兼容

`pending-turns.json` 的 `sessions`/`owned`/`cursorSeq`/`countedSeq`/`pendingTurns`
结构与公开基线一致；raw/summary/journal/provenance/curator-log 的存储格式未变。
本包只改变触发和调度策略，不改变存储格式。

迁移旧数据时应复制 `memoryDir` 到新目录，不要让两个包同时写原目录。`owned`
账本沿用 session id；旧包使用的真实 workspace hash 不需要在新包中重建。

## 配置兼容

公开基线字段保持不变：`privateWorkspace`、`memoryDir`、`scopedMemory`、
`readOnlyScopes`、`curateEveryTurns`、`curateMaxAdds`、`curateMaxOps` 等。
本包新增的行为（工作区总量、分批、`/new` 桥接）不需要新的必填配置。
`allowSecret` 不存在，不能通过配置重新启用。

## 未验证

没有在真实 GitHub v0.1.0 部署上做冷启动/微信/外部模型验收；兼容性结论来自源码
diff、单元测试、隔离 harness 和只读 migration guard。完整 Desktop 重启、真实
微信 `/new`、真实模型 20 轮仍需人工验收。
