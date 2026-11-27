# 第三方声明

本仓库自身代码以 [MIT](LICENSE) 发布。运行时唯一的直接依赖来自 DeepSeek Harness。

## 直接依赖

| 包 | 版本 | 许可证 | 版权 | 用途 |
|---|---|---|---|---|
| `@deepseek-ai/schemastery` | 3.19.0 | MIT | Copyright (c) 2021-present Shigma | 插件 `Config` schema 定义（`z.object`） |

## 间接依赖（由 schemastery 带入）

| 包 | 版本 | 许可证 | 版权 |
|---|---|---|---|
| `@deepseek-ai/cosmokit` | 1.9.0 | MIT | Copyright (c) 2021-present Shigma |
| `@standard-schema/spec` | 1.1.0 | MIT | Copyright (c) 2024 Colin McDonnell |

## 关于 DSH 运行时

`@deepseek-ai/*` 包随 DeepSeek Harness 安装包分发。本仓库**不打包**这些依赖，也不修改它们。

- 安装使用时，依赖由你的 DSH 安装提供（profile 的 `node_modules` 里通常已有）；
- 单独跑测试时用 `node scripts/link-runtime-deps.mjs --from <DSH 的 node_modules>` 借用，不复制进仓库；
- 因此本仓库的 `node_modules/` 永不入库（见 `.gitignore`）。

如果你要再分发本插件，请一并保留上表的许可证与版权声明。

## 文档与素材

- 界面截图（`screenshots/`）由本项目在隔离环境中自行抓取，内容为虚构演示数据；
- 演示数据（`examples/`）为本项目原创虚构内容，与任何真实个人无关；
- 图标 `icon.svg` 为本项目原创。

## 历史来源与许可

保留旧版记忆系统的上游许可与归属，见 [UPSTREAM_LICENSE_NOTICE.md](UPSTREAM_LICENSE_NOTICE.md)。新版许可证不追溯修改历史版本的许可。
