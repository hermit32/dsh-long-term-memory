import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { MemoryStore, RAW_HEADER, SecretDetectedError, contentFingerprint } from '../lib/store.js';
import { makeTempDir, sequenceIds } from './helpers.js';

async function openStore(t, overrides = {}) {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const store = new MemoryStore({
    memoryDir,
    idFactory: sequenceIds(),
    now: () => new Date('2026-11-06T09:00:00+08:00'),
    ...overrides,
  });
  await store.init();
  return { dir, memoryDir, store };
}

test('单条坏记录不会拖垮整个库：好记录可读、坏块保留、写操作拒绝覆盖', async (t) => {
  const { dir, memoryDir } = await openStore(t);
  const good = [
    RAW_HEADER,
    '',
    '## mem-aaaaaaaa',
    '- 创建: 2026-11-05T10:00:00+08:00',
    '- 标签: 好数据',
    '- 概述: 好记录',
    '- 正文:',
    '  这条记录是完整的。',
    '',
  ].join('\n');
  const bad = '## mem-bbbbbbbb\n- 标签: 坏数据\n';
  const file = path.join(memoryDir, 'raw_memories.md');
  await writeFile(file, `${good}\n${bad}`, 'utf8');

  const store = new MemoryStore({ memoryDir, idFactory: sequenceIds(), now: () => new Date('2026-11-06T09:00:00+08:00') });
  await store.init();
  const active = await store.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'mem-aaaaaaaa');
  const stats = await store.stats();
  assert.equal(stats.parseErrors, 1);
  assert.match(stats.parseErrorDetails[0].reason, /缺少创建时间/);
  const diagnostics = JSON.parse(await readFile(path.join(memoryDir, 'parse-diagnostics.json'), 'utf8'));
  assert.equal(diagnostics.files.raw.errors.length, 1);
  const corruptFiles = await readdir(path.join(memoryDir, 'corrupt'));
  assert.ok(corruptFiles.some((name) => name.startsWith('raw-')));
  await assert.rejects(() => store.add({ content: '新记忆', summary: '新' }), (error) => error.code === 'MEMORY_CORRUPT');
  assert.equal((await readFile(file, 'utf8')).includes('这条记录是完整的。'), true);
  assert.equal((await readFile(file, 'utf8')).includes('坏数据'), true);
  assert.ok(dir);
});

test('state.json 损坏不会静默清空墓碑，删除保证仍有效', async (t) => {
  const { memoryDir, store } = await openStore(t);
  const entry = await store.add({ content: '删除后必须保持删除的事实', summary: '删除测试' });
  await store.forget(entry.id, '用户删除');
  await writeFile(path.join(memoryDir, 'state.json'), '{ this is not json', 'utf8');
  await rm(path.join(memoryDir, 'tombstones.jsonl'), { force: true });

  const reopened = new MemoryStore({ memoryDir, idFactory: sequenceIds(), now: () => new Date('2026-11-06T09:00:00+08:00') });
  await reopened.init();
  const stats = await reopened.stats();
  assert.equal(stats.stateRecovered, true);
  assert.equal(stats.tombstoneCount, 1);
  assert.equal((await reopened.listDeleted()).length, 1);
  await assert.rejects(() => reopened.add({ content: '删除后必须保持删除的事实', summary: '重写' }), (error) => error.code === 'TOMBSTONED');
  const corrupt = (await readdir(memoryDir)).filter((name) => name.startsWith('state.corrupt-'));
  assert.ok(corrupt.length >= 1);
});

test('重复删除失败重试会补写墓碑，重复恢复会清除残留墓碑', async (t) => {
  const { memoryDir, store } = await openStore(t);
  const entry = await store.add({ content: '删除重试事实', summary: '删除重试' });
  await store.forget(entry.id, '第一次');
  const tombstoneFile = path.join(memoryDir, 'tombstones.jsonl');
  const before = await readFile(tombstoneFile, 'utf8');
  await writeFile(tombstoneFile, '', 'utf8');
  const reopened = new MemoryStore({ memoryDir, idFactory: sequenceIds(), now: () => new Date('2026-11-06T09:00:00+08:00') });
  await reopened.init();
  // 启动对账会从 deleted 条目恢复墓碑；再删除一次必须幂等且补齐。
  const again = await reopened.forget(entry.id, '第二次');
  assert.equal(again.changed, false);
  assert.equal((await reopened.stats()).tombstoneCount, 1);
  assert.ok(before.includes('delete'));

  const restored = await reopened.restore(entry.id);
  assert.equal(restored.changed, true);
  const twice = await reopened.restore(entry.id);
  assert.equal(twice.changed, false);
  assert.equal((await reopened.stats()).tombstoneCount, 0);
});

test('摘要版本号冲突时不会覆盖已有历史文件', async (t) => {
  const { memoryDir, store } = await openStore(t);
  await store.writeSummary('第一版', { mode: 'auto' });
  await store.writeSummary('第二版', { mode: 'auto' });
  await store.writeSummary('第三版', { mode: 'auto' });
  const before = new Map();
  for (const name of await store.listSummaryVersions()) before.set(name, await readFile(path.join(memoryDir, 'summary_history', name), 'utf8'));
  await writeFile(path.join(memoryDir, 'state.json'), '{"summaryVersion":0,"summaryMode":"auto"}', 'utf8');
  const reopened = new MemoryStore({ memoryDir, idFactory: sequenceIds(), now: () => new Date('2026-11-06T09:00:00+08:00') });
  await reopened.init();
  await reopened.writeSummary('第四版', { mode: 'auto' });
  for (const [name, content] of before) {
    assert.equal(await readFile(path.join(memoryDir, 'summary_history', name), 'utf8'), content, `${name} 不能被覆盖`);
  }
  assert.ok((await reopened.listSummaryVersions()).length >= before.size);
});

test('摘要回滚不能把已删除记忆的 ID 带回活动摘要', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: '会被删除的事实', summary: '删除目标' });
  await store.writeSummary(`旧摘要引用 ${entry.id}`, { mode: 'manual' });
  await store.writeSummary('当前摘要不含删除条目', { mode: 'manual' });
  await store.forget(entry.id, '测试');
  const versions = await store.listSummaryVersions();
  let target = '';
  for (const name of versions) {
    if ((await readFile(path.join(store.historyDir, name), 'utf8')).includes(entry.id)) { target = name; break; }
  }
  assert.ok(target);
  await assert.rejects(() => store.rollbackSummary(target), (error) => error.code === 'SUMMARY_REFERENCES_DELETED');
  assert.equal(await store.readSummary(), '当前摘要不含删除条目');
});

test('活动容量只统计 active，不把已删除条目算进去', async (t) => {
  const { store } = await openStore(t, { maxActiveMemories: 2 });
  const a = await store.add({ content: '活动 A', summary: 'A' });
  await store.add({ content: '活动 B', summary: 'B' });
  await store.forget(a.id, '删除');
  await store.add({ content: '活动 C', summary: 'C' });
  const stats = await store.stats();
  assert.ok(stats.activeCount <= 2);
  assert.equal(stats.deletedCount, 1);
  assert.ok((await store.listDeleted()).some((entry) => entry.id === a.id));
});

test('revisions 使用稳定 rev，删除序号后仍可按 rev 回退', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: '原始正文', summary: '原始' });
  await store.update(entry.id, { content: '第一次修改' }, '第一次');
  const history = await store.revisions(entry.id);
  assert.equal(history.length, 1);
  assert.match(history[0].rev, /^rev-\d{6}$/);
  await store.update(entry.id, { content: '第二次修改' }, '第二次');
  const reverted = await store.revert(entry.id, history[0].rev);
  assert.equal(reverted.changed, true);
  assert.equal((await store.get(entry.id)).content, '原始正文');
});

test('revert 不能把墓碑中的已删除事实写回活动记忆', async (t) => {
  const { store } = await openStore(t);
  const a = await store.add({ content: '事实 A 的旧正文', summary: 'A' });
  const b = await store.add({ content: '事实 B', summary: 'B' });
  await store.update(a.id, { content: '事实 A 的新正文' }, '修改');
  await store.forget(b.id, '删除 B');
  // 手工构造 A 的历史快照为 B 的正文；模拟历史快照与已删事实重合。
  const revisions = await store.revisions(a.id);
  assert.equal(revisions.length, 1);
  const file = path.join(store.memoryDir, 'revisions.jsonl');
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  const record = JSON.parse(lines[0]);
  record.previous.content = '事实 B';
  await writeFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  await assert.rejects(() => store.revert(a.id, record.rev), (error) => error.code === 'TOMBSTONED');
});

test('秘密检测覆盖 tags / context / source / 摘要 / 删除原因', async (t) => {
  const { store } = await openStore(t);
  await assert.rejects(() => store.add({ content: '普通正文', tags: 'api_key=sk-1234567890abcdef' }), SecretDetectedError);
  await assert.rejects(() => store.add({ content: '普通正文', context: 'password: abcdef123' }), SecretDetectedError);
  await assert.rejects(() => store.add({ content: '普通正文', source: 'token: abcdef123456' }), SecretDetectedError);
  await assert.rejects(() => store.writeSummary('密码是 123456', { mode: 'manual' }), SecretDetectedError);
  const entry = await store.add({ content: '正常删除原因测试', summary: '正常' });
  await assert.rejects(() => store.forget(entry.id, '密码是 123456'), SecretDetectedError);
});

test('摘要相同不重复归档，模式切换不制造空版本', async (t) => {
  const { store } = await openStore(t);
  await store.writeSummary('稳定摘要', { mode: 'manual' });
  const versions = (await store.listSummaryVersions()).length;
  const same = await store.writeSummary('稳定摘要', { mode: 'manual' });
  assert.equal(same.changed, false);
  assert.equal((await store.listSummaryVersions()).length, versions);
  const switched = await store.writeSummary('稳定摘要', { mode: 'auto' });
  assert.equal(switched.changed, true);
  assert.equal(switched.modeChanged, true);
  assert.equal((await store.listSummaryVersions()).length, versions);
  await store.setSummaryMode('manual');
  assert.equal((await store.stats()).summaryMode, 'manual');
});

test('解析器严格模式仍对坏块报错，供调用方显式检查', async () => {
  const { parseEntries } = await import('../lib/store.js');
  assert.throws(() => parseEntries(`${RAW_HEADER}\n\n## mem-cccccccc\n- 标签: 坏\n`), /缺少创建时间/);
  assert.equal(contentFingerprint('  A  B '), contentFingerprint('A B'));
});
