> **便携发布版**：本目录已移除维护者的绝对路径。`cordis.patch.yml` 仅为样例，必须由接收方 DSH 按自身环境修改后再安装。详见仓库根目录 [`INSTALL_FOR_DSH.md`](../../INSTALL_FOR_DSH.md)。

# dsh-memory-feiyu 1.3.0

两层记忆插件：只对安装时配置的 `privateWorkspace` 生效；不读写其他工作区的私人记忆。

- **短期记忆**：`raw_memories.md` 中的原子事实，逐条可增、改、删、恢复、检索。
- **长期记忆**：`memory_summary.md` 中由 AI Curator 综合、去重、更新出的主人认知，支持版本、锁定、逐条解锁、删除和回滚。
- 索引和版本只是视图，不是第三层记忆。

## 结构

```
lib/
  store.js        短期记忆、长期记忆版本、索引修复、journal
  summary.js      长期记忆锁定块、引用、删除清洗、哈希/校验
  index.js        DSH Host 插件入口、工具注册、合并注入、fail-closed 接口
  feiyu.js        策展预算、legacy 摘要辅助
  curator.js      两阶段 Curator：短期提取 + 真实 AI 长期合成
  injection.js    短期索引、完整快照、增量同步、压缩后重同步
  search.js       精确 ID / 标签 / 关键词 / 中文 n-gram 检索
  config.js       预算默认值、配置校验、工作区隔离
  text.js         UTF-8 字节/token/截断工具
  client.js       Settings 的“记忆”页：两层状态、长期编辑/解锁/回滚
  types/index.d.ts
scripts/
  repair-summary-index.mjs  安全修复 summary_history 索引
  preview-long-term.mjs     生成/校验/在副本应用真实模型长期预览
test/             node --test 自动化测试
```

记忆目录（由 `memoryDir` 配置；示例 `C:\DSH\PrivateWorkspace\.dsh\memories-feiyu`）：

```
raw_memories.md      短期记忆（active/deleted），上限 200 条 / 300000 字节
memory_summary.md    当前长期记忆（AI 综合/用户编辑，支持锁定块）
summary_history/     长期记忆历史版本，最多保留 30 份
archive/             超限后归档的短期记忆，不删除
journal.jsonl        写入、归档、长期记忆合成事件日志
state.json           版本、模式、修订序号、长期遗忘清单
state.json.bak       最近一次成功状态，供损坏恢复
tombstones.jsonl     只追加的删除指纹日志（不再按 100 条丢弃）
revisions.jsonl      修改前快照，带稳定 rev-xxxxxx 标识
summary_history/index.json  摘要版本元数据（哈希、模式、保护标记）
parse-diagnostics.json      坏块诊断（不覆盖原文件）
corrupt/             坏块隔离副本
curator.json         每个根会话的整理游标、已执行操作和最近运行状态
```

## 预算

| 项目 | 数值 |
|---|---:|
| 长期记忆 | 12000 B / 4000 tokens |
| 全局摘要 | 2000 B |
| 摘要总计 | 14000 B |
| 单次整理输入 | 36000 B / 8192 tokens |
| 策展预算 | 64000 B / 2000 tokens，长期 25% / 短期 50% / 对话 25% |
| 短期索引 | 40960 B / 12000 tokens |
| 完整快照 | 不设累计次数上限；结构变化、删除、增量过大或压缩后使用 |
| 增量同步 | 每次记忆变化后同步；单条 12000 B / 4000 tokens；不设会话累计次数上限 |
| 单次容量保护 | 只约束单条消息，避免超大注入；不为了省 token 截断长期记忆 |
| 上下文 | 实际窗口 8%，绝对上限 10%，无法读取时回退 8192 tokens |
| 自动 Curator | 20 轮阈值；每批最多 8 个会话；每次最多 8 批；输入 64000 B / 12000 tokens；每小时最多 3 次 |

## 工具

- `memory_search`：检索短期记忆；精确 ID、标签、关键词、中文 n-gram；返回完整原文。
- `memory_add`：写入短期记忆；秘密信息会被拒绝，被删除过的事实也会被拒绝。
- `memory_curate`：按分段预算返回长期记忆全文 + 短期条目材料。
- `memory_consolidate`：显式写入/切换长期记忆；默认 manual（冻结自动演化），旧版本归档。
- `memory_status`：查看短期/长期条数、版本、索引状态、Curator 状态和预算。
- `memory_forget`：软删除短期记忆；同时清洗仅由它支持的长期 claim。
- `memory_restore`：恢复被软删除的短期记忆。
- `memory_summary_rollback`：把长期记忆回滚到历史版本。
- `memory_update`：修改短期正文、概述、标签或溯源引文，修改前自动留快照。
- `memory_history`：查看短期记忆的修改历史。
- `memory_revert`：回退短期记忆到某次修改之前。
- `memory_trace`：查看短期记忆来源、轮次和原话引文，并校验指纹。

长期记忆的逐条编辑/解锁/删除走设置页 Host API（`/api/dsh-memory-feiyu/long-term`），不新增模型工具。

## 编辑与溯源

修改走 `memory_update`：正文、概述、标签、引文都能改，**每次修改前会把整条旧记录追加到 `revisions.jsonl`**（最多保留 500 条），所以随时能 `memory_revert` 回去；回退本身也留快照。

溯源写在条目里，仅在有来源时出现：

```markdown
- 溯源: session=session-2d22bc6b turn=2 seq=88-96
- 引文: 主人：以后周六晚上一起整理记忆库
- 引文哈希: 9f2c…
```

`memory_trace` 分成四层输出，不再把“哈希正确”等同于“整条记忆已验证”：

1. `指纹校验`：`verified` / `missing-quote` / `missing-hash` / `mismatch`。
2. `会话存在`：来源会话是否存在，且属于私人工作区。
3. `坐标命中`：引文是否真的出现在指定 turn / seq 范围内。
4. `正文支持`：`quote-in-content` / `heuristic-overlap` / `unverified` 的启发式结果，**不冒充语义验证**。

旧条目没有结构化证据时返回 `legacy` / `unknown`；不会为旧条目编造来源。

## 删除与回滚

删除是**软删除**：条目保留在 `raw_memories.md` 里，只多三行元数据：

```markdown
- 状态: deleted
- 删除于: 2026-11-06T08:00:00+08:00
- 删除原因: 主人要求清理
```

- 搜索、索引、长期合成和提示词注入都只读 `状态: active` 的短期条目（没有状态字段的旧条目视为 active）。
- 删除时会在 `tombstones.jsonl` 追加内容指纹；之后 `memory_add` 想再写同样的事实会被拒绝，`memory_revert` 也不能把墓碑内容写回。
- 删除短期条目后，长期文档中**仅由它支持的 claim** 会被清洗或从注入中过滤；仍有其他来源支持的 claim 保留剩余引用。
- 恢复会清掉状态行并追加 `restore` 记录；重复删除、恢复幂等。被删除短期来源支持的长期 claim 不会自动复活，需要以后由新证据重新支持或用户显式恢复。
- 长期记忆回滚前会先归档当前版本，回滚本身可再回滚；回滚后进入 manual 冻结，设置页可恢复 auto。目标版本引用已删除短期记忆时拒绝回滚。

设置页「记忆」提供删除/恢复短期记忆、长期记忆编辑、逐条解锁、删除锁定块、版本回滚。

## 设置页

插件在 DSH 设置面板注册“记忆”页（`settings.section`）：

- 查看短期有效/归档/已删除、长期大小/版本/锁定块、短期索引预览和最近事件。
- 编辑长期记忆：保存时自动锁定改动段落；锁定块可逐条解锁；可删除锁定块并进入遗忘清单。
- 编辑真实生效的 volatile 配置：索引注入、长期自动演化、长期预算、短期上限、版本上限、索引预算。
- 保存写入当前 profile，并即时影响记忆行为；恢复默认写回默认预算。
- 状态读取优先走 Host 本机接口；Host 认证不可用时页面只读，绝不回退到弱认证。
- 页面只在私人工作区根会话显示记忆内容；其他工作区显示“不可读写”并禁用操作。
- 长期版本索引不一致时显示错误并暂停编辑/回滚，提示先运行 `repair-summary-index`。

Host 侧 Config 使用 `@deepseek-ai/schemastery`；设置页使用 `dsh-client-ui-settings` 的 `configForms` 和 `settings.section` 槽位。

## 注入

新会话第一轮注入：全局摘要、当前长期记忆、短期记忆索引、索引规则。完整快照只由文件内容生成，不含时间戳或随机数；内容不变时不重复。

- 同一轮多次 memory 写入不再逐次 inject：`turn/end` 统一计算最终状态，并用 `agent.inbox.replace()` 合并待处理消息，保证最多一条。
- **取消累计硬上限**：完整快照和增量更新都不再限制会话内累计次数；长会话可以无限期持续同步。
- **优先增量**：只同步自上次注入后新增/修改/删除的短期条目；长期记忆始终带最新全文。
- **必要时完整重注入**：没有可解析的基线、删除、同一轮变化过多、增量超出单条容量、DSH 压缩后，改用完整快照。
- 单条容量保护为 12000 B / 4000 tokens（增量）；完整快照受上下文预算约束，但长期记忆优先于索引。
- 无变化不注入；同轮多次写入仍用 `inbox.replace()` 合并。
- 设置页/Curator 在 turn 外写入后，立即为存活根 agent 排队更新，下一次模型请求前生效。
- 一个根会话写入后，其他存活根会话在下一个请求前同步（工作区级记忆，不是会话级）。
- DSH 原生压缩结束后，下一次 `agent/pre-step` 把最新完整长期记忆追加到当前请求，避免压缩摘要保留旧快照。

## 自动 Curator（两阶段）

`curator.js` 在 `turn/end`、新根会话、根会话结束/销毁等事件上触发工作区级整理：

- **阶段 1：短期提取**。读新增对话 + 短期目录，只输出 `add/update` 原子短期条目，证据必须能在对应 turn/seq 找到原文。
- **阶段 2：长期合成**。读当前长期记忆、锁定块、变更短期全文、全量短期目录、已删除短期/长期内容，调用真实模型输出一整份 Markdown；校验锁定块、引用、秘密和预算后写入 `memory_summary.md`。
- 合成只在短期 `sourceHash` 变化时运行；长期版本用 `summary_history` 归档。
- 首次启用默认只建立新游标：现有会话的游标推进到最后一个完整回合，不重放历史；`curatorBackfill=true` 才显式回填历史。首次长期合成也以当前短期快照为基线，不会因既有短期记忆立刻改写 v23。
- 累计 `privateWorkspace` 下所有根会话未整理完整回合达到 20 轮触发；新建/结束会话只做提前检查，不绕过 20 轮阈值；子代理/fork 不累计。
- 每批最多 8 个会话/8 批；输入/输出预算、每小时 3 次、超时、冷却保留。
- 合成失败保留旧长期记忆，不推进长期游标，不影响短期；LLM/sessionQuery/route 不可用时跳过并记录。
- `longTermMode=off|preview|apply` 控制是否只生成预览、写生产长期记忆或关闭。

## 安全

- 只在 `privateWorkspace` 内注册工具和注入快照；只有根会话可以读写，子代理默认拒绝。
- 密码、令牌、密钥通过模式检测拒绝写入，覆盖正文、概述、标签、来源、上下文、引文、证据和删除原因。
- Host 接口**只接受** DSH `connection.admit` 的 Host/Origin + Cookie/Peer 认证；连接服务缺失、抛出异常或非 owner 时 fail-closed（503/403），绝不回退到回环 + 固定请求头。设置页认证不可用时自动只读。
- 原始记忆达到上限后归档，从不直接删除历史记录。
- 固定人设放在 `AGENTS.md` / `大肥鱼人设.md`，不进入记忆摘要。
- 工作区路径检查是应用层隔离，不等于操作系统级多用户隔离；记忆目录 ACL 需要单独收紧（见维护报告）。

## 测试

```powershell
node --test
```

当前基线：178 项测试通过（含数据可靠性、删除/回滚、长期锁定/遗忘、索引修复、同轮合并、长会话持续同步、跨会话同步、完整快照无累计上限、压缩后重注入、重启恢复、Curator 20 轮阈值、Curator 两阶段与首次启用基线、fail-closed 接口）。真实模型预览及生产上线验收由维护者在私人环境完成；原始日志及用户数据不随包发布。
