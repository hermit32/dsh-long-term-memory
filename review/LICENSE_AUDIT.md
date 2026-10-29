# LICENSE_AUDIT.md — 第三方许可证核查

核查日期：2026-10-29（第二轮修复后复核）。核查对象是**实际运行在本机**的插件/脚本，
而不是历史文档里的描述。每个结论都给出证据位置。

## 1. 汇总

| 组件 | 实际版本 | 许可证 | 版权行 | 允许修改/再分发 | 本候选包结论 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek Harness | 0.2.1-rc.3 | MIT | Copyright (c) 2026 DeepSeek | 是 | 未分发，无需附带 |
| `dsh-memory`（上游） | v0.5.0 / `15de1c7` | MIT | dsh-memory contributors | 是 | 已分发，保留 LICENSE + 修改说明 |
| `dsh-memory-<private>`（本机 fork） | 0.6.0-<private>.2 | MIT | 同上 | 是 | 以 `dsh-memory-scoped` 分发 |
| `@liuyu-f/dsh-plugin-session-cascade-delete` | 1.0.6（本地 `1.0.6-local.1`） | MIT | liuyu-f + lsz-asd | 是 | 已分发，保留 LICENSE + 修改说明 |
| `@xmanrui/dsh-im` | 5.6.0 | MIT | xmanrui | 是 | 不分发，仅给安装说明 |
| `dsh-codex-effort-slider` | 1.1.3 | MIT | contributors | 是 | **本候选包不收录**（可选，来源待核实） |
| `okx-cex-market` skill | 1.4.3 | MIT（frontmatter 声明） | okx | 是 | **本候选包不收录**（可选，需单独补 LICENSE） |
| `@local/reply-chime` | 1.0.0 | **无** | — | 不明确 | **不收录** |
| `@local/schedule-gate` | 1.0.0 | **无** | — | 不明确 | **不收录** |
| `@local/skills-panel` | 1.0.0 | **无** | — | 不明确 | **不收录** |
| 微信看门狗 / 自动恢复 | 本机脚本 | 无 | — | 不明确 | **不收录** |

**随包再分发的第三方组件只有 2 个**：`dsh-memory` fork 和 session-cascade-delete
本地修改版。两者都保留 MIT 全文与版权行。

## 2. 逐项证据

### DeepSeek Harness

- 证据：`resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh/package.json`
  为 `"license": "MIT"`，`LICENSE` 首行 `Copyright (c) 2026 DeepSeek`；
  `repository` 指向 <https://github.com/deepseek-ai/deepseek-harness>。
- 本包未复制其源码。

### dsh-memory 与本机 fork

- 上游声明见 `plugins/memory/FORK-NOTES.md`：`haitang1/dsh-memory` v0.5.0，
  commit `15de1c7`，MIT。
- `plugins/memory/LICENSE` 原文保留（`Copyright (c) 2026 dsh-memory contributors`）。
- 修改说明：`FORK-NOTES.md` + 本文件第 3 节。
- 注意：本机目录名与包名含私人昵称，发布时已改名，见 `SECURITY_AUDIT.md`。

### session-cascade-delete

- `package.json`：`"license": "MIT"`，`author: liuyu-f`，
  `contributors: lsz-asd`（原 `@huanlin/dsh-plugin-session-delete`）。
- `LICENSE` 含两条版权行，原文保留。
- `icon.svg` 取自上游仓库（MIT），随包分发；它是普通矢量图标，不含个人数据。
- 本机版本 `1.0.6-<private>.1` 相对上游 1.0.6 有修改（工作区隔离、删除事件、测试）。
  MIT 允许修改与再分发，条件是保留版权与许可声明；发布包已保留，并在
  `plugins/session-manager/README.md` 顶部写明修改内容。
- 本地化处理：`package.json` 设为 `"private": true` 并移除 `publishConfig`，版本改为
  `1.0.6-local.1`。这样不会被误发布到上游 npm scope；本包**没有**向 npm 发布任何
  内容。
- **安装风险（已在 README 顶部标注）**：`dsh plugin add <包名>` 或插件管理器输入
  包名会安装上游未修改版；必须用本地 `link:` / `file:` 安装。

### dsh-im

- `node_modules/@xmanrui/dsh-im/package.json`：MIT，`author: xmanrui`，
  repo <https://github.com/xmanrui/dsh-im>。
- 本包**不分发**该插件（`INSTALL.md` 只给安装命令与链接）。理由：体积大、含多个
  第三方 SDK、且只验证了微信一个通道。

### dsh-codex-effort-slider（本候选包不收录）

- `LICENSE`：MIT，`Copyright (c) 2026 dsh-codex-effort-slider contributors`。
- `package.json` 没有 `repository`/`homepage`/`author` 字段 → 上游归属无法从包内确定。
- 决定：作为**可选组件**移出首版候选包。若后续纳入，先确认作者与仓库，并保留
  LICENSE 与来源说明。

### okx-cex-market skill（本候选包不收录）

- 证据：`SKILL.md` frontmatter `license: MIT`、`metadata.author: okx`、
  `metadata.version: 1.4.3`、`metadata.homepage: https://www.okx.com`。
- 原目录**没有**独立 LICENSE 文件，也没有 `_meta.json`（移植时已被上游适配者移除）。
- 决定：作为**可选 Skill** 单独发布；纳入前应补独立 LICENSE（年份原文未给出）与
  移植说明。

### 明确排除的无许可证组件

| 组件 | 证据 | 决定 |
| --- | --- | --- |
| `@local/reply-chime` | `package.json` 只有 `"private": true`，无 `license` 字段，无 LICENSE 文件 | 不收录 |
| `@local/schedule-gate` | 同上（有 README，但无许可证） | 不收录 |
| `@local/skills-panel` | 同上 | 不收录 |
| 看门狗 | 本机脚本，无许可证、无测试 | 不收录 |

这些组件是“作者未声明许可”，不是“确认不可公开”。若发布者就是作者，可以自行补
MIT 后再纳入。

## 3. 修改说明清单（MIT 要求）

| 组件 | 修改内容 | 说明位置 |
| --- | --- | --- |
| dsh-memory fork | 工作区隔离、按会话回合触发、curator、provenance、控制台、P0 修复、匿名化改名 | `plugins/memory/FORK-NOTES.md` |
| session-cascade-delete | 模型工具工作区隔离、`session-delete/deleted` 事件、测试、版本号、`private` 标记 | `plugins/session-manager/README.md` 顶部 |
| notify 脚本 | 移除本机路径与默认 appExe、支持 `DSH_HOME` | `scripts/notify/README.md` |

（滑块与 okx skill 不在包内，因此这里没有它们的修改说明义务；将来纳入时再补。）

## 4. 未做的检查

- 没有逐个核对 `node_modules` 中的传递依赖许可证（本包不复制依赖树）。
- 没有核对 DSH 桌面应用安装包本身的 EULA（只核对了 npm 包 LICENSE）。
- 没有联系任何上游作者取得书面确认；结论仅基于包内许可证文本。

## 5. 结论

- 随包再分发的 2 个组件都有明确的 MIT 声明，允许修改与再分发。
- 3 个本地 UI 插件与看门狗因**许可证不明确**被排除；滑块与行情 Skill 因**来源/
  许可证待核实**被移出首版候选包。
- 发布前需要人工确认：本仓库原创部分的版权人名称（`LICENSE.md`），以及是否将来
  单独发布可选组件。
