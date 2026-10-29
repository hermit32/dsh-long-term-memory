# INSTALL.md — 从干净环境复现

> **状态：安装步骤未在干净机器上完整验证。** 本文的每一步都对应本机实际运行状态，
> 但“从零开始照做一遍”没有做过。请按 `review/REPRODUCTION_AUDIT.md` 的清单逐项
> 自行验证；任何一步失败都先停下来核对版本，不要跳过。

## 0. 版本基线

| 项 | 本机实测值 |
| --- | --- |
| DSH | `@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.3**（desktop profile） |
| Host 协议版本 | 4（`desktop-runtime.json`） |
| 捆绑 Node / pnpm | 24.21.0 / 11.28.5 |
| 本包测试用 Node | 24.22.1 |
| 记忆插件 | `dsh-memory-scoped` 0.6.0-local.1（上游 fork） |
| 会话删除插件 | `@liuyu-f/dsh-plugin-session-cascade-delete` 1.0.6-local.1（上游 1.0.6 修改版） |
| IM 插件 | `@xmanrui/dsh-im` 5.6.0 |

DSH 处于 pre-1.0，小版本之间可能破坏兼容。不要假设 0.2.0/0.2.1 的其他 rc 版本行为一致。

## 1. 第三方插件

| 插件 | 用途 | 是否随包分发 |
| --- | --- | --- |
| `@xmanrui/dsh-im` 5.6.0 | IM 接入（本方案只验证微信） | **否**，按上游说明安装 |
| `dsh-memory-scoped` | 长期记忆 | 是（`plugins/memory/`，上游 `dsh-memory` 的 fork） |
| `@liuyu-f/dsh-plugin-session-cascade-delete` | 会话删除 | 是（`plugins/session-manager/`，上游 1.0.6 的**本地修改版**） |

> **会话删除插件必须用本地修改版。** 用 npm 包名或插件管理器“添加插件”安装，会得到
> 上游 1.0.6，其中没有 `session_delete` 的工作区隔离，也不会广播
> `session-delete/deleted`。安装方式见 `plugins/session-manager/README.md`
> 的「安装（本地修改版）」。

可选组件（推理强度滑块、公开行情 Skill、本地 UI 插件、看门狗）**不在本候选包内**，
见 `README.md` 的「可选组件」。

## 2. 放置插件目录

把两个插件目录放到一个**不在工作区内部**的稳定路径，例如：

```text
C:\Workspaces\plugins\dsh-memory-scoped\
C:\Workspaces\plugins\dsh-plugin-session-cascade-delete\
```

不要放进 `<工作区>\.dsh\`（那会被当成工作区数据备份/泄露）。不要直接复制整个
`~/.dsh`。

## 3. 注册插件（profile 层）

编辑 `<DSH_HOME>/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "dsh-memory-scoped": "link:C:/Workspaces/plugins/dsh-memory-scoped",
    "@liuyu-f/dsh-plugin-session-cascade-delete": "link:C:/Workspaces/plugins/dsh-plugin-session-cascade-delete"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-memory-scoped",
        "@liuyu-f/dsh-plugin-session-cascade-delete"
      ]
    }
  }
}
```

然后在 profile 目录执行依赖安装。推荐直接用插件管理器 UI 的“添加插件”输入**本地
目录**，让 DSH 自己写 `package.json` 并建立 `node_modules` 链接。命令行方式（路径以
你的安装位置为准，DSH 桌面版把 CLI 放在 `resources\runtime\cli\bin\dsh.cmd`）：

```powershell
dsh plugin --profile desktop add "file:C:\Workspaces\plugins\dsh-memory-scoped"
dsh plugin --profile desktop add "file:C:\Workspaces\plugins\dsh-plugin-session-cascade-delete"
```

必须使用 `file:` 本地路径或 `link:` 依赖。**不要**执行
`dsh plugin add @liuyu-f/dsh-plugin-session-cascade-delete`：那会从 npm 安装上游
未修改版，没有工作区隔离与 `session-delete/deleted` 事件。

本机没有独立的 `pnpm.cmd` 可执行文件（pnpm 由 DSH 内部管理），所以不要照抄其他
项目的 `pnpm install` 步骤。

> 不要同时保留 `dsh-memory` 和 `dsh-memory-scoped` 两个 bundle：它们会注册同名工具。

## 4. 写入策略配置

把 `examples/config.example.yml` 的两段合并进
`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`，至少改这三处：

- `privateWorkspace`：你的私人工作区**绝对路径**（必须是精确路径，不能留空）。
- `memoryDir`：记忆数据目录（不要把记忆放进会被 Git 跟踪的仓库目录）。
- `curateEveryTurns`：每个会话的有效回合阈值，默认 20。

## 5. 指定私人工作区

`privateWorkspace` 是唯一安全边界：

- 只比较完整路径，子目录不匹配；
- 只对**根会话**生效，子代理默认被排除；
- 留空 = 插件加载但记忆功能完全关闭（注入为空、工具报错）。

在 DSH 里新建/指定工作区时，工作区路径必须与 `privateWorkspace` 完全一致。

## 6. 配置人设

1. 复制 `examples/AGENTS.local.example.md` 到私人工作区根目录，改名为
   `AGENTS.local.md`，替换成你自己的角色。
2. 复制 `examples/CLAUDE.example.md` 到同一目录，改名为 `CLAUDE.md`（记忆规则
   与 persona 分开）。
3. 全局规则放 `<DSH_HOME>/AGENTS.md`（参考 `examples/AGENTS.global.example.md`）。

`AGENTS.local.md` / `CLAUDE.local.md` 是 DSH 原生支持的本地覆盖文件（见
`examples/AGENTS.local.example.md` 顶部说明），不是本项目的自定义加载器。

## 7. 初始化长期记忆

1. 确认 `seedFromAgentsMd: false`（避免把人设写进记忆）。
2. 首次启动后检查 `<memoryDir>/diagnostics.json`：
   - `toolsRegistered` 应包含 14 个 `memory_*`；
   - `configAlerts` 为空；
   - `privateWorkspace` 与你配置的一致。
3. 摘要在第一次 consolidation 时生成；在此之前注入为空是正常的。
4. 手动验证：在私人工作区根会话里调用 `memory_add`，再 `memory_search`。
   在**其他工作区**调用同一工具应当被拒绝。

## 8. 打开记忆控制台

1. 打开 DSH 设置 → **私人工作区记忆**（插件设置页）。
2. 页面对应路由 `/_dsh/memory/console` 与 `/_dsh/memory/settings`，两者都要求
   已认证的 DSH 页面会话。
3. 如果页面不出现：检查客户端 bundle id 是否等于包名 `dsh-memory-scoped`，
   并确认 profile 的 bundle 列表里有它。
4. 用 curl 直接访问时应得到 401/403 或 503（没有 connection 服务时），**不应**
   返回记忆内容。

## 9. 启用会话管理

会话归档与删除是两部分：

- **归档/恢复**：DSH 原生能力（侧栏会话操作），本包不提供。
- **永久删除**：`plugins/session-manager`。安装并重启后：
  - UI：会话标题旁垃圾桶按钮、侧栏行菜单“删除会话”；
  - 工具：`session_delete`（模型可调用，但只在调用方工作区内生效）。
- 删除会级联删除该会话拥有的**子代理会话**；fork 分支不会。
- 删除成功会广播 `session-delete/deleted`，记忆插件据此清理 pending/owned，
  **不删除任何长期记忆条目**。
- 如果不想让删除级联子代理，在 patch 里设 `deleteSubagents: false`。

## 10. 接入微信

1. 安装 `@xmanrui/dsh-im@5.6.0`（MIT，
   <https://github.com/xmanrui/dsh-im>）。本包不分发该插件。
2. 在 DSH 设置里启用微信通道，按上游提示扫码登录。
3. 把私人工作区绑定为该 bot 的唯一工作区（`<DSH_HOME>/integrations/` 下的
   `workspaces.json` 由插件写入；不要在别的工区手改）。
4. 用另一个微信号发一条消息验证收发。
5. **只验证了微信。** 上游插件还支持飞书、企微、钉钉、QQ、Telegram、WhatsApp、
   Slack、Discord、Matrix；这些在本方案中**未验证**，不要宣称可用。

## 11. 工作区 A / B 发送单向通知

1. 把 `scripts/notify/` 整个目录复制到私人工作区的固定位置（例如
   `<私人工作区>\.dsh\assistant\`）。
2. 复制 `notify-config.example.json` → `notify-config.json`，填 `appExe`、
   `botId`、`targetId`。
3. 复制 `workspace-labels.example.json` → `workspace-labels.json`。
4. 在工作区 A、工作区 B 里执行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<私人工作区>\.dsh\assistant\notify.ps1" -Workspace "工作区 A" -Title "任务完成" -Message "结果见 <路径>"
   ```

5. 返回值：`{"sent":true}` / `{"sent":false,"queued":true}` /
   `{"sent":false,"duplicate":true}`。
6. 失败补发：`-FlushQueue`（当前工作区）或 `-FlushQueue -AllWorkspaces`。

注意：通知脚本**不提供**回复能力；微信回复始终由私人工作区处理。

## 12. 确认工作区隔离

1. 在私人工作区根会话问：“列出你能看到的 memory_* 工具”——应有 14 个。
2. 在工作区 A、工作区 B 问同一句——应看不到这些工具（或被 `restrict` 隐藏）。
3. 在工作区 A、工作区 B 直接要求“调用 `memory_add` 记住 X”——应报错
   `memory: only available in the private workspace root session`。
4. 在私人工作区派生子代理，让子代理调用 `memory_add`——应被拒绝（子代理不是根会话）。
5. 检查注入：工作区 A、工作区 B 的提示词里不应出现 `## Workspace memory` 段。
6. 检查磁盘：`<memoryDir>/scopes/` 下只应有私人工作区的那一个 `ws-<hash>` 目录
   有内容。
7. 会话删除：在工作区 A 调 `session_delete` 删除私人工作区的 session id——应被
   拒绝（`different workspace`），且不产生任何文件操作。

## 13. 运行测试

```powershell
cd plugins\memory;               node --test
cd plugins\session-manager;      node --test
cd tests;                        .\run-all.ps1
```

纯 Node，不需要 DSH 宿主、不需要网络。测试会把数据写到系统临时目录。
验收套件里的 Windows 路径作用域用例只在 Windows 上执行；其他平台会跳过并改跑
可移植路径用例（原因见 `review/TEST_RESULTS.md`）。

**平台状态**：单元测试在 Windows（Node 24）上实测通过；其他平台本轮**未运行**；
干净环境**未复现**。

## 14. 卸载 / 安全回滚

**插件**

1. 从 profile `bundles` 移除 `dsh-memory-scoped` 与
   `@liuyu-f/dsh-plugin-session-cascade-delete`。
2. 从 `dependencies` 删除对应 link 行，重新 `pnpm install`。
3. 从 `cordis.patch.yml` 删除两段策略配置。
4. 重启 DSH。

**数据**

- 记忆数据在 `<memoryDir>`；卸载插件不会删除它。需要彻底清除时手动删除该目录。
- 删除会话不可撤销；长期记忆条目不会随会话删除而消失。

**通知**

- 删除 `notify-config.json` 即失去发送能力；工作区里的 `.dsh-notify` 只是本地队列
  与去重状态，可直接删除。
- IM 绑定在 `<DSH_HOME>/integrations/` 下，按上游插件文档解绑；不要用本包的脚本
  操作它。

**最短回滚路径**：先移除 bundle（停止写入与注入），保留数据目录，确认没有异常后
再决定是否删除数据。不要在插件仍挂载时删除 `<memoryDir>`。
