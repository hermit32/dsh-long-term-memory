# 安装 / 更新 Feiyu Memory 1.3.0

面向 **Windows + DeepSeek Harness Desktop**；跨平台兼容与全新机器一键安装尚未独立验收。推荐先让 DSH 阅读 [INSTALL_FOR_DSH.md](INSTALL_FOR_DSH.md) 自动适配。

## 准备

- 能正常运行的 DSH Desktop（维护者在 runtime `0.2.2-rc.1` 做过隔离在线验收）。
- 可用的 LLM 服务；Curator 使用 DSH 自带模型路由，不需要在仓库里填 API key。
- 一个私人工作区，例如 `C:\DSH\PrivateWorkspace`。这是**示例路径**，不是强制目录。
- 插件依赖 `@deepseek-ai/schemastery`：安装到 DSH profile 时由 DSH 插件管理器自动安装；只有**在源码目录跑测试**时才需要手动执行下面两步。

  ```powershell
  cd plugins\feiyu-memory
  pnpm install --frozen-lockfile   # 或 npm install
  node --test                      # 178 项 / 177 通过 / 1 跳过 / 0 失败
  ```

## 全新安装

1. 克隆或下载仓库，把 `plugins/feiyu-memory/` 放到一个稳定的本地路径，如 `C:\DSH\plugins\dsh-memory-feiyu`；不要放入 `.dsh/memories-feiyu` 数据目录。
2. 让 DSH 检查当前使用的 profile 中是否已加载其它长期记忆插件。**不要同时加载注册同名 `memory_*` 工具的两个插件。**
3. 复制 `plugins/feiyu-memory/cordis.patch.yml` 的插件配置作为参考，按本机修改：

   ```yaml
   privateWorkspace: 'C:\DSH\PrivateWorkspace'
   memoryDir: 'C:\DSH\PrivateWorkspace\.dsh\memories-feiyu'
   globalMemoryDir: ''
   curatorThresholdTurns: 20
   curatorBackfill: false
   curatorEnabled: false
   longTermMode: 'off'
   ```

4. 在当前 DSH profile 中通过插件管理器的**本地路径安装**（`file:` / `link:`）注册 `dsh-memory-feiyu`，确保 `dsh.profile.bundles` 中只出现一份。CLI 细节可能随 DSH 版本变化，请先执行当前安装器的 `--help` 或使用 GUI，不要直接照抄旧版 0.2.1 的命令。
5. 首次加载先检查 Host 运行状态、12 个工具、设置页与私有工作区隔离；无现有数据时建立空库。确认可用后开启 `curatorEnabled: true`、`longTermMode: apply`。如果已有长期记忆，先预览，取得主人确认后再 apply。
6. 现在可以正常聊天：所有根会话的未整理完整回合累计 20 轮后自动 Curator 整理；平时记忆变化也会及时同步，不必新建会话。

## 从旧版本升级 / 新设备迁移

- **只复制插件不等于迁移记忆。** 此仓库只提供公开代码，不包含任何人的私密数据。
- 备份旧设备上的 `memoryDir` **整个目录**（包括 `raw_memories.md`、`memory_summary.md`、`summary_history/`、`curator.json`、`state.json`、`tombstones.jsonl` 等），以及所用 profile 的相关配置；备份应放在私密位置，不要提交 GitHub。
- 新设备先安装同版本插件，确认数据目录和工作区路径配置正确，再由 DSH 在停写状态下迁移数据；跨设备会话 ID 与旧游标可能不匹配，首次应保留 `curatorBackfill: false`，避免旧对话重复整理。
- 从 1.2.x 升级 1.3.0 时，历史索引可能需要用 `scripts/repair-summary-index.mjs` **先只读检查、备份后再 --apply**；不要直接覆盖有问题的索引。
- 人设文件和微信通道配置另行迁移，**不属于记忆插件自动同步的数据**。

## 最小验收与回滚

- 核对插件 `packageVersion: 1.3.0`、12 tools、Host cookie 认证、无启动错误。
- 核对实际 private workspace、数据目录、Curator 20 轮阈值、已备份的旧数据。
- 有问题先关闭自动写入，再按备份恢复 profile / 插件；如已有新记忆，不要直接用旧备份覆盖它们。
- 不要为验证而故意运行大量真实模型调用；一个简单的工具查询与自然聊天足以开始使用。

更多实现细节见 [ARCHITECTURE.md](ARCHITECTURE.md)、[STATUS.md](STATUS.md)。
