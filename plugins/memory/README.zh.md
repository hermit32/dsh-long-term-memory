# dsh-memory-scoped — 私人工作区长期记忆

> 当前版本：**0.2.0**
> 本包基于 `haitang1/dsh-memory` v0.5.0 的受控分支；包名、插件 ID、设置命名空间、
> 客户端 bundle 均为 `dsh-memory-scoped`。

## 功能

- 只对一个显式配置的私人工作区开放；其他工作区和子代理不注入、不显示工具。
- 14 个 `memory_*` 工具；写入前检测凭据；**没有 `allowSecret` 绕过参数**。
- 独立 MCP server（`bin/dsh-memory-mcp.mjs`）同样是“始终拒绝凭据”：content 与
  最终 tags 都会扫描；merge 使用 `store.planMergeEntries()` 的唯一合并计划，
  拒绝重复 ID 并在落盘前检查全部参与者与最终结果；`workspace` / `project`
  作用域只允许 `DSH_MEMORY_ALLOWED_ROOTS` 内的路径，`global` 需要
  `DSH_MEMORY_ALLOW_GLOBAL=1`；回归测试见 `test/mcp.security.test.js`。
- 工作区全部 owned 根会话的未整理有效回合累计达到阈值（默认 20）时，
  后台 Curator 跨会话分批整理；每个会话保留独立 cursor 和来源。
- 桌面新建 `startup` 触发；打开已有/恢复 `resume` 不触发。
- 微信 `/new` 通过本地 dsh-im 补丁发出 `dsh-im/new-session` process 事件。
- 有界 curator 日志、provenance、summary CAS、原子写、失败/部分写入恢复。
- 已认证记忆控制台。

## 安装

1. 将 `dsh-memory-scoped` 放到稳定目录，并在 profile 中 link 安装。
2. 在 `cordis.patch.yml` 配置 `privateWorkspace`（必须非空）、`memoryDir`、
   `scopedMemory: true`。空 `privateWorkspace` 会禁用自动记忆。
3. 重载 DSH。不要同时加载旧的个人化包；见 `MIGRATION.md`。

dsh-im `/new` 桥接需要：

```powershell
node ..\patches\apply-dsh-im-patch.mjs --check
node ..\patches\apply-dsh-im-patch.mjs
```

## 测试

```powershell
cd dsh-memory-scoped
node --test
node scripts/check-release.mjs
```

运行 187 项测试：184 通过，3 跳过，0 失败。  
集成 harness（需要 DSH peer packages）：

```powershell
node acceptance/curator-harness.mjs all
```

## 限制

真实微信 `/new`、真实外部模型 20 轮、完整 DSH Desktop 重启尚未人工验收；
不要把候选包描述为“可直接公开”。dsh-im 升级后必须重新运行补丁脚本。

