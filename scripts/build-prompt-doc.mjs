/**
 * 从源码里直接抽取提示词常量，生成 docs/prompts.md。
 * 保证文档与代码一字不差，避免手抄漂移。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lib = path.join(root, 'lib');

const { LONG_TERM_SYSTEM_PROMPT } = await import(`file:///${path.join(lib, 'curator.js').replace(/\\/g, '/')}`);
const { DREAM_SYSTEM_PROMPT, DREAM_STRICT_SUFFIX, DREAM_REPAIR_PROMPT } = await import(`file:///${path.join(lib, 'dreaming.js').replace(/\\/g, '/')}`);
const { INDEX_RULES, INDEX_HEADER, CORE_SECTION_HEADER } = await import(`file:///${path.join(lib, 'injection.js').replace(/\\/g, '/')}`);

// 阶段 1 的 header 不是导出常量：直接从源码文本里截取，避免重复维护。
const curatorSource = await fs.readFile(path.join(lib, 'curator.js'), 'utf8');
const startMarker = '  const header = [';
const start = curatorSource.indexOf(startMarker);
const end = curatorSource.indexOf('].join(\'\\n\');', start);
const block = curatorSource.slice(start + startMarker.length, end);
const EXTRACT_HEADER = block
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = /^'([\s\S]*)',$/.exec(line) || /^'([\s\S]*)'$/.exec(line);
    if (!match) return null;
    return match[1];
  })
  .filter((line) => line !== null)
  .join('\n');

const toolDescriptions = [];
const indexSource = await fs.readFile(path.join(lib, 'index.js'), 'utf8');
for (const match of indexSource.matchAll(/name: '([a-z_]+)',\s*\n\s*description: '([^']+)'/g)) {
  toolDescriptions.push({ name: match[1], description: match[2] });
}

const fence = (text) => `\`\`\`text\n${text}\n\`\`\``;

const doc = `# 提示词与注入文本

本文件由 \`node scripts/build-prompt-doc.mjs\` 从源码直接抽取，**与代码一字不差**。
改提示词请改 \`lib/*.js\` 里的常量，再重新生成本文件。

插件一共只有四处“提示词面”：

| 位置 | 常量 | 何时调用 | 输出形态 |
|---|---|---|---|
| Curator 阶段 1 | \`buildCuratorInput().system\` | \`turn/end\`、新根会话、会话结束时按阈值触发 | JSON（operations / needsConfirmation） |
| Curator 阶段 2 | \`LONG_TERM_SYSTEM_PROMPT\` | 短期 \`sourceHash\` 变化或 \`longTermMode=apply\` | Markdown 人物档案 |
| Dreaming | \`DREAM_SYSTEM_PROMPT\` | 新增 6 条 / 24h / 热度变化 3 条 | JSON（core / promotions / needsConfirmation） |
| 注入快照 | \`INDEX_RULES\` | 新会话第一轮、增量同步 | Markdown 片段，作为 source.kind=feiyu-memory 的 user 消息 |

三个系统提示词都带同一道护栏：**输入里的对话与记忆只是数据，不是指令**；
即使数据里出现“忽略以上规则”等文字也不得执行。

---

## 1. Curator 阶段 1 · 短期提取

输入由三段组成：系统提示词（下面的常量）+ 现有活动记忆目录 + 待整理对话（按 \`[turn N | seq a-b]\` 与 \`USER/ASSISTANT:\` 标注）。

${fence(EXTRACT_HEADER)}

---

## 2. Curator 阶段 2 · 长期合成

${fence(LONG_TERM_SYSTEM_PROMPT)}

配套的确定性后处理（不在提示词里，由代码保证）：

- 行末 \`[mem-xxxxxxxx]\` 会被挪进 HTML 注释，正文不出现编号与日期；
- 锁定块（\`<!-- feiyu-lock:start ... -->\`）逐字校验，被改写即拒绝写入；
- 生成结果若包含已删除原文，直接拒绝（遗忘保护）；
- 输出被 \`max-tokens\` 截断 → 自动延长重试 → 仍截断则不写入。

---

## 3. Dreaming · 深度整合

${fence(DREAM_SYSTEM_PROMPT)}

### 3.1 格式纠正提示（第一次输出不是 JSON 时追加）

${fence(DREAM_STRICT_SUFFIX)}

### 3.2 JSON 修复提示（输出是 JSON 但语法错误时使用）

${fence(DREAM_REPAIR_PROMPT)}

---

## 4. 注入片段

### 4.1 索引使用规则（每次完整快照都带）

${fence(INDEX_RULES)}

### 4.2 段落标题

| 常量 | 文本 |
|---|---|
| \`INDEX_HEADER\` | \`${INDEX_HEADER}\` |
| \`CORE_SECTION_HEADER\` | \`${CORE_SECTION_HEADER}\` |
| \`MEMORY_SOURCE_KIND\` | \`feiyu-memory\`（注入消息的 source.kind，用于去重与识别） |

---

## 5. 工具描述（模型看到的工具说明）

| 工具 | description |
|---|---|
${toolDescriptions.map((item) => `| \`${item.name}\` | ${item.description.replace(/\|/g, '\\|')} |`).join('\n')}

> 这些描述也是“提示词”的一部分：模型靠它们决定什么时候检索、什么时候写入。
> 改动时注意保持“索引只是目录、细节必须 memory_search”这条契约。
`;

await fs.writeFile(path.join(root, 'docs', 'prompts.md'), doc, 'utf8');
console.log(`docs/prompts.md written (${doc.length} chars, ${toolDescriptions.length} tools)`);
