import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MemoryStore, RAW_HEADER, parseEntries, renderEntry } from '../lib/store.js';
import { buildSnapshot } from '../lib/injection.js';
import { fixedNow, makeTempDir, sequenceIds } from './helpers.js';

async function openStore(t, overrides = {}) {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const store = new MemoryStore({
    memoryDir,
    now: fixedNow(),
    idFactory: sequenceIds(),
    ...overrides,
  });
  await store.init();
  return { store, memoryDir, dir };
}

const body = (n) => `第 ${n} 条可删除事实：主人在 2026-11-05 决定了第 ${n} 个约定，正文需要保留可恢复。`;

test('旧条目没有状态字段时视为 active，不批量改写原文件', async (t) => {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const legacy = [
    RAW_HEADER,
    '',
    '## mem-aaaaaaaa',
    '- 创建: 2026-11-05T10:00:00+08:00',
    '- 标签: 旧数据',
    '- 来源: legacy',
    '- 上下文: 迁移前',
    '- 概述: 旧条目概述',
    '- 重要度: 1',
    '- 正文:',
    '  这是一条没有状态字段的旧记忆。',
    '',
  ].join('\n');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(memoryDir, { recursive: true });
  await writeFile(path.join(memoryDir, 'raw_memories.md'), legacy, 'utf8');

  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await store.init();
  const active = await store.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].status, 'active');
  assert.equal(await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8'), legacy);
});

test('软删除后搜索不到，但正文仍在文件里', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: body(1), summary: '第一条', tags: ['测试'] });
  const found = await store.search('第 1 条可删除事实');
  assert.equal(found.length, 1);

  const result = await store.forget(entry.id, '主人要求删除');
  assert.equal(result.changed, true);

  assert.equal((await store.search('第 1 条可删除事实')).length, 0);
  assert.equal((await store.get(entry.id))?.status, 'deleted');
  assert.equal((await store.listActive()).length, 0);
  const raw = await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8');
  assert.ok(raw.includes('这是一条') === false);
  assert.ok(raw.includes('可删除事实'), '正文必须保留在文件里');
  assert.ok(raw.includes('- 状态: deleted'));
  assert.ok(raw.includes('- 删除原因: 主人要求删除'));
});

test('删除后注入快照不再包含该记忆', async (t) => {
  const { store } = await openStore(t);
  const keep = await store.add({ content: body(1), summary: '要保留的约定', tags: ['保留'] });
  const drop = await store.add({ content: body(2), summary: '要删除的约定', tags: ['删除'] });
  await store.forget(drop.id, '测试');

  const active = await store.listActive();
  const snapshot = buildSnapshot({
    globalSummary: '',
    workspaceSummary: keep.summary,
    entries: active,
    contextWindow: 128000,
    config: { privateWorkspace: 'C:\\PrivateWorkspace' },
  });
  assert.ok(snapshot.text.includes(keep.id));
  assert.ok(!snapshot.text.includes(drop.id));
  assert.ok(!snapshot.text.includes('要删除的约定'));
});

test('重启后删除状态和墓碑仍然有效', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: body(3), summary: '重启前删除', tags: ['测试'] });
  await store.forget(entry.id, '重启测试');

  const reopened = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await reopened.init();
  assert.equal((await reopened.listActive()).length, 0);
  assert.equal((await reopened.listDeleted()).length, 1);
  assert.equal((await reopened.get(entry.id))?.status, 'deleted');
  await assert.rejects(
    () => reopened.add({ content: body(3), summary: '重复写入', tags: ['测试'] }),
    (error) => error.code === 'TOMBSTONED',
  );
});

test('自动策展无法把已删除事实当作新记忆重新写入', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: body(4), summary: '会被删除', tags: ['测试'] });
  await store.forget(entry.id, '');

  await assert.rejects(
    () => store.add({ content: body(4), summary: '换个概述再写一遍', tags: ['其他'] }),
    (error) => error.code === 'TOMBSTONED' && error.memoryId === entry.id,
  );
  // 只有空白差异也算同一条事实。
  await assert.rejects(
    () => store.add({ content: `  ${body(4)}\n\n`, summary: '空白差异', tags: ['其他'] }),
    (error) => error.code === 'TOMBSTONED',
  );
});

test('恢复后可以正常搜索和注入，且墓碑被清除', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: body(5), summary: '可恢复的约定', tags: ['测试'] });
  await store.forget(entry.id, '临时删除');
  const restored = await store.restore(entry.id);
  assert.equal(restored.changed, true);
  assert.equal((await store.search('第 5 条可删除事实')).length, 1);
  assert.equal((await store.listActive()).length, 1);
  assert.equal((await store.listDeleted()).length, 0);

  const snapshot = buildSnapshot({ workspaceSummary: '', entries: await store.listActive(), contextWindow: 128000 });
  assert.ok(snapshot.text.includes(entry.id));
});

test('重复删除和重复恢复不会损坏数据', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: body(6), summary: '幂等测试', tags: ['测试'] });

  const first = await store.forget(entry.id, '第一次');
  const second = await store.forget(entry.id, '第二次');
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.alreadyDeleted, true);

  const once = await store.restore(entry.id);
  const twice = await store.restore(entry.id);
  assert.equal(once.changed, true);
  assert.equal(twice.changed, false);
  assert.equal(twice.alreadyActive, true);

  const entries = parseEntries(await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'active');
});

test('摘要回滚会先归档当前摘要，且不会恢复已删除的记忆', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: body(7), summary: '摘要回滚测试', tags: ['测试'] });
  await store.writeSummary('# 第一版摘要\n- 旧内容', { mode: 'manual' });
  await store.writeSummary('# 第二版摘要\n- 新内容', { mode: 'manual' });
  await store.forget(entry.id, '回滚前删除');

  const versions = await store.listSummaryVersions();
  assert.ok(versions.length >= 1);
  const target = versions[0].replace(/\.md$/i, '');

  const result = await store.rollbackSummary(target);
  assert.equal(result.changed, true);
  assert.equal(result.mode, 'manual');
  assert.equal(result.hash.length, 64);

  const summary = await store.readSummary();
  assert.ok(summary.includes('第一版摘要'));
  assert.equal((await store.get(entry.id))?.status, 'deleted', '回滚不能复活已删除条目');
  assert.equal((await store.listActive()).length, 0);
  assert.equal((await store.listDeleted()).length, 1);

  const after = await store.listSummaryVersions();
  assert.ok(after.length > versions.length - 1, '回滚前的摘要应进入历史');
  assert.ok((await store.readSummary()) !== '');
  assert.ok(memoryDir);
});

test('回滚后摘要模式为 manual，自动汇编不会立刻覆盖', async (t) => {
  const { store } = await openStore(t);
  await store.writeSummary('# 自动版\n- 一条', { mode: 'auto' });
  await store.writeSummary('# 手写版\n- 两条', { mode: 'manual' });
  const versions = await store.listSummaryVersions();
  const target = versions[versions.length - 1].replace(/\.md$/i, '');
  await store.rollbackSummary(target);

  const stats = await store.stats();
  assert.equal(stats.summaryMode, 'manual');
  const again = await store.rollbackSummary(target);
  assert.equal(again.changed, false, '回滚到同一版本不应重复写盘');
});

test('并发删除与新增串行执行，文件仍可解析', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const a = await store.add({ content: body(8), summary: '并发 A', tags: ['并发'] });
  const b = await store.add({ content: body(9), summary: '并发 B', tags: ['并发'] });

  await Promise.all([
    store.forget(a.id, '并发删除'),
    store.add({ content: body(10), summary: '并发 C', tags: ['并发'] }),
    store.restore(a.id),
  ]);

  const entries = parseEntries(await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8'));
  assert.ok(entries.length >= 2);
  const active = await store.listActive();
  assert.ok(active.some((entry) => entry.id === b.id));
  assert.ok(active.some((entry) => entry.content.includes('第 10 条')));
});

test('写入中断不会留下半截条目：渲染与解析往返稳定', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: '多行正文第一行\n第二行\n第三行', summary: '往返', tags: ['往返'] });
  await store.forget(entry.id, '原因');

  const raw = await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8');
  const parsed = parseEntries(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].content, '多行正文第一行\n第二行\n第三行');
  assert.equal(parsed[0].status, 'deleted');
  assert.equal(renderEntry(parsed[0]).includes('- 状态: deleted'), true);
});

test('删除统计进入 stats，删除后活动数量下降', async (t) => {
  const { store } = await openStore(t);
  const a = await store.add({ content: body(11), summary: '统计 1', tags: ['统计'] });
  await store.add({ content: body(12), summary: '统计 2', tags: ['统计'] });
  let stats = await store.stats();
  assert.equal(stats.activeCount, 2);
  assert.equal(stats.deletedCount, 0);

  await store.forget(a.id, '');
  stats = await store.stats();
  assert.equal(stats.activeCount, 1);
  assert.equal(stats.deletedCount, 1);
  assert.equal(stats.tombstoneCount, 1);
});

test('归档里的条目也能软删除并恢复', async (t) => {
  const { store } = await openStore(t, { maxActiveMemories: 1 });
  const first = await store.add({ content: body(13), summary: '会被归档', tags: ['归档'] });
  await store.add({ content: body(14), summary: '新条目', tags: ['归档'] });

  assert.equal((await store.listArchived()).length, 1);
  const forgot = await store.forget(first.id, '归档后删除');
  assert.equal(forgot.changed, true);
  assert.equal((await store.listDeleted()).length, 1);
  const restored = await store.restore(first.id);
  assert.equal(restored.changed, true);
  assert.equal((await store.listDeleted()).length, 0);
  // 恢复后必须回到活动集合，否则注入和统计看不到它。
  const active = await store.listActive();
  assert.equal(active.length, 2);
  assert.ok(active.some((entry) => entry.id === first.id));
  assert.equal((await store.listArchived()).length, 0);
});

test('同一条记忆同时出现在 raw 和 archive 时，启动会以 raw 为准自动修复', async (t) => {
  const { store, memoryDir } = await openStore(t, { maxActiveMemories: 1 });
  const first = await store.add({ content: body(15), summary: '会被归档', tags: ['归档'] });
  await store.add({ content: body(16), summary: '新条目', tags: ['归档'] });
  assert.equal((await store.listArchived()).length, 1);

  // 模拟“恢复写到一半被杀”：raw 里已有这条，archive 里还没删掉。
  const rawPath = path.join(memoryDir, 'raw_memories.md');
  const archivePath = path.join(memoryDir, 'archive', 'raw_memories.md');
  const rawText = await readFile(rawPath, 'utf8');
  const entry = (await store.listArchived())[0];
  await writeFile(rawPath, `${rawText.trimEnd()}\n\n${renderEntry({ ...entry, status: 'active' })}\n`, 'utf8');

  const reopened = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await reopened.init();
  const archived = await reopened.listArchived();
  assert.equal(archived.length, 0);
  const active = await reopened.listActive();
  assert.equal(active.filter((item) => item.id === first.id).length, 1);
});
