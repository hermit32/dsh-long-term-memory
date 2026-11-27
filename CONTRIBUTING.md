# 贡献指南

## 环境

```powershell
node scripts/link-runtime-deps.mjs --from "X:\path\to\dsh\node_modules"
node --test
```

## 改动前请先读

1. [ARCHITECTURE.md](ARCHITECTURE.md) 第 3 节「关键不变量」——任何触及存储、删除、注入的改动都必须守住这些不变量；
2. [docs/prompts.md](docs/prompts.md)——提示词是产品行为的一部分，改措辞等于改行为；
3. [docs/data-format.md](docs/data-format.md)——文件格式是向后兼容契约，改格式必须带迁移。

## 提交前自检

```powershell
node --test                        # 全绿
node tests/privacy-scan.mjs .      # 无 error
node tests/check-package.mjs       # 依赖与清单一致
node scripts/build-prompt-doc.mjs  # 改过提示词才需要
```

## 提交约定

- 一个提交只做一件事；修 bug 带一个能复现的测试（`test/*.test.js`）。
- 新增配置项：加进 `DEFAULT_CONFIG`、`Config` schema、需要热改的再加进 `VOLATILE_KEYS`，
  并在 `docs/configuration.md` 补一行。
- 新增数据文件：写进 `docs/data-format.md`，并在 `MemoryStore.init()` 里建空文件。
- 新增工具：`lib/index.js` 注册 + `docs/prompts.md` 会由脚本自动收录描述。
- **不要在代码里写死任何路径、用户名或私人领域词汇**。有测试守着（`test/persona.test.js`）。
- 不要提交真实记忆库、`node_modules`、日志或截图工作目录（`.gitignore` 已覆盖）。

## 代码风格

- ESM，Node ≥ 22，不引入构建步骤；
- 纯函数优先（`config.js` / `activity.js` / `search.js` / `text.js` 都是纯的）；
- 错误信息用中文、具体、可操作（说明“为什么拒绝”和“怎么恢复”）；
- 文件写入一律「临时文件 + rename」；
- 注释解释“为什么”，不复述“做了什么”。

## 报告问题

用虚构数据做最小复现。不要贴真实记忆内容或凭据。安全相关问题见 [SECURITY.md](SECURITY.md)。
