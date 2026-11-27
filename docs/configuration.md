# 配置参考

配置写在 profile 的 `cordis.patch.yml` 里（形如 `- id: dsh-memory-feiyu` 的条目）。
带 **⚡ 可热改** 标记的字段也能在设置页「记忆设置」里改，保存后立即生效。

## 1. 三个必填

| 字段 | 类型 | 说明 |
|---|---|---|
| `privateWorkspace` | 绝对路径 | 记忆只在这个目录（含子目录）内生效；其他工作区的会话读不到也写不了 |
| `memoryDir` | 绝对路径 | 记忆库目录，插件会在里面创建/维护全部文件 |
| `globalMemoryDir` | 绝对路径或 `''` | 全局摘要目录；空字符串 = 不用全局摘要 |

## 2. 注入预算

| 字段 | 默认 | 说明 |
|---|---:|---|
| `scopeMaxBytes` ⚡ | 12000 | 单条长期记忆注入上限（0 = 不限） |
| `scopeMaxTokens` ⚡ | 4000 | 同上，token 计 |
| `globalMaxBytes` | 2000 | 全局摘要上限 |
| `maxBytes` ⚡ | 14000 | 摘要总计上限，必须 ≥ `scopeMaxBytes + globalMaxBytes` |
| `indexMaxBytes` ⚡ | 40960 | 短期索引上限（0 = 不限） |
| `indexMaxTokens` ⚡ | 12000 | 同上，token 计 |
| `injectIndex` ⚡ | true | 是否注入短期索引 |
| `contextBudgetRatio` | 0.08 | 按模型窗口比例算的上限，上限 0.08（0 = 不限） |
| `contextBudgetHardRatio` | 0.10 | 硬上限，范围 [0, 0.10]；两项均大于 0 时不得小于前一项 |
| `fallbackContextTokens` | 8192 | 读不到模型窗口时用的回退值 |
| `digestMaxBytes` / `digestMaxTokens` | 12000 / 4000 | 单条增量注入上限（**不是**会话累计上限） |

## 3. 容量与版本

| 字段 | 默认 | 说明 |
|---|---:|---|
| `maxActiveMemories` ⚡ | 200 | 短期记忆条数上限；超出按活跃度搬进冷库 |
| `rawArchiveMaxBytes` | 300000 | 短期正文总量上限 |
| `keepSummaryVersions` ⚡ | 30 | 长期记忆历史版本份数 |
| `autoSummary` ⚡ | true | 是否允许自动演化长期记忆（false = 冻结，需手动 `memory_consolidate`） |
| `maxSnapshotsPerSession` ⚡ | 8 | 兼容 1.2.x 的字段，1.3+ 不再作为累计上限 |
| `fullSyncChangedEntries` | 12 | 同一轮变化超过这个数就改用完整快照 |
| `fullSyncOnDelete` | true | 有删除时强制完整快照 |

## 4. Curator（两阶段整理）

| 字段 | 默认 | 说明 |
|---|---:|---|
| `curatorEnabled` | true | 自动整理总开关 |
| `curatorThresholdTurns` | 20 | 工作区未整理完整回合达到多少轮触发 |
| `curatorSessionsPerBatch` / `curatorBatchesPerRun` | 8 / 8 | 每批会话数 / 每次批数（1–32） |
| `curatorTurnsPerSlice` | 8 | 每片回合数（1–50） |
| `curatorMaxBytes` / `curatorMaxTokens` | 64000 / 12000 | 单次输入预算 |
| `curatorBatchBytes` / `curatorBatchTokens` | 32000 / 6000 | 单批预算 |
| `curatorMaxOutputTokens` | 2000 | 阶段 1 输出预算 |
| `curatorTimeoutMs` | 120000 | 单次调用超时 |
| `curatorEntriesShown` | 80 | 输入里展示多少条现有记忆 |
| `curatorRunsPerHour` | 3 | 每小时最多几次 |
| `curatorStartupDelayMs` / `curatorCooldownMs` | 15000 / 60000 | 启动延迟 / 冷却 |
| `curatorDurabilityGate` | true | 耐久性闸门（排障/命令/路径/单次结果不写入长期） |
| `curatorBackfill` | false | 首次启用是否回填历史会话；false = 只建新游标 |
| `longTermMode` | `off` | `off` / `preview`（只预览）/ `apply`（写生产） |
| `longTermSynthesisMaxBytes` / `MaxTokens` | 64000 / 16000 | 阶段 2 输入预算 |
| `longTermMaxOutputTokens` | 4000 | 阶段 2 输出预算 |

## 5. 有效命中与活跃度

| 字段 | 默认 | 说明 |
|---|---:|---|
| `hitStatsMode` ⚡ | `observe` | `observe` 只统计不参与淘汰；`enforce` 参与 |
| `usageHalfLifeDays` ⚡ | 30 | 活跃度衰减半衰期（天） |
| `usageDailyHitCap` ⚡ | 5 | 单条每天最多计几次命中 |
| `activityGraceHours` ⚡ | 24 | 保护窗口：窗口内活跃的条目不被容量淘汰 |
| `usageCompactAfterLines` | 2000 | usage WAL 超过多少行折叠成快照 |

## 6. 浮动核心

| 字段 | 默认 | 说明 |
|---|---:|---|
| `coreEnabled` ⚡ | true | 是否维护浮动核心 |
| `coreMaxItems` ⚡ | 10 | 条数上限（1–10） |
| `coreItemMaxBytes` ⚡ | 600 | 单条正文上限 |
| `coreMaxBytes` ⚡ | 1600 | 注入上限，必须 < `maxBytes` |
| `coreMinSources` ⚡ | 2 | 每条最少来源数 |
| `coreOverlapThreshold` | 0.6 | 与长期记忆的最大 bigram 重合度，超过视为重复（0–0.95） |

## 7. Dreaming

| 字段 | 默认 | 说明 |
|---|---:|---|
| `dreamingEnabled` ⚡ | true | 总开关 |
| `dreamingIntervalHours` ⚡ | 24 | 间隔触发 |
| `dreamingMinNewMemories` ⚡ | 6 | 新增多少条触发 |
| `dreamingHeatThreshold` ⚡ | 3 | 命中热度变化多少条触发 |
| `dreamingRunsPerDay` ⚡ | 2 | 每天最多几次 |
| `dreamingMaxBytes` / `MaxTokens` | 48000 / 12000 | 输入预算 |
| `dreamingMaxOutputTokens` ⚡ | 3000 | 输出预算 |
| `dreamingTimeoutMs` | 180000 | 超时 |
| `dreamingCooldownMs` / `StartupDelayMs` | 300000 / 90000 | 冷却 / 启动延迟 |
| `dreamingCandidates` | 60 | 候选短期记忆条数 |
| `archiveRecallLimit` ⚡ | 20 | `memory_recall` 默认返回条数 |

## 8. 校验规则（启动即校验，不合规直接报错）

```
maxBytes ≥ scopeMaxBytes + globalMaxBytes
coreMaxBytes < maxBytes
coreItemMaxBytes ≤ coreMaxBytes
contextBudgetRatio ∈ [0, 0.08]
contextBudgetHardRatio ∈ [0, 0.10]；两项均大于 0 时 ≥ contextBudgetRatio
hitStatsMode ∈ {observe, enforce}
longTermMode ∈ {off, preview, apply}
privateWorkspace / memoryDir 必须是绝对路径
```

## 9. 推荐档位

> 注意：本文件的“默认值”列取自 `lib/config.js` 的 `DEFAULT_CONFIG`。
> 随包发布的 `cordis.patch.yml` 会覆盖其中两项，属于**有意的保守默认**：
> `curatorEnabled: true → false`（不自动整理）、`curatorStartupDelayMs: 15000 → 60000`（开机不急着跑）。

| 场景 | 调整 |
|---|---|
| 只观察（推荐） | `longTermMode: off`、`curatorEnabled: false`、`dreamingEnabled: false`（随包 Dreaming 默认为 true，需显式关闭） |
| Curator 预览不自动改长期记忆 | `curatorEnabled: true`、`longTermMode: preview`、`dreamingEnabled: false` |
| 正式使用 | `longTermMode: apply` + `curatorEnabled: true` |
| 小内存模型（8k 窗口） | `fallbackContextTokens: 4096`、`indexMaxTokens: 4000`、`indexMaxBytes: 12000` |
| 大内存模型（128k+） | 可放大 `indexMaxBytes`，但保持 `contextBudgetRatio` 不变 |
| 只想手动整理 | `curatorEnabled: false`、`dreamingEnabled: false`，只留工具调用 |
