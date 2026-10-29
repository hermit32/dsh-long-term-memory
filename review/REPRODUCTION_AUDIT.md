# REPRODUCTION_AUDIT.md — 从干净环境复现能力评估

- 评估日期：2026-10-29（第二轮修复后复核）
- 起点假设：一台从未安装过这些自定义插件的机器，已装好 DSH 桌面版。
- **总体结论：不具备“一键部署”条件。** 安装步骤完整，但没有在干净机器上实际走通；
  下面把每一项标成“代码/测试可证”或“未验证”，不要跨级宣称。

## 逐项核对

| # | 要求 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 1 | 需要什么 DSH 版本 | ✅ 已记录 | `INSTALL.md` 第 0 节：desktop runtime 0.2.1-rc.3、Host 协议 4、Node 24.21/pnpm 11.28.5。来自 `desktop-runtime.json`。 |
| 2 | 需要安装哪些第三方插件 | ✅ 已记录 | `dsh-im` 5.6.0（微信，唯一验证通道）+ 本包两个插件。可选组件（滑块、行情 Skill、本地 UI 插件、看门狗）**不在本候选包**，见 `README.md`。 |
| 3 | 哪些模块是本地修改版本 | ✅ 已记录 | `dsh-memory-scoped`（上游 fork）、`session-cascade-delete` 1.0.6-local.1、`notify.ps1`（脱敏 + `DSH_HOME` 支持）。见 `FORK-NOTES.md`、`plugins/session-manager/README.md`、`scripts/notify/README.md`。 |
| 4 | 每个插件如何安装和注册 | 🟡 步骤完整，未实测 | `INSTALL.md` 第 2–4 节。`package.json` 的 `main`/`exports`/`icon`/`dsh.bundle.patch`/`files` 引用已用脚本核对存在性；`cordis.patch.yml` 的 insert 行 id 与包名一致。干净环境未执行。 |
| 5 | 私人工作区如何指定 | ✅ 代码 + 测试可证 | `privateWorkspace` 配置；精确路径比较、根会话判定、子目录不匹配，均有单测与验收测试。 |
| 6 | 如何配置人设 | ✅ 文档 + 机制可证 | `examples/AGENTS.local.example.md` 说明 DSH 原生加载顺序（`AGENTS.md`/`CLAUDE.md` + `.local` 覆盖），并给出隔离检查方法。 |
| 7 | 长期记忆如何初始化 | 🟡 部分可证 | 目录/文件布局、`diagnostics.json` 字段、首次 consolidation 行为有代码与测试；真实 Host 上的首次初始化未在干净环境验证。 |
| 8 | 如何打开记忆控制台 | 🟡 路由可证，UI 未验证 | 路由 `/_dsh/memory/console`、设置页 section、bundle id 一致性有测试；浏览器点击未验证。 |
| 9 | 会话管理如何启用 | 🟡 机制可证，端到端未验证 | bundle 安装、UI 入口、`session_delete` 工具、工作区隔离、事件广播都有代码/单测；真实删除未在干净环境执行。本地修改版的安装方式已在 README 顶部单独强调。 |
| 10 | 微信如何接入 | ❓ 未验证 | 只验证了本机“已接入且可用”的状态；扫码绑定流程依赖上游 `dsh-im`，本包未复现。 |
| 11 | 工作区 A、工作区 B 如何发送单向通知 | 🟡 脚本可证，环境未复现 | 脚本只接受文本参数、bot/target 只读自中央配置；进程归属/路由探测逻辑完整。未在干净机器跑过。 |
| 12 | 如何确认工作区隔离生效 | ✅ 有可执行清单 | `INSTALL.md` 第 12 节 7 步；`tests/acceptance` 覆盖其中 4 步的代码层面。注意：这是工具/提示词层隔离，不是 OS 文件隔离。 |
| 13 | 如何运行测试 | ✅ 可执行（Windows） | `tests/run-all.ps1` 在 Windows 实测通过；记忆、会话删除、验收套件均可离线运行。其他平台本轮未运行。 |
| 14 | 如何卸载或安全回滚 | ✅ 文档完整 | `INSTALL.md` 第 14 节：移除 bundle → 保留数据 → 再决定删除；记忆数据不会被卸载自动删除。 |

## 已验证的部分（Windows，2026-10-29 第二轮）

在**发布候选包自身**上执行：

```text
memory          152 tests  / 149 pass / 0 fail / 3 skipped
session-manager  14 tests  /  14 pass / 0 fail
acceptance       10 tests  /  10 pass / 0 fail（Windows 路径用例执行 + 可移植路径用例）
privacy-scan     82 files  / 0 findings（修复后重新扫描）
```

平台矩阵：

| 平台 | Node | 状态 |
| --- | --- | --- |
| Windows 10/11（本机） | 24.22.1 | ✅ 单元测试 + 验收测试已运行 |
| Linux | 22（独立审核者报告） | ⚠️ 验收用例曾失败；已定位为 Windows 路径语义差异并加平台条件，**本轮未在 Linux 重跑** |
| macOS | — | ❓ 未运行 |
| 干净环境（任意平台） | — | ❓ 未复现 |

## 未验证的部分（必须如实标记）

1. **干净机器安装**：没有第二台机器或干净 profile 可用；所有安装动作都在已部署的
   桌面 profile 上进行过，属于“生产状态”而非“从零复现”。
2. **微信扫码/收发**：本机已绑定，未重新走绑定流程。
3. **DSH 版本兼容性**：只在 0.2.1-rc.3 上验证；上游声明 `dsh-im` 兼容
   0.2.0-rc.2 / 0.2.1-rc.2，本包未测其他 rc。
4. **真实删除**：没有为了测试删除真实会话（任务要求）。
5. **真实 20 轮 curator 写入**：没有为了测试制造 20 轮真实对话；只验证了状态机、
   校验、空结果、清理路径。
6. **控制台 UI**：没有浏览器自动化 / 截图回归。
7. **非 Windows 平台**：本轮未执行；验收用例已做平台条件化（见
   `TEST_RESULTS.md` 第 5 节）。
8. **看门狗**：未纳入，未验证。

## 如果要完成“干净环境验证”，最小步骤

1. 新建一个 DSH profile（不要用现有 desktop profile）。
2. 只安装 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + 本包两个插件。
3. 按 `INSTALL.md` 配一个临时工作区（例如 `C:\Workspaces\clean-test`）和临时
   `memoryDir`。
4. 依次验证：工具可见性 → 写入/搜索 → 隔离（另一个工作区）→ 控制台 401 → 删除
   一个**合成**会话 → 通知脚本返回 `queued` 或 `sent`。
5. 把每一步的实际输出补进本文件，替换 🟡/❓ 状态。

## 结论

- 具备“按文档手工复现”的条件，**不具备**“一键部署”或“已被独立验证”的条件。
- `README.md` / `INSTALL.md` 已明确标注未验证项，没有把未完成能力写成已完成。
- 第二轮修复只覆盖打包、安装说明、安全边界表述和跨平台测试；**没有**让上述未验证
  项变成已验证。
