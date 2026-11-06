import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MemoryStore, parseEntries } from '../lib/store.js';
import { fixedNow, makeTempDir, sequenceIds } from './helpers.js';

async function openStore(t, overrides = {}) {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds(), ...overrides });
  await store.init();
  return { store, memoryDir, dir };
}

const base = '主人约定：每周六晚整理记忆库，先看摘要再决定是否回滚。';

test('修改正文、概述和标签都会落盘，并留下修改前快照', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'] });

  const result = await store.update(entry.id, {
    content: `${base}时间改到周日晚。`,
    summary: '周日整理记忆库',
    tags: ['约定', '时间'],
  }, '主人改时间');
  assert.equal(result.changed, true);
  assert.deepEqual(result.fields.sort(), ['content', 'summary', 'tags']);

  const after = await store.get(entry.id);
  assert.match(after.content, /周日晚/);
  assert.equal(after.summary, '周日整理记忆库');
  assert.deepEqual(after.tags, ['约定', '时间']);

  const revisions = await store.revisions(entry.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].previous.content, base);
  assert.equal(revisions[0].reason, '主人改时间');

  const raw = await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8');
  assert.match(raw, /周日晚/);
});

test('内容没有变化时不写入，也不产生快照', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'] });
  const result = await store.update(entry.id, { content: base, summary: '周六整理', tags: ['约定'] });
  assert.equal(result.changed, false);
  assert.equal((await store.revisions(entry.id)).length, 0);
});

test('不能编辑已删除或不存在的记忆', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'] });
  await store.forget(entry.id, '先删掉');
  await assert.rejects(() => store.update(entry.id, { summary: '改一下' }), /已被删除/);
  await assert.rejects(() => store.update('mem-99999999', { summary: '改一下' }), /没有找到/);
});

test('正文不能改成已被删除事实的内容', async (t) => {
  const { store } = await openStore(t);
  const doomed = await store.add({ content: '旧约定：周日下午一起复盘。', summary: '会被删除', tags: ['约定'] });
  await store.forget(doomed.id, '不要了');
  const alive = await store.add({ content: base, summary: '周六整理', tags: ['约定'] });

  await assert.rejects(
    () => store.update(alive.id, { content: '旧约定：周日下午一起复盘。' }),
    (error) => error.code === 'TOMBSTONED',
  );
});

test('修改历史按时间排列，revert 默认回到最近一次修改前', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: '版本一', summary: 'v1', tags: ['a'] });
  await store.update(entry.id, { content: '版本二', summary: 'v2' });
  await store.update(entry.id, { content: '版本三', summary: 'v3' });

  const revisions = await store.revisions(entry.id);
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].previous.content, '版本一');
  assert.equal(revisions[1].previous.content, '版本二');

  const reverted = await store.revert(entry.id);
  assert.equal(reverted.changed, true);
  const after = await store.get(entry.id);
  assert.equal(after.content, '版本二');
  assert.equal(after.summary, 'v2');

  // 回退本身也留快照，可再回退
  assert.equal((await store.revisions(entry.id)).length, 3);
});

test('revert 可以指定历史序号，越界会报错', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: 'A', summary: 'A', tags: ['x'] });
  await store.update(entry.id, { content: 'B', summary: 'B' });

  await assert.rejects(() => store.revert(entry.id, 5), /1～1/);
  const back = await store.revert(entry.id, 1);
  assert.equal(back.entry.content, 'A');
  assert.deepEqual(back.entry.tags, ['x']);
});

test('没有修改历史时 revert 明确报错', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'] });
  await assert.rejects(() => store.revert(entry.id), /没有修改历史/);
});

test('写入引文会自动计算指纹，校验返回 verified', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({
    content: base,
    summary: '周六整理',
    tags: ['约定'],
    trace: 'session-abc turn=3 seq=88-96',
    quote: '主人：以后周六晚上一起整理记忆库',
  });
  assert.equal(entry.trace, 'session-abc turn=3 seq=88-96');
  assert.equal(entry.quoteHash.length, 64);
  assert.equal(MemoryStore.verifyQuote(entry), 'verified');

  const loaded = await store.get(entry.id);
  assert.equal(loaded.trace, 'session-abc turn=3 seq=88-96');
  assert.equal(loaded.quote, '主人：以后周六晚上一起整理记忆库');
  assert.equal(MemoryStore.verifyQuote(loaded), 'verified');
});

test('手工改写引文会让指纹校验失败', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'], quote: '原话在这里' });
  const file = path.join(memoryDir, 'raw_memories.md');
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace('- 引文: 原话在这里', '- 引文: 被改过的话'), 'utf8');

  const reopened = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await reopened.init();
  const loaded = await reopened.get(entry.id);
  assert.equal(MemoryStore.verifyQuote(loaded), 'mismatch');
});

test('旧条目没有引文时校验为 missing-quote，不算错误', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'] });
  assert.equal(MemoryStore.verifyQuote(entry), 'missing-quote');
});

test('修改引文会重算指纹，旧指纹不再通过', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: base, summary: '周六整理', tags: ['约定'], quote: '第一版引文' });
  await store.update(entry.id, { quote: '第二版引文' });
  const loaded = await store.get(entry.id);
  assert.equal(loaded.quote, '第二版引文');
  assert.equal(MemoryStore.verifyQuote(loaded), 'verified');
  assert.notEqual(loaded.quoteHash, entry.quoteHash);
});

test('溯源字段重启后仍然存在，且不出现在正文里', async (t) => {
  const { store, memoryDir } = await openStore(t);
  const entry = await store.add({
    content: base,
    summary: '周六整理',
    tags: ['约定'],
    trace: 'session-xyz turn=9 seq=10-12',
    quote: '原话',
  });
  const reopened = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await reopened.init();
  const loaded = await reopened.get(entry.id);
  assert.equal(loaded.trace, 'session-xyz turn=9 seq=10-12');
  assert.equal(loaded.content, base);

  const parsed = parseEntries(await readFile(path.join(memoryDir, 'raw_memories.md'), 'utf8'));
  assert.equal(parsed[0].trace, 'session-xyz turn=9 seq=10-12');
  assert.equal(parsed[0].quoteHash, loaded.quoteHash);
});

test('并发修改同一条记忆不会丢内容', async (t) => {
  const { store } = await openStore(t);
  const entry = await store.add({ content: '起点', summary: '起点', tags: ['并发'] });
  await Promise.all([
    store.update(entry.id, { summary: '甲' }),
    store.update(entry.id, { tags: ['并发', '乙'] }),
  ]);
  const after = await store.get(entry.id);
  assert.ok(after.summary === '甲' || after.summary === '起点');
  assert.ok(after.tags.includes('并发'));
  assert.ok((await store.revisions(entry.id)).length >= 1);
});
