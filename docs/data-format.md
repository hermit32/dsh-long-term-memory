# 数据格式

记忆库是一组**纯文本 + JSON** 文件，没有数据库。可以手改、可以 diff、可以备份。

目录默认：`<privateWorkspace>\.dsh\memories-feiyu\`

## 1. `raw_memories.md` — 短期记忆

Markdown 是**人类可读的视图**，解析器按块切分（`## mem-xxxxxxxx` 开头，正文每行缩进两个空格）。真实渲染结果如下（字段顺序与 `renderEntry()` 一致）：

```markdown
## mem-00000001
- 创建: 2026-11-18T21:10:00+08:00
- 标签: 偏好, 沟通
- 来源: conversation
- 上下文: demo-fixture
- 概述: 先给结论再给依据
- 重要度: 3
- 来源类型: manual
- 溯源: session=session-demo0001 turn=12 seq=88-96
- 引文: 阿澈：先说结论，别铺垫
- 引文哈希: 9f2c1a7b…
- 正文:
  阿澈偏好先给结论再给依据，不要先铺背景。
```

可选字段只在有值时才出现：`- 更新:`（与创建时间不同）、`- 来源类型:`、`- 策展操作:`、`- 合并自:`、
`- 溯源:`、`- 引文:`、`- 引文哈希:`、`- 证据:`（JSON 一行）、`- 归档于:` / `- 归档原因:`。

软删除只在元数据里追加三行，正文保留（注意：这三行在 `- 正文:` **之前**）：

```markdown
## mem-00000011
- 创建: 2026-11-08T10:00:00+08:00
- 标签: 生活
- …
- 重要度: 1
- 来源类型: manual
- 状态: deleted
- 删除于: 2026-11-26T21:30:00+08:00
- 删除原因: 用户要求清理
- 正文:
  阿澈养了一只叫团子的猫。
```

字段语义：

| 字段 | 说明 |
|---|---|
| `创建` / `更新` | 带时区偏移的 ISO 时间（`+08:00`）；`更新` 只在变化时出现 |
| `标签` | 逗号分隔，用于检索与人物候选判断 |
| `来源` | `conversation` / `用户指示` / 项目文件 / Curator |
| `上下文` | 短上下文标记，可为空 |
| `概述` | 一行摘要，索引里显示；缺省从正文推导 |
| `重要度` | 0～3；3 的记忆在容量淘汰时有保护 |
| `来源类型` | `manual` / `curator` / `legacy` 等，标识这条是谁写的 |
| `溯源` | `session=<id> turn=<n> seq=<a>-<b>`，可缺省 |
| `引文` / `引文哈希` | 原话连续子串 + sha256，用于 `memory_trace` |
| `证据` | Curator 阶段 1 的结构化证据数组（JSON），比 `溯源` 更细 |
| `状态` | 缺省视为 `active`；`deleted` 为软删除 |
| `归档于` / `归档原因` | 进冷库后写入 |

解析失败的块**不会被覆盖**：进 `corrupt/`，诊断写进 `parse-diagnostics.json`。

## 2. `memory_summary.md` — 长期记忆

```markdown
<!-- feiyu-summary v1 · 由 dsh-memory-feiyu 管理 -->

# 我记住的用户

## 对方是谁

- 阿澈，长期做读书笔记；《晨读笔记》是主线项目，每天一条，年底目标 100 条。 <!-- [mem-00000003] [mem-00000007] -->
```

- 正文**不出现** `[mem-xxxxxxxx]` 编号和日期：提示词要求将引用放在行末 HTML 注释中，但模型可能漏写；校验器拒绝不存在的活动短期记忆 ID，并不强制每行都有引用；
- 锁定块：

```markdown
<!-- feiyu-lock:start id="lock-0001" -->
## 我们怎么相处
- 先给结论再给依据。
<!-- feiyu-lock:end -->
```

锁定块内容逐字校验，被改写即拒绝写入；解锁后才会重新进入 AI 合成范围。

## 3. `floating_core.md` — 浮动核心

```markdown
<!-- feiyu-core v1 · 由 dsh-memory-feiyu Dreaming 维护 -->

<!-- feiyu-core:start id="fc-000000a1" sources="mem-00000001,mem-00000004" created="…" updated="…" pinned="0" -->
### 先给结论，一次做完
阿澈要的是先给结论再给依据，并且任务一次做完、中途不要反复追问细节。
<!-- feiyu-core:end -->
```

- `sources` 至少 2 条（`coreMinSources`），必须是活动或合法归档的短期记忆；
- `pinned="1"` 的条目自动流程不得改写或删除；
- 删除写进 `core_tombstones.json`（指纹），Dreaming 不会复活；
- 变更历史追加到 `core_history.jsonl`，可逐条回退。

## 4. 长期版本 `summary_history/`

```
summary_history/
  0001.md … 0030.md      每次长期记忆变更前的完整快照
  index.json             { version, maxVersion, entries: { "1": { version, file, hash, bytes, createdAt, mode, reason, protected, locksHash } } }
```

`index.json` 与版本文件不一致 → 进入只读保护，需运行：

```powershell
node scripts/repair-summary-index.mjs <memoryDir> --apply
```

## 5. `archive/raw_memories.md` — 冷库

格式与 `raw_memories.md` 完全一致，只是加了归档元数据。冷库**不参与**日常注入与默认检索；
`memory_recall` 只读，不自动搬回。

## 6. 只追加日志

| 文件 | 内容 | 保留策略 |
|---|---|---|
| `journal.jsonl` | `add / update / archive / forget / restore / consolidate / dreaming-run` 事件 | 全量 |
| `tombstones.jsonl` | 删除内容指纹（sha256 前若干位）+ 时间 + 原因 | 不按条数丢弃 |
| `revisions.jsonl` | 每次修改前的整条快照（带 `rev-xxxxxx`） | 最多 500 条 |
| `usage.jsonl` | 有效命中 WAL | 折叠进 `usage.json` |
| `core_history.jsonl` | 浮动核心变更 | 全量（含 seq） |

## 7. 状态文件

`state.json`（真实结构，字段见 `MemoryStore` 的状态默认值）：

```json
{
  "version": 2,
  "summaryVersion": 1,
  "summaryMode": "auto",
  "summaryHash": "8b1875…fb4ec",
  "totalAdded": 11,
  "revisionSeq": 0,
  "tombstones": [
    { "op": "delete", "id": "mem-00000011", "hash": "8c4e44…16d04", "at": "2026-11-26T21:30:00+08:00" }
  ],
  "longTermForgotten": []
}
```

`state.json.bak` 是最近一次成功状态；`state.json` 损坏时回退并标记 `stateRecovered: true`。
`tombstones` 数组是内存中的墓碑缓存，真正的只追加日志是 `tombstones.jsonl`。

`usage.json` 是折叠后的命中快照：

```json
{
  "version": 1,
  "entries": {
    "mem-00000001": { "hits": 4, "lastHitAt": "…", "contentUpdatedAt": "…", "reasons": { "assistant": 4, "user": 0, "both": 0 }, "daily": { "2026-11-21": 1 } }
  }
}
```

`dreaming.json` 存基线指纹与最近 20 次运行记录（`runId / status / add / update / remove / snapshotDir`）。
`dream/<runId>/` 是那次运行的快照目录，含 `manifest.sha256`。

## 8. 演示数据

`examples/demo-memory/memories-feiyu/` 是一份**可直接打开看**的完整演示库（虚构人物），
字段与真实运行完全一致，可用来对照格式或做本地试验。
