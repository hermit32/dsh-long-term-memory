# 安装与复现

三种装法：A 装进已有 DSH（最常见）、B 从零复现一个隔离环境（评测/开发）、D 只跑测试不装。C 节介绍自动整理配置。

前置：

- DeepSeek Harness（Web 或 Desktop profile），`dsh --version` 能用；
- Node ≥ 22（插件用 `import.meta.dirname`、`node --test`）；
- 一个**专用**的私人工作区目录（记忆只在这个目录内生效）。

---

## A. 装进已有 DSH profile

### A1. 找到 profile

```powershell
dsh --dump-config | Select-String 'profile'
# 或直接看目录
Get-ChildItem "$env:USERPROFILE\.dsh\profiles"
```

典型：`%USERPROFILE%\.dsh\profiles\desktop\`。

### A2. 把包放进 profile

```powershell
$repo   = "X:\path\to\dsh-memory-feiyu"          # 你 clone 下来的目录
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"

New-Item -ItemType Directory -Force "$profile\node_modules" | Out-Null
Copy-Item $repo "$profile\node_modules\dsh-memory-feiyu" -Recurse -Force
Remove-Item "$profile\node_modules\dsh-memory-feiyu\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$profile\node_modules\dsh-memory-feiyu\screenshots" -Recurse -Force -ErrorAction SilentlyContinue
```

> `node_modules` 与 `screenshots` 不必进 profile：前者由 DSH 的依赖树提供，后者只是文档资产。

### A3. 声明为 bundle

编辑 `$profile\package.json`，把插件加进 `dsh.profile.bundles`：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-memory-feiyu"
      ]
    }
  }
}
```

### A4. 配置路径（必须改）

编辑 `$profile\cordis.patch.yml`，找到 `dsh-memory-feiyu` 条目，改这三个值：

```yaml
- id: dsh-memory-feiyu
  name: dsh-memory-feiyu
  config:
    privateWorkspace: 'C:\demo\workspace'
    memoryDir: 'C:\demo\workspace\.dsh\memories-feiyu'
    globalMemoryDir: 'C:\demo\workspace\.dsh\memories-feiyu\global'
```

- 三项都必须是**绝对路径**；
- `privateWorkspace` 之外的会话读不到也写不了记忆；
- `globalMemoryDir: ''` 表示不用全局摘要；
- 其余预算字段可以先用默认值，见 [configuration.md](docs/configuration.md)。

### A5. 重启并验收

```powershell
dsh --profile desktop          # 或重启 DSH Desktop
```

打开 `设置 → 记忆`，应看到「记忆库状态」卡片。若显示“当前会话不属于该工作区”，
说明当前会话的 cwd 不在 `privateWorkspace` 里——在新工作区目录里开一个新会话即可。

验收清单：

- [ ] 总览卡片显示短期 / 冷库 / 长期 / 浮动核心数字；
- [ ] 会话里让模型调一次 `memory_status`，返回 JSON；
- [ ] `memory_add` 写入一条，`raw_memories.md` 出现新块；
- [ ] 写入 `api_key = sk-xxxx` 会被拒绝（秘密检测）；
- [ ] 在别的工作区会话里调用工具会被拒绝。

---

## B. 从零复现一个隔离环境（评测 / 开发）

完全不碰你的日常 profile 与记忆。

```powershell
# 1. 独立 DSH_HOME
$env:DSH_HOME = "X:\lab\feiyu-home"
New-Item -ItemType Directory -Force "$env:DSH_HOME\profiles\demo" | Out-Null

# 2. profile 清单：把插件作为本地 link
@'
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": { "dsh-memory-feiyu": "link:X:/path/to/dsh-memory-feiyu" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-memory-feiyu"] } }
}
'@ | Set-Content "$env:DSH_HOME\profiles\demo\package.json" -Encoding utf8

# 3. cordis.yml 留空入口
'[]' | Set-Content "$env:DSH_HOME\profiles\demo\cordis.yml" -Encoding utf8

# 4. 配置指向演示记忆库
#    privateWorkspace = <仓库>\examples\demo-memory 的上一级约定目录，
#    或复制一份演示库到独立工作区使用（见 examples/config.example.yml）

# 5. 建软链并启动
cmd /c mklink /J "$env:DSH_HOME\profiles\demo\node_modules\dsh-memory-feiyu" "X:\path\to\dsh-memory-feiyu"
dsh --profile demo --port 51320 --no-open
```

打开终端里打印的 `http://127.0.0.1:51320/?token=…`，进 `设置 → 记忆`。

> 注意：`dsh --profile demo --port …` 里**不要**再写 `web`。`web` 是内置 profile 名，
> 自定义 profile 的应用形态由 `dsh.profile.bundles` 决定。

如果工作区列表是空的或指向别的目录，改 `$env:DSH_HOME\storages\workspace.json`
里 `tables.workspaces.*.path` 为你的演示工作区，再重启。

---

## C. 启用自动整理：Curator → 长期合成 → Dreaming

随包默认配置是**保守档**：`curatorEnabled: false`、`longTermMode: 'off'`、
`dreamingEnabled: true`。Curator 自动整理与长期自动合成默认关闭，但 Dreaming 仍会在模型路由可用、满足阈值时维护浮动核心：默认启动延迟 90 秒，每 30 分钟检查一次，24 小时为间隔触发条件之一（不是固定每日执行）。若只想观察短期记忆与注入，请按下方第一步显式关闭 Dreaming。

建议逐步启用，每步都能停下来观察。

### C0. 前置：确认模型路由可用

Curator 与 Dreaming 都走 DSH 的模型路由（`ctx.llm`）。模型没配好时的典型表现是
`journal.jsonl` 里出现 `dreaming-run` 失败，设置页「Dreaming」运行记录显示
`failed — Curator LLM 返回空文本`。先在会话里确认模型能正常回话，再开自动整理。

### C1. 第一步：只观察（推荐配置，建议先跑 1～2 天）

```yaml
curatorEnabled: false      # 不自动整理
longTermMode: 'off'        # 不自动写长期记忆
dreamingEnabled: false     # 先关，避免没模型时反复失败
```

此时只验证：`memory_add` 能写、索引能注入、设置页能编辑/删除/回滚。

### C2. 第二步：打开 Curator，但长期记忆只出预览

```yaml
curatorEnabled: true
longTermMode: 'preview'    # 生成长期记忆但不落盘
curatorThresholdTurns: 20  # 工作区未整理回合达到 20 轮触发
curatorRunsPerHour: 3      # 每小时最多 3 次，防风暴
curatorStartupDelayMs: 60000
curatorDurabilityGate: true
```

要点：

- 触发是**工作区级**统计：该 `privateWorkspace` 下所有根会话的未整理完整回合累加，达到阈值即触发；
  新建 / 结束会话也会检查一次；子代理与 fork 不累计。
- **首次启用默认只建立游标**：已有会话的游标直接推进到最后一个完整回合，不重放历史。
  想回填历史就显式设 `curatorBackfill: true`（一次性，跑完可以改回 `false`）。
- 怎么看有没有生效：`journal.jsonl` 出现 `curator-run` / `extract` 事件；
  设置页「记忆库状态」的“记忆整理”一行会显示待整理轮数；长期记忆文件**不应变化**（preview 档）。

### C3. 第三步：允许写长期记忆

```yaml
longTermMode: 'apply'
```

- 每次写入前会把当前版本归档进 `summary_history/`，可随时 `memory_summary_rollback` 回滚；
- 输出被 `max-tokens` 截断时会自动延长重试，仍截断就不写入（不会留半截长期记忆）；
- 想冻结自动演化：设置页把「自动演化长期记忆」关掉，或 `autoSummary: false`，
  此后只有 `memory_consolidate` 能改。

### C4. 打开 Dreaming（浮动核心 + 重要经历提名）

```yaml
dreamingEnabled: true
dreamingIntervalHours: 24
dreamingMinNewMemories: 6
dreamingHeatThreshold: 3
dreamingRunsPerDay: 2
dreamingStartupDelayMs: 90000   # 开机别急着跑
```

触发条件（满足其一，并通过冷却与每日次数检查）：距上次运行达到间隔且有记忆、热度或核心数量变化；短期记忆变化达到 6 条；有效命中热度变化达到 3 条。
首次启用只建基线，不回溯历史。

Dreaming 的产出是**浮动核心记忆**（≤10 条）与“重要经历提名”。落盘前会写
`dream/<runId>/` 快照（含 sha256 清单）；提交用核心状态指纹 CAS，
提交时发现核心被你改过就整次放弃。回滚会拒绝复活已删内容或改写固定条目。

### C5. 不想等自动触发时，手动跑一次

| 目的 | 工具调用 |
|---|---|
| 看当前预算与待整理量 | `memory_status` |
| 手动跑一次短期抽取 + 长期合成 | `memory_curate`（按预算返回材料）→ `memory_consolidate`（显式写入） |
| 手动跑一次 Dreaming | `memory_dream`（`action=run`，可 `force=true`） |
| 看某次 Dreaming 结果并回滚 | `memory_dream`（`action=status` / `action=revert`（回滚时传入 `runId`）） |
| 回滚长期记忆到历史版本 | `memory_summary_rollback`（`version` 取 `summary_history` 里的编号） |

设置页也能做同样的事：「Dreaming」区块有“立即运行（可忽略间隔）”和每次运行的“回滚”按钮。

### C6. 启用后的自检清单

- [ ] `journal.jsonl` 里能看到 `curator-run`、`summary`、`dreaming-run` 三种事件；
- [ ] `memory_summary.md` 分区符合预期（对方是谁 / 我们怎么相处 / 对方在意什么 / 长期关注的领域 / …）；
- [ ] `summary_history/` 出现新版本，`index.json` 的 `maxVersion` 递增且无 `mismatched`；
- [ ] `floating_core.md` 条目都带 ≥2 个 `sources`，且来源 ID 在 `raw_memories.md` 或 `archive/` 里存在；
- [ ] 设置页「Dreaming」运行记录不是连续 `failed`；
- [ ] 故意写一条 `api_key = sk-xxxx` 会被拒绝（说明秘密检测仍生效）。

### C7. 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| Curator 一直不触发 | 累计不到 20 轮；或全是子代理会话 | 降低 `curatorThresholdTurns`，或在根会话里多聊几轮 |
| 首次启用后历史对话没进记忆 | 只建游标，不回填（设计如此） | 需要历史就设 `curatorBackfill: true` 跑一次 |
| 长期记忆不更新 | `longTermMode: off`；或 `autoSummary: false` | 改 `apply` / 恢复自动演化 |
| Dreaming 连续失败 | 模型路由不可用 / 输出不是合法 JSON | 先修模型；Dreaming 有格式重试与修复提示，仍失败会保留旧状态 |
| 浮动核心被拒 | 来源 <2 条、与长期记忆重合、或命中质量闸门 | 看错误里给出的 `CORE_*` 代码 |
| 回滚被拒 | 目标版本引用了已删除记忆，或快照会复活已删核心 | 接受现状，或先 `memory_restore` 再回滚 |

---

## D. 只跑测试

```powershell
# 一次性：把 DSH 自带的依赖链接进来（@deepseek-ai/schemastery 由 DSH 分发）
node scripts/link-runtime-deps.mjs --from "X:\path\to\dsh\node_modules"

node --test
node tests/privacy-scan.mjs .
node tests/check-package.mjs
node scripts/build-prompt-doc.mjs      # 改过提示词后重新生成 docs/prompts.md
```

期望：`tests 285 / pass 285 / fail 0`（Node 24 上实测）。

---

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报 `privateWorkspace 必填` | 配置没合并进去（cordis.patch.yml 没被 profile 读到） | 确认 `dsh.profile.bundles` 含 `dsh-memory-feiyu`，且 patch 的 `id` 一致 |
| `privateWorkspace 必须是绝对路径` | 用了相对路径或 `~` | 写完整盘符路径 |
| 设置页显示「不属于该工作区」 | 当前会话 cwd 不在 privateWorkspace 内 | 在该目录开新会话；或在「记忆设置」里核对路径 |
| 设置页只读 | Host 认证不可用（非本机 / 认证服务缺失） | 从本机浏览器打开 DSH；这是 fail-closed 的预期行为 |
| 工具调用报「只允许根会话」 | 在子代理 / fork 里调用 | 根会话里调用 |
| 长期记忆不更新 | `longTermMode: off` 或 Curator 未达 20 轮阈值 | 改 `apply`，或手动 `memory_consolidate` |
| `summary_history 索引不一致` | 手改过版本文件 | `node scripts/repair-summary-index.mjs <memoryDir> --apply` |
| `node --test` 报找不到 schemastery | 没链接运行时依赖 | `node scripts/link-runtime-deps.mjs --from …` |

## 卸载

```powershell
# 1. 从 profile 的 dsh.profile.bundles 里删掉 "dsh-memory-feiyu"
# 2. 删包目录
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-memory-feiyu" -Recurse -Force
# 3. 记忆库不会自动删除——要保留就备份，要清掉就删 memoryDir
```
