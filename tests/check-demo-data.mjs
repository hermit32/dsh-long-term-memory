/**
 * 演示数据合法性检查：确认 examples/demo-memory 里的时间格式、ID、引用与 JSON 结构都合法。
 * 只依赖 node 内置模块，可离线跑。
 *
 * 时间格式约定：
 *   - 面向人的 Markdown 字段（创建/更新/删除于/归档于）必须是带时区偏移的 ISO：
 *     YYYY-MM-DDTHH:mm:ss+08:00
 *   - 机器生成的 JSON / journal 用 toISOString()，即 UTC + 毫秒：YYYY-MM-DDTHH:mm:ss.sssZ
 *
 * 用法：node tests/check-demo-data.mjs [memoryDir]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const memoryDir = path.resolve(process.argv[2] ?? path.join(root, 'examples', 'demo-memory', 'memories-feiyu'));

const problems = [];
const fail = (message) => problems.push(message);

const ISO_OFFSET = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:[+-](0\d|1[0-4]):[0-5]\d)$/;
const ISO_UTC = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
const ENTRY_ID = /^mem-[0-9a-f]{8}$/;
const CORE_ID = /^fc-[0-9a-f]{8}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const read = async (file) => {
  try {
    return await fs.readFile(path.join(memoryDir, file), 'utf8');
  } catch (error) {
    fail(`读不到文件：${file}（${error.code ?? error.message}）`);
    return '';
  }
};

const readJson = async (file) => {
  const text = await read(file);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${file} 不是合法 JSON：${error.message}`);
    return null;
  }
};

/**
 * 校验一个时间字符串。
 * 先过正则再看 Date.parse：`24:10:00` 会被 Date 规范化成次日 00:10，不先卡正则就查不出来。
 */
const checkTime = (value, where, { allowUtc = false } = {}) => {
  const ok = ISO_OFFSET.test(value) || (allowUtc && ISO_UTC.test(value));
  if (!ok) {
    const expected = allowUtc
      ? 'YYYY-MM-DDTHH:mm:ss+08:00 或 YYYY-MM-DDTHH:mm:ss(.sss)Z'
      : 'YYYY-MM-DDTHH:mm:ss+08:00（小时 00-23）';
    fail(`${where} 时间格式不合法：${JSON.stringify(value)}（要求 ${expected}）`);
    return;
  }
  if (Number.isNaN(Date.parse(value))) fail(`${where} 时间无法解析：${value}`);
};

// ---------- 1. raw_memories.md ----------
const raw = await read('raw_memories.md');
const entries = [];
for (const block of raw.split(/^## /m).slice(1)) {
  const id = block.split('\n')[0].trim();
  if (!ENTRY_ID.test(id)) {
    fail(`raw_memories.md 条目 ID 不合法：${JSON.stringify(id)}`);
    continue;
  }
  entries.push({ id, block });
}
const ids = new Set(entries.map((entry) => entry.id));
if (ids.size !== entries.length) fail('raw_memories.md 存在重复 ID');

for (const entry of entries) {
  const created = /^- 创建:\s*(.+)$/m.exec(entry.block)?.[1]?.trim();
  const updated = /^- 更新:\s*(.+)$/m.exec(entry.block)?.[1]?.trim();
  const deletedAt = /^- 删除于:\s*(.+)$/m.exec(entry.block)?.[1]?.trim();
  if (!created) fail(`${entry.id} 缺少「创建」时间`);
  else checkTime(created, `${entry.id} 创建`);
  if (updated) checkTime(updated, `${entry.id} 更新`);
  if (deletedAt) checkTime(deletedAt, `${entry.id} 删除于`);
  const importance = /^- 重要度:\s*(\d+)$/m.exec(entry.block)?.[1];
  if (importance !== undefined && !['0', '1', '2', '3'].includes(importance)) {
    fail(`${entry.id} 重要度越界：${importance}`);
  }
  const quoteHash = /^- 引文哈希:\s*([0-9a-f]+)$/m.exec(entry.block)?.[1];
  if (quoteHash && !/^[0-9a-f]{8,64}$/.test(quoteHash)) fail(`${entry.id} 引文哈希格式异常：${quoteHash}`);
}

// ---------- 2. 冷库 ----------
const archiveRaw = await read('archive/raw_memories.md');
const archivedIds = new Set();
for (const block of archiveRaw.split(/^## /m).slice(1)) {
  const id = block.split('\n')[0].trim();
  if (!ENTRY_ID.test(id)) {
    fail(`archive/raw_memories.md 条目 ID 不合法：${JSON.stringify(id)}`);
    continue;
  }
  archivedIds.add(id);
  const created = /^- 创建:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const archivedAt = /^- 归档于:\s*(.+)$/m.exec(block)?.[1]?.trim();
  if (created) checkTime(created, `${id} 创建（冷库）`);
  if (archivedAt) checkTime(archivedAt, `${id} 归档于`);
}

// ---------- 3. 长期记忆引用 ----------
const summary = await read('memory_summary.md');
for (const match of summary.matchAll(/\[(mem-[0-9a-z]+)\]/g)) {
  const id = match[1];
  if (!ENTRY_ID.test(id)) fail(`memory_summary.md 引用 ID 不合法：${id}`);
  else if (!ids.has(id) && !archivedIds.has(id)) fail(`memory_summary.md 引用了不存在的记忆：${id}`);
}

// ---------- 4. 浮动核心 ----------
const core = await read('floating_core.md');
for (const match of core.matchAll(/<!-- feiyu-core:start ([^>]*)-->/g)) {
  const attrs = match[1];
  const id = /id="([^"]+)"/.exec(attrs)?.[1];
  const sources = /sources="([^"]*)"/.exec(attrs)?.[1] ?? '';
  const pinned = /pinned="([^"]*)"/.exec(attrs)?.[1];
  if (!id || !CORE_ID.test(id)) fail(`floating_core.md 核心 ID 不合法：${JSON.stringify(id)}`);
  const list = sources.split(',').map((item) => item.trim()).filter(Boolean);
  if (list.length < 2) fail(`${id} 来源少于 2 条：${JSON.stringify(list)}`);
  for (const source of list) {
    if (!ENTRY_ID.test(source)) fail(`${id} 来源 ID 不合法：${source}`);
    else if (!ids.has(source) && !archivedIds.has(source)) fail(`${id} 来源不存在：${source}`);
  }
  if (pinned !== undefined && !['0', '1'].includes(pinned)) fail(`${id} pinned 取值非法：${pinned}`);
  if (!/created="[^"]+"/.test(attrs)) fail(`${id} 缺少 created`);
}

// ---------- 5. 状态与统计 ----------
const state = await readJson('state.json');
if (state) {
  if (!Number.isInteger(state.summaryVersion)) fail('state.json summaryVersion 必须是整数');
  if (!['auto', 'manual'].includes(state.summaryMode)) fail(`state.json summaryMode 非法：${state.summaryMode}`);
}

const usage = await readJson('usage.json');
if (usage) {
  for (const [id, record] of Object.entries(usage.entries ?? {})) {
    if (!ENTRY_ID.test(id)) fail(`usage.json 出现非法 ID：${id}`);
    for (const day of Object.keys(record.daily ?? {})) {
      if (!DAY.test(day)) fail(`usage.json 日期键非法：${day}`);
      if (Number.isNaN(Date.parse(day))) fail(`usage.json 日期无法解析：${day}`);
    }
    if (record.lastHitAt) checkTime(record.lastHitAt, `${id} lastHitAt`, { allowUtc: true });
  }
}

const dreaming = await readJson('dreaming.json');
if (dreaming) {
  for (const run of dreaming.recentRuns ?? []) {
    if (!/^dream-\d{8}-\d{6}-[0-9a-f]{4}$/.test(run.runId ?? '')) fail(`dreaming.json runId 格式异常：${run.runId}`);
    if (!['applied', 'failed', 'skipped'].includes(run.status)) fail(`dreaming.json 运行状态非法：${run.status}`);
    if (run.startedAt) checkTime(run.startedAt, `${run.runId} startedAt`, { allowUtc: true });
    if (run.finishedAt) checkTime(run.finishedAt, `${run.runId} finishedAt`, { allowUtc: true });
  }
}

// ---------- 6. journal ----------
const journalText = await read('journal.jsonl');
let journalCount = 0;
for (const [index, line] of journalText.split('\n').entries()) {
  if (!line.trim()) continue;
  journalCount += 1;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    fail(`journal.jsonl 第 ${index + 1} 行不是合法 JSON`);
    continue;
  }
  checkTime(String(event.ts ?? ''), `journal 第 ${index + 1} 行`, { allowUtc: true });
  if (typeof event.op !== 'string' || event.op === '') fail(`journal 第 ${index + 1} 行缺少 op`);
  if (event.id && !ENTRY_ID.test(event.id)) fail(`journal 第 ${index + 1} 行 ID 非法：${event.id}`);
}

// ---------- 7. 墓碑与软删除数量一致 ----------
const tombstones = (await read('tombstones.jsonl')).split('\n').filter((line) => line.trim()).length;
const deletedCount = entries.filter((entry) => /^- 状态:\s*deleted$/m.test(entry.block)).length;
if (tombstones !== deletedCount) {
  fail(`墓碑数（${tombstones}）与软删除条目数（${deletedCount}）不一致`);
}

console.log(`memoryDir: ${memoryDir}`);
console.log(`活动条目 ${entries.length}（其中软删除 ${deletedCount}）、冷库 ${archivedIds.size}、journal ${journalCount} 行、墓碑 ${tombstones}`);
if (problems.length > 0) {
  console.error('\n发现演示数据问题：');
  for (const item of problems) console.error(`  - ${item}`);
  process.exit(1);
}
console.log('演示数据检查通过：时间格式、ID、引用、JSON 结构与计数全部合法。');
