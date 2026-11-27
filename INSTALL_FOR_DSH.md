# 给 DeepSeek Harness 的安装交接书（2.0.2）

本仓库根目录即 `dsh-memory-feiyu` 插件。不要把旧版本目录结构套用到 2.0.2。先阅读 [INSTALL.md](INSTALL.md)、[配置参考](docs/configuration.md) 和 [安全说明](SECURITY.md)。

## 安装任务

1. 只读检查当前 DSH 版本、Node 版本、实际 profile、工作区及已有记忆插件；Node 需 ≥22。确认用户允许操作的范围。
2. 如已有记忆，先征得用户同意，备份真实记忆目录和相关 profile 配置到仓库外。不要清空记忆，不要自动迁移未知旧格式，不要同时加载两个版本。
3. 根据 INSTALL A 节安装或本地链接当前包。目标包名为 `dsh-memory-feiyu`。依赖从当前 DSH 运行时获得，不能假定公共 npm 可用。不要用示例路径覆盖用户实际配置。
4. 设置实际的 `privateWorkspace`、`memoryDir`、可选 `globalMemoryDir`；先在隔离的虚构测试工作区确认工具和设置页。首次配置建议显式关闭 Curator 与 Dreaming，长期合成设 `off`；确认后按 INSTALL C 节分阶段开启。
5. 运行发布自检，确认设置页、`memory_status`、虚构记忆读写和工作区隔离；有 DSH 依赖时运行 `node --test`。测试不得访问其他工作区的真实记忆，不得发送未经授权的付费模型请求。
6. 需要重启、修改正式配置或迁移时先说明影响并获得用户授权。报告实际路径、版本、测试结果、未完成项和恢复方式，不把测试数据当成用户记忆。

## 可以直接复制给 DSH 的指令

> 请阅读 https://github.com/hermit32/dsh-long-term-memory/blob/main/INSTALL_FOR_DSH.md 和 INSTALL.md，先检查当前环境，再安全安装 Feiyu Memory 2.0.2。保留原有数据，不导入任何维护者私人资料，遇到配置变更、迁移、重启或付费操作先征求我的同意。完成后给出实际验收结果。
