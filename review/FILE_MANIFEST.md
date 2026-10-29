# FILE_MANIFEST.md — 文件清单

- 基准目录：`dsh-private-ai-workspace/`
- 生成时间：2026-10-29
- 哈希算法：SHA-256（下表截取前 16 位；完整值可使用 `sha256sum` 或 `Get-FileHash` 在本仓库文件上重新计算）

## 1. 统计

| 分组 | 文件数 | 说明 |
| --- | --- | --- |
| `plugins/memory/` | 42 | 记忆插件源码 + 测试 + 文档 + 元数据 |
| `plugins/session-manager/` | 14 | 会话删除插件源码 + 测试 + 元数据 + 图标 |
| `examples/` | 5 | 人设、记忆规则、全局规则、配置示例、工作区标签 |
| `scripts/notify/` | 4 | 通知脚本 + 主机发现 + 示例配置 + 说明 |
| `tests/` | 5 | 一键测试、隐私扫描、打包引用检查、验收用例、说明 |
| `review/` | 5 | 四份审计 + 本文件 |
| 根目录 | 7 | `.gitignore`、README、INSTALL、ARCHITECTURE、STATUS、THIRD_PARTY_NOTICES、LICENSE |
| **合计** | **82** | 下表列 81 个（不含本文件自身） |

## 2. 逐文件清单

| 文件 | 字节 | SHA256(前16) | 原始组件 | 用途 |
| --- | ---: | --- | --- | --- |
| `.gitignore` | 1849 | `d231b48cfa9bd0c8` | 本包新写 | 忽略规则 |
| `ARCHITECTURE.md` | 9253 | `955c777cce4b9c85` | 本包新写 | 文档 |
| `examples\AGENTS.global.example.md` | 3408 | `3971e6a18a7c342d` | 本包新写（脱敏示例） | 文档 |
| `examples\AGENTS.local.example.md` | 3277 | `8f874c0a5b605208` | 本包新写（脱敏示例） | 文档 |
| `examples\CLAUDE.example.md` | 2322 | `d931e8d579f12185` | 本包新写（脱敏示例） | 文档 |
| `examples\config.example.yml` | 2144 | `1adafbc48583cb53` | 本包新写（脱敏示例） | 配置示例 |
| `examples\workspace-labels.example.json` | 139 | `97a19ebc38909420` | 本包新写（脱敏示例） | 示例/数据 |
| `INSTALL.md` | 10836 | `506c54432d284b73` | 本包新写 | 文档 |
| `LICENSE.md` | 3140 | `a8b1b9aba4422c9d` | 本包新写 | 许可证 |
| `plugins\memory\.gitignore` | 75 | `5cb0341933011edc` | dsh-memory fork（本机运行副本） | 忽略规则 |
| `plugins\memory\bin\dsh-memory-mcp.mjs` | 13887 | `b83af2b811bdd9a3` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\cordis.patch.yml` | 244 | `98675f2ae222e8b6` | dsh-memory fork（本机运行副本） | bundle 挂载配置 |
| `plugins\memory\docs\CONSOLE.md` | 8027 | `6c909838cfa7072d` | dsh-memory fork（本机运行副本） | 文档 |
| `plugins\memory\examples\mcp-config.json` | 260 | `dc015f9c53d007d9` | dsh-memory fork（本机运行副本） | 示例/数据 |
| `plugins\memory\FORK-NOTES.md` | 6260 | `6aa700e349160ee7` | 本包新写 | 文档 |
| `plugins\memory\lib\attribution.js` | 10607 | `9dbd92e9a28f0df4` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\auth.js` | 1984 | `2682c5c7d3cfbd27` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\automation.js` | 14574 | `562cb35bfd649f9e` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\browser.js` | 5391 | `8b823d8298e56bc3` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\client.js` | 69694 | `ead2d226b36b519b` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\console.js` | 35785 | `7782a2f24e41f6f3` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\console-web.js` | 4830 | `394e08a77ee470ff` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\curator-log.js` | 4046 | `8bbb0f9349df9b41` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\index.js` | 131289 | `7bbdb7dfce7bb158` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\provenance.js` | 7942 | `1d88f68ebcfb04ab` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\scoped.js` | 23376 | `6906a67fd306767d` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\session-ledger.js` | 1476 | `d8dac0cadb1aee81` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\store.js` | 54802 | `5a85e148e50af359` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\summary-scrub.js` | 7550 | `438844e1b6004e4c` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\types\client.d.ts` | 376 | `c6a8d46719410682` | dsh-memory fork（本机运行副本） | 类型声明 |
| `plugins\memory\lib\types\index.d.ts` | 3537 | `3aca1d217155570e` | dsh-memory fork（本机运行副本） | 类型声明 |
| `plugins\memory\lib\volatile.js` | 3589 | `109e70942c2dde2c` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\lib\web.js` | 12558 | `4ccbb55012a5706a` | dsh-memory fork（本机运行副本） | 源码 |
| `plugins\memory\LICENSE` | 1101 | `3ff31afd1881651d` | dsh-memory fork（本机运行副本） | 许可证 |
| `plugins\memory\package.json` | 1720 | `e91ff01a060bfc11` | dsh-memory fork（本机运行副本） | 包元数据 |
| `plugins\memory\README.md` | 12265 | `0f07ec3fa891d46e` | 本包新写 | 文档 |
| `plugins\memory\test\attribution.test.js` | 7523 | `390c33f945e49c44` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\automation.test.js` | 11686 | `d7865ea97b26eec4` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\browser.test.js` | 946 | `a193366b6f2971ea` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\console.test.js` | 15206 | `64ed045dd0c5106b` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\console-web.test.js` | 5933 | `c440462d6cc9a168` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\curator-store.test.js` | 3474 | `781b599fb761f103` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\embedding.integration.test.js` | 2021 | `3e661284eae70464` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\host-wiring.test.js` | 14884 | `97478e6330a60d28` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\mcp.integration.test.js` | 3018 | `92784dcd6d916521` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\scoped.test.js` | 8585 | `9a6f04c0a936d48d` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\session-ledger.test.js` | 2150 | `4850da46ef230df4` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\store.test.js` | 22403 | `524e28342b716615` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\summary-scrub-exact.test.js` | 3442 | `60315c826de29011` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\volatile.test.js` | 5214 | `d19850e850658aa8` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\memory\test\web-settings.test.js` | 19236 | `87e4a25653b11170` | dsh-memory fork（本机运行副本） | 单元测试 |
| `plugins\session-manager\.gitignore` | 130 | `9d3a8e71ffd75264` | session-cascade-delete（本机修改版） | 忽略规则 |
| `plugins\session-manager\cordis.patch.yml` | 300 | `eaed8a48b2d2434b` | session-cascade-delete（本机修改版） | bundle 挂载配置 |
| `plugins\session-manager\DEVELOPMENT.md` | 4040 | `5e1fe4b5a1806345` | session-cascade-delete（本机修改版） | 文档 |
| `plugins\session-manager\icon.svg` | 2066 | `72c156b96cdb91ad` | session-cascade-delete（本机修改版） | 图标 |
| `plugins\session-manager\LICENSE` | 1149 | `84c28f400d6dddc3` | session-cascade-delete（本机修改版） | 许可证 |
| `plugins\session-manager\locale\en.json` | 191 | `28febe37196c623b` | session-cascade-delete（本机修改版） | 示例/数据 |
| `plugins\session-manager\locale\zh.json` | 172 | `f281ae1bee5f0010` | session-cascade-delete（本机修改版） | 示例/数据 |
| `plugins\session-manager\package.json` | 1896 | `11b6087e10da4fac` | session-cascade-delete（本机修改版） | 包元数据 |
| `plugins\session-manager\README.md` | 11249 | `b0a035e32a11b13e` | 上游 README + 本地修改说明 | 文档 |
| `plugins\session-manager\src\client.js` | 21176 | `6dde5b68929ea679` | session-cascade-delete（本机修改版） | 源码 |
| `plugins\session-manager\src\index.js` | 61815 | `695c21910d7d89ae` | session-cascade-delete（本机修改版） | 源码 |
| `plugins\session-manager\src\workspace-scope.js` | 3871 | `3fa0dd37c962c85d` | session-cascade-delete（本机修改版） | 源码 |
| `plugins\session-manager\test\session-tool-scope.test.js` | 4826 | `5ca6cd78049534be` | session-cascade-delete（本机修改版） | 单元测试 |
| `plugins\session-manager\test\workspace-scope.test.js` | 4002 | `6f12b4d944eb5628` | session-cascade-delete（本机修改版） | 单元测试 |
| `README.md` | 9751 | `10dd172b9dec087f` | 本包新写 | 文档 |
| `review\LICENSE_AUDIT.md` | 6484 | `f2fdcd6f40f37a83` | 本包新写 | 许可证 |
| `review\REPRODUCTION_AUDIT.md` | 6261 | `5f40d3db7cae4465` | 本包新写 | 文档 |
| `review\SECURITY_AUDIT.md` | 11565 | `c4cfc36bf0bf5ebf` | 本包新写 | 文档 |
| `review\TEST_RESULTS.md` | 8187 | `a14bde71a6484c98` | 本包新写 | 文档 |
| `scripts\notify\lib\dsh-host.ps1` | 19095 | `16cfea8ab92a9433` | 生产脚本脱敏副本 | PowerShell 脚本 |
| `scripts\notify\notify.ps1` | 33426 | `a35f3d95e1fa2b0d` | 生产脚本脱敏副本 | PowerShell 脚本 |
| `scripts\notify\notify-config.example.json` | 349 | `f03a59ea9485ca4d` | 生产脚本脱敏副本 | 示例/数据 |
| `scripts\notify\README.md` | 5188 | `3d701c11655a0356` | 生产脚本脱敏副本 | 文档 |
| `STATUS.md` | 6867 | `670e6a4e676c742b` | 本包新写 | 文档 |
| `tests\acceptance\isolation.test.mjs` | 10002 | `5451c17a776fa682` | 本包新写 | 验收测试 |
| `tests\check-package-refs.ps1` | 4583 | `3c8611c6196f04c1` | 本包新写 | PowerShell 脚本 |
| `tests\privacy-scan.ps1` | 5127 | `ac7072cf7b5515a7` | 本包新写 | PowerShell 脚本 |
| `tests\README.md` | 2700 | `937ca70cc6ee41e2` | 本包新写 | 文档 |
| `tests\run-all.ps1` | 2367 | `e466ffd0def244b7` | 本包新写 | PowerShell 脚本 |
| `THIRD_PARTY_NOTICES.md` | 4675 | `3d67a0ee36b749f1` | 本包新写 | 文档 |

## 3. 明确排除的文件（及原因）

| 排除对象 | 原因 |
| --- | --- |
| `<DSH_HOME>/sessions/**` | 聊天与执行记录，私人数据 |
| `<DSH_HOME>/memories-<private>/**` | 真实长期记忆、provenance、curator 日志 |
| `<DSH_HOME>/.credentials.yaml` | 凭据存储 |
| `<DSH_HOME>/integrations/dsh-weixin/**` | 真实 botId、ownerUserId、绑定关系 |
| `<DSH_HOME>/integrations/dsh-im/*.sqlite*` | IM 群历史数据库 |
| `<DSH_HOME>/assistant/notify-config.json`、`notify-state.json`、`notify-queue*.jsonl`、`logs/**` | 真实 bot/target、本机路径、消息正文 |
| `<DSH_HOME>/assistant/persona/**`、`backup/**`、`tmp/**`、`research/**` | 私人角色、备份、临时产物 |
| 私人工作区根目录 `AGENTS.local.md`、`CLAUDE.md`、`AGENTS.md` | 私人角色与规则原文 |
| `<DSH_HOME>/AGENTS.md` | 全局通知规则（含本机用户名/路径） |
| `<DSH_HOME>/storages/*.json` | 真实工作区 ID、路径、定时任务 |
| 插件 `AGENTS.md`、`README.md`、`README.zh.md`、`CHANGELOG.md`、`docs/STATUS.md`、`docs/ROADMAP.md`、`docs/DESIGN.md`、`docs/AUDIT-PHASE-A.md`、`scripts/*.ps1`、`.github/**` | 上游开发文档/历史断言/本机部署脚本；见 `plugins/memory/FORK-NOTES.md` 末尾 |
| `assistant/backup/**/screenshots/*.png` | UI 截图，可能含个人信息且体积大 |
| `dsh-plugin-session-cascade-delete/docs/manual-*.png`、`screenshots.json` | 上游截图/展示元数据；README 保留上游公网链接。`icon.svg` 已随包收录（上游 MIT 矢量图标） |
| 可选组件：`dsh-codex-effort-slider`、`okx-cex-market` skill | 来源/独立许可证未完全核实；按首版范围整体移出，见 `THIRD_PARTY_NOTICES.md` 第 6.1 节 |
| `@local/reply-chime`、`schedule-gate`、`skills-panel` | 许可证不明确（见 `review/LICENSE_AUDIT.md`） |
| 看门狗 / 自动恢复脚本 | 计划任务已禁用、历史故障、无测试证据 |
| `node_modules/**`、`.pnpm-store/**`、`pnpm-lock.yaml` | 依赖树不属于源码发布物 |

## 4. 文件完整性

每个文件的完整 SHA-256 记录在 ZIP 同级目录的
`DSH-PUBLIC-RELEASE-SHA256SUMS.txt`，格式为 `sha256 *relative/path`，可用
`Get-FileHash` 或 `sha256sum -c` 复核（路径相对于本目录）。
