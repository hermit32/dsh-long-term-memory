> **历史 RC3 验收记录（脱敏副本）**：记录的是发布前候选测试与限制。本文的“未上传 GitHub / 未就绪”描述为当时状态；v0.2.0 已以**技术预览版**形式公开，未完成的真实微信/外部模型/冷启动验收仍然未完成。

# 测试报告与修复差异

## 1. 修复前后

| 项目 | 修复前 | 修复后 |
|---|---|---|
| 包名/ID | 个人化 `<legacy-bundle-id>` | 公开 `dsh-memory-scoped`（包名/loader row/设置命名空间/client bundle） |
| 工作区总量 | 按单会话累计；全工作区未实现 | owned 会话 pending 求和；`lifetimeTurns` 不触发 |
| 跨会话 | 无批处理 | 每批最多 8 会话、最多 8 批；17 会话 3 批 |
| 每会话状态 | 单一 pending | 独立 cursor/count/attempt/emptyChecks；失败保留 |
| 新建/微信 | 60 秒兜底，无 `/new` 事件 | startup 立即触发；dsh-im `/new` process 事件 |
| attribution | 未把 lines 放进 context，adds 被丢弃 | context 含 lines，A/B/C 实际写入 |
| cursor 保存失败 | raw 成功但 cursor 可能错误推进 | record+owned 快照回滚；重试不重复 |
| 补丁 `--check` | 注释含 marker 也可能通过 | 完整 sourceNew+bundleNew 唯一、旧分支不存在；comment-only / mixed / duplicate 反向失败 |
| patch 写入 | 顺序写，可能部分安装 | 双文件预检、temp+rename、回滚；partial 不写 |
| release check | 忽略测试退出码/失败数 | 检查 status + fail；反向测试 1 失败返回非零 |
| 旧部署脚本 | 包含固定目录/停进程脚本 | 最终包排除；只保留 release/migration 检查 |
| 文档 allowSecret | 旧描述不一致 | 所有文档明确：参数已删除，不能绕过 |
| MCP 凭据/作用域 | `allowSecret` 可绕过；update/merge 无检测；任意 cwd 可达 global/workspace | 删除 `allowSecret`；add/update/merge 始终检测 content 与最终 tags；scope 白名单、`global` 默认拒绝 |
| MCP merge 重复 ID | `targets.length === ids.length` 可被重复 ID 绕过，跳过凭据扫描 | 扫描前拒绝重复 ID；校验全部 ID 与 `keepId`；预检最终 content 与合并后 tags |
| MCP 合并计划分叉 | MCP 按请求顺序预计算、store 按存储顺序落盘；等长 content/16 项 tag 上限可绕过 | 唯一 `planMergeEntries()`；store 在写盘前把同一计划交校验器；全部参与者 content/tags 扫描 |
| MCP 错误回显 | 超长 tag 报错包含标签原文 | 错误只报长度上限；scope/tool/缺失条目也不回显输入 |

## 2. 自动测试结果

```text
unit: 187 tests / 184 pass / 3 skip / 0 fail
mcp security: 22/22 pass (allowSecret / add / update / merge / tags / duplicate ids /
              request-order permutations / 16-tag cap / error echo / delete journal)
merge plan: 3/3 pass (pure plan determinism, validator veto leaves raw unchanged, safe tag error)
integration: abc, wechat, partial, deferred, fault all ok
patch matrix: all ok, including comment-only, mixed old+new and duplicate-block guards
check-release: OK (0), 187 declared/verified
check-release negative: exit 1, saw exit failure + failed count
migration guard: old-only ok; both old+scoped exit 1
```

集成关键断言：

- A/B/C：3 条 raw；pending 0；每条 provenance 指向 A/B/C。
- `fault`：首次 raw 1/pending 6/cursor 0；重试 raw 1/cursor 6/pending 0。
- 17 会话：raw 17、pending 0、3 runs。
- 微信：合成 process 事件被监听；非私人 workspace 被忽略。

## 3. 脱敏与打包

- 真实用户目录、私人 assistant 名称、真实 workspace/session ID、旧私有 memory 目录
  扫描 0 匹配。
- `DEFAULT_PRIVATE_WORKSPACE=''`。
- 最终 ZIP 全部 POSIX `/`；SHA256 全覆盖；无 `node_modules`。
- 文档路径检查通过：配置模板 `dsh-memory-scoped/examples/config.example.yml` 存在，README 不再引用包外的 `../../examples`。

## 4. 反向测试

- `patches/test-patch.mjs`：comment-only marker、mixed old+new、duplicate new block 的 check/apply 都失败且不写。
- `scripts/check-release-negative.mjs`：187 项含 1 失败时 release check 返回 1，
  不输出 OK。
- `test/mcp.security.test.js`：`allowSecret` 不存在、add/update/merge 拒绝 content
  与 tags 中的凭据、merge 拒绝重复 ID、等长 content 与 16 项 tag 上限的请求顺序
  排列均拒绝且 raw/journal 逐字节不变、update 拒绝保留历史凭据、`DSH_MEMORY_REDACT=0`
  仍拒绝、超长 tag 错误与 stderr 不含明文、delete 的 journal 不含凭据、scope
  越界/未知 scope 拒绝。
- `test/merge-plan.test.js`：`planMergeEntries()` 的存储顺序/等长 tie-break/标签顺序
  与 16 项上限；validator 否决后 raw 不变；`normalizeTags` 错误不含 tag 原文。
- `scripts/check-migration.mjs`：旧包+scoped 同时存在返回 1。

## 5. 未完成

真实微信 `/new`、真实外部模型 20 轮、完整 Desktop 重启未验收；不能声明可直接公开。

- acceptance harness 本轮未重跑：工作区缺少 `@deepseek-ai` peer 包；MCP 修改不涉及
  curator 代码，`integration.txt` 保留上一轮结果并已标注为历史运行。
- 真实微信 `/new`、真实外部模型、Desktop 冷启动仍需人工验收。
