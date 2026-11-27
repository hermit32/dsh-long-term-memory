# 发布前检查清单（上传 GitHub 之前逐条打勾）

本文件属于**发布流程**，不含任何私人信息；你也可以在发布后删除它。

## 1. 内容

- [ ] `README.md` 的截图能正常显示（`screenshots/*.png` 已入库）
- [ ] `screenshots/` 里没有真实记忆、真实路径、真实账号名
- [ ] `examples/demo-memory/` 只有虚构内容（阿澈 / 小满 / 小周 / 团子）
- [ ] `examples/AGENTS.example.md` 是虚构人设，不是任何真实用户的人设
- [ ] `docs/prompts.md` 与 `lib/*.js` 一致（`node scripts/build-prompt-doc.mjs` 后无 diff）
- [ ] `CHANGELOG.md` 最新条目与 `package.json` 版本一致

## 2. 敏感信息

```powershell
node tests/privacy-scan.mjs . --extra "你的真实姓名,你的工作区目录名,你的常用昵称"
git status --ignored --short | Select-String 'node_modules|\.dsh|\.env'
```

- [ ] 隐私扫描 0 error
- [ ] `git status` 里没有 `node_modules/`、`.dsh/`、`*.log`、`memories-feiyu/`
- [ ] 没有 `.env`、`*.pem`、`*.key`、`credentials*.json`
- [ ] 没有把 `cordis.patch.yml` 改回真实路径（模板值必须是 `C:\demo\workspace`）

## 3. 依赖与可复现

```powershell
node tests/check-package.mjs
node --test
```

- [ ] 依赖检查通过，文档里列出的第三方包与 `THIRD_PARTY_NOTICES.md` 一致
- [ ] 285 项测试全绿
- [ ] 干净目录（没有 `node_modules`）按 [INSTALL.md](INSTALL.md) D 节能跑起来
- [ ] `node tests/check-demo-data.mjs` 通过（演示数据时间格式/ID/引用合法）

## 4. 仓库设置（在 GitHub 上做）

- [x] `package.json` 的 `repository` / `homepage` / `bugs` 指向现有仓库
- [ ] 选择 License：仓库根已有 MIT，GitHub 会自动识别
- [ ] 关闭 Wiki / Discussions（如果不需要）
- [ ] 开启 Secret scanning 与 Dependabot alerts
- [ ] 首个 release 打 `v2.0.2` tag，附 `CHANGELOG.md` 对应段落
- [ ] 首次 push 前确认提交作者邮箱不是私人邮箱（`git config user.email`）

## 5. 更新现有仓库

使用现有仓库的正常 Git 提交；不要 `git push --force`，不要将私人备份或构建证据提交。根目录是新版独立插件，旧组件可通过 Git 历史查阅。
