# TEST_RESULTS.md — 测试证据（第二轮）

- 运行日期：2026-10-29（第二轮修复后）
- 运行对象：`DSH-PUBLIC-RELEASE-REVIEW/`（脱敏后的候选包自身，不是生产目录）
- 环境：Windows，Windows PowerShell 5.1，Node.js **v24.22.1**
- 方式：`tests/run-all.ps1`（逐个套件 `node --test`），全程离线，不读写生产记忆

## 1. 结果汇总（Windows 实测）

| 套件 | 命令 | 结果 | 退出码 |
| --- | --- | --- | --- |
| memory | `node --test` in `plugins/memory` | **152 项：149 通过 / 0 失败 / 3 跳过** | 0 |
| session-manager | `node --test` in `plugins/session-manager` | **14 项：14 通过 / 0 失败** | 0 |
| acceptance | `node --test` in `tests/` | **10 项：10 通过 / 0 失败** | 0 |
| privacy-scan | `tests/privacy-scan.ps1` | **82 个文本文件 / 0 命中** | 0 |
| package-refs | `tests/check-package-refs.ps1` | **2 个 package.json / 全部引用存在** | 0 |

3 个跳过项：需要外部 embeddings 服务或 MCP 运行时的集成测试
（`embedding.integration.test.js`、`mcp.integration.test.js` 等）。它们不是失败。

> 第一轮结果里还有 `effort-slider`（449 断言）。该组件已按首版范围移出候选包，
> 因此本轮不再运行，也不再计入本包结果。

## 2. 与第一轮/生产副本的对比

| 套件 | 第一轮候选包 | 第二轮候选包 | 结论 |
| --- | --- | --- | --- |
| memory | 152 / 149 通过 / 3 跳过 | 152 / 149 通过 / 3 跳过 | 不变 |
| session-manager | 14 / 14 | 14 / 14 | 不变 |
| acceptance | 9 / 9 | **10 / 10** | 新增可移植路径用例；Windows 路径用例保留 |
| effort-slider | 449 断言 | 不适用 | 已移出首版范围 |

## 3. 任务指定的 9 项重点检查

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 最新 P0 安全修复是否存在 | ✅ | `tests/acceptance` 的 fail-closed 用例 + `console-web.test.js` / `web-settings.test.js`；源码中无 loopback 降级 |
| 工作区 A、工作区 B 无私人记忆注入 | ✅（工具/提示词层） | `tests/acceptance`：路径/作用域键均不同；子目录、同名前缀均为 false。**注意**：这不是文件系统隔离，同用户 Agent 仍可读文件（见 `SECURITY_AUDIT.md` 6.1） |
| 私人工作区根会话能使用记忆工具 | 🟡 | `host-wiring.test.js` 结构断言 + 工具执行前 `assertPrivateExec`；真实会话未测 |
| 未认证管理接口拒绝访问 | ✅ | 无 `connection` → 503；401/403 原样拒绝；抛异常 → 403 |
| 会话删除不连带删除长期记忆 | ✅ | `tests/acceptance`：删除后 raw 条目 id 不变；`session-ledger.test.js` |
| 多会话处理不会重复写入 | ✅ | `scoped.test.js` 的 pending/游标测试；`curator-store.test.js`；`console.test.js` 的 revision 冲突 |
| Curator 空结果正常 | ✅ | `shouldConsolidateAfterCuration([], [])`；`validateCuratorOperations([])`；`curator-store.test.js` |
| 修改记忆不误删相似摘要 | ✅ | `summary-scrub-exact.test.js` + `tests/acceptance`（蓝色/猫、paraphrase） |
| 配置示例不含真实个人信息 | ✅ | `privacy-scan.ps1` 全包 0 命中；`examples/` 全部为占位符 |

## 4. 打包引用检查（第二轮新增）

`tests/check-package-refs.ps1` 逐个读取 `package.json`，验证 `main`、`types`、`bin`、
`icon`、`exports`、`files`、`dsh.bundle.patch` 指向的路径真实存在。

```text
[check-package-refs] manifests: 2
[check-package-refs] OK: every advertised path exists
```

第一轮遗漏的 `plugins/session-manager/icon.svg` 已从上游 MIT 资源恢复；
`session-manager/package.json` 现在同时标记 `"private": true` 并移除
`publishConfig`，避免被误认为可发布的上游包。

## 5. 跨平台问题：Windows 路径作用域哈希

### 现象

独立审核报告：`tests/acceptance/isolation.test.mjs` 在 Linux Node 22 失败，
在 Windows 通过。

### 原因（已定位）

该用例断言：

```js
assert.equal(scopeKeyForCwd('c:/workspaces/private/'), scopeKeyForCwd('C:\\Workspaces\\private'))
```

`scopeKeyForCwd()` 会调用 `path.resolve()` 并在 **Windows** 上做小写归一。
在 POSIX 上：

- `C:\Workspaces\private` 不是绝对路径，`resolve()` 会把它当成当前目录下的
  一个普通文件名（反斜杠不是分隔符）；
- `c:/workspaces/private/` 也被当成相对路径的另一种拼写；
- 两者解析结果不同 → 哈希不同 → 断言失败。

这是**测试对平台语义的假设**，不是记忆隔离实现缺陷：该函数在 POSIX 上本来就不应
接受 Windows 路径字符串。Windows 上的真实工作区路径行为没有变化。

### 修复

1. 原来的 Windows 拼写用例改为**仅 Windows 执行**：
   `skip: process.platform === 'win32' ? false : 'Windows path semantics; ...'`；
2. 新增一个**所有平台都执行**的用例：用 `mkdtemp()` 创建两个真实绝对路径，验证
   - 作用域键格式为 `ws-<16 hex>`；
   - 不同目录键不同；
   - 同一目录加尾分隔符键相同；
   - `scopeFromSession()` 使用 cwd 得到同一个键；
3. Windows 上两个用例都执行（10/10 通过），原有行为未被削弱。

### 状态

| 平台 | 状态 |
| --- | --- |
| Windows（本机） | ✅ 已实测：Windows 路径用例 + 可移植用例均通过 |
| Linux Node 22 | ⚠️ **本轮未重跑**；修复是平台条件化，理由如上 |
| macOS | ❓ 未运行 |

因此不能写“跨平台已验证”，只能写“已定位平台差异并做条件化；Linux 待复验”。

## 6. 平台与环境矩阵

| 维度 | 状态 |
| --- | --- |
| 单元测试（Windows） | ✅ 通过（152 / 14 / 10） |
| 隐私扫描（Windows） | ✅ 82 文件 0 命中 |
| 打包引用检查（Windows） | ✅ 2 个 manifest 全部存在 |
| 通知脚本语法/启动（Windows） | ✅ PowerShell 解析通过；隔离目录下 `-Status` 与发送尝试返回预期结果 |
| Linux | ⚠️ 仅收到审核者的失败报告；修复后未重跑 |
| macOS | ❓ 未运行 |
| 干净环境安装 | ❓ 未复现 |
| 微信真实收发 | ❓ 未重新验证 |
| 真实 20 轮 curator 写入 | ❓ 未验证 |
| 控制台 UI 点击/截图 | ❓ 未验证 |

## 7. 关键测试文件对照

| 领域 | 文件 |
| --- | --- |
| 工作区判定 / pending 状态机 / curator 校验 | `plugins/memory/test/scoped.test.js` |
| 来源归属 | `plugins/memory/test/attribution.test.js` |
| 存储、锁、journal、历史 | `plugins/memory/test/store.test.js` |
| 摘要精确 scrub | `plugins/memory/test/summary-scrub-exact.test.js` |
| 控制台服务 | `plugins/memory/test/console.test.js` |
| 控制台 HTTP 认证 | `plugins/memory/test/console-web.test.js` |
| 设置接口 + 最小补丁 | `plugins/memory/test/web-settings.test.js` |
| 宿主接线结构 | `plugins/memory/test/host-wiring.test.js` |
| 删除会话状态清理 | `plugins/memory/test/session-ledger.test.js` |
| curator 日志存储 | `plugins/memory/test/curator-store.test.js` |
| 删除插件工作区归属 | `plugins/session-manager/test/workspace-scope.test.js` |
| 删除插件模型工具隔离 | `plugins/session-manager/test/session-tool-scope.test.js` |
| 发布声明验收 | `tests/acceptance/isolation.test.mjs` |
| 隐私扫描 | `tests/privacy-scan.ps1` |
| 打包引用检查 | `tests/check-package-refs.ps1` |

## 8. 测试没有覆盖的部分

- DSH 宿主级注入（真实提示词里是否出现 `## Workspace memory`）。
- 真实 20 轮后 curator 调用 LLM 并成功写入。
- 微信 `/new` 事件映射。
- 控制台浏览器 UI。
- 真实会话删除（任务禁止）。
- 通知脚本的端到端发送（需要运行中的 Host 与 IM 通道）。
- 非 Windows 平台。
- Windows 看门狗（未纳入）。

这些缺口在 `STATUS.md` 和 `review/REPRODUCTION_AUDIT.md` 中重复标注，避免被误读为
“全部通过 = 全部功能已验证”。

## 9. 复现命令

```powershell
cd tests
.\run-all.ps1
.\privacy-scan.ps1
.\check-package-refs.ps1
```

三个脚本都只用相对路径，退出码 0 表示通过；可在任意目录调用，脚本会按自身位置找
包根。
