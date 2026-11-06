import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  MemoryStore,
  SecretDetectedError,
  assertNoSecrets,
  parseEntries,
  renderEntry,
} from '../lib/store.js';
import { makeTempDir, sequenceIds, fixedNow } from './helpers.js';

async function newStore(t, options = {}) {
  const dir = await makeTempDir(t);
  const store = new MemoryStore({
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    idFactory: sequenceIds(),
    now: fixedNow(),
    ...options,
  });
  await store.init();
  return { store, dir };
}

test('空白初始化：目录、文件与空内容', async (t) => {
  const { store } = await newStore(t);
  assert.equal(await store.readSummary(), '');
  assert.equal(await store.readGlobalSummary(), '');
  assert.deepEqual(await store.listActive(), []);
  assert.deepEqual(await store.listArchived(), []);
  const raw = await readFile(path.join(store.memoryDir, 'raw_memories.md'), 'utf8');
  assert.match(raw, /feiyu-raw v1/);
  const summary = await readFile(path.join(store.memoryDir, 'memory_summary.md'), 'utf8');
  assert.match(summary, /feiyu-summary v1/);
  assert.equal((await stat(path.join(store.memoryDir, 'journal.jsonl'))).size, 0);
  for (const child of ['summary_history', 'archive']) {
    assert.ok((await stat(path.join(store.memoryDir, child))).isDirectory());
  }
});

test('新增、读取与 Markdown 往返', async (t) => {
  const { store } = await newStore(t);
  const entry = await store.add({
    content: '第一行\n## mem-deadbeef 这是正文里的标题\n第三行',
    tags: '项目，记忆',
    summary: '往返测试',
    source: 'test',
    context: 'case=roundtrip',
    importance: 3,
  });
  assert.match(entry.id, /^mem-[0-9a-f]{8}$/);
  assert.equal(entry.createdAt, '2026-11-05T23:10:00+08:00');
  const active = await store.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].content, '第一行\n## mem-deadbeef 这是正文里的标题\n第三行');
  assert.deepEqual(active[0].tags, ['项目', '记忆']);
  assert.equal((await store.get(entry.id))?.summary, '往返测试');

  const roundtrip = parseEntries(renderEntry(active[0]));
  assert.deepEqual(roundtrip, [active[0]]);
});

test('并发新增不会互相覆盖', async (t) => {
  const { store } = await newStore(t);
  await Promise.all(Array.from({ length: 6 }, (_, i) => store.add({
    content: `并发记忆 ${i}`,
    tags: '并发',
    summary: `并发 ${i}`,
  })));
  const active = await store.listActive();
  assert.equal(active.length, 6);
  assert.equal(new Set(active.map((entry) => entry.id)).size, 6);
});

test('唯一 ID：工厂重复时拒绝写入', async (t) => {
  const { store } = await newStore(t, { idFactory: () => 'mem-00000001' });
  await store.add({ content: '第一条', summary: '第一条' });
  await assert.rejects(
    store.add({ content: '第二条', summary: '第二条' }),
    /无法生成唯一记忆 ID/,
  );
});

test('秘密信息拒绝进入长期记忆', async (t) => {
  const { store } = await newStore(t);
  assert.throws(() => assertNoSecrets('api_key = sk-1234567890abcdef'), SecretDetectedError);
  assert.throws(() => assertNoSecrets('密码是 123456'), SecretDetectedError);
  assert.throws(() => assertNoSecrets('Authorization: Bearer abcdefghijklmnop'), SecretDetectedError);
  assert.doesNotThrow(() => assertNoSecrets('令牌桶算法适合限流。'));

  await assert.rejects(
    store.add({ content: '主人说 api_key = sk-1234567890abcdef', summary: '密钥' }),
    SecretDetectedError,
  );
  const raw = await readFile(path.join(store.memoryDir, 'raw_memories.md'), 'utf8');
  assert.equal(raw.includes('sk-1234567890abcdef'), false);
  assert.equal((await store.listActive()).length, 0);
});

test('超过 200 条时归档最旧记录，不删除历史', async (t) => {
  const { store } = await newStore(t, { maxActiveMemories: 2 });
  await store.add({ content: '最旧', summary: '最旧' });
  await store.add({ content: '中间', summary: '中间' });
  await store.add({ content: '最新', summary: '最新' });
  const active = await store.listActive();
  const archived = await store.listArchived();
  assert.equal(active.length, 2);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].content, '最旧');
  assert.deepEqual(active.map((entry) => entry.id), ['mem-00000002', 'mem-00000003']);
  const archiveText = await readFile(path.join(store.memoryDir, 'archive', 'raw_memories.md'), 'utf8');
  assert.match(archiveText, /mem-00000001/);
  const journal = await readFile(path.join(store.memoryDir, 'journal.jsonl'), 'utf8');
  assert.match(journal, /"op":"archive"/);
});

test('活动原始文件超过字节上限时归档', async (t) => {
  const { store } = await newStore(t, { rawArchiveMaxBytes: 1200, maxActiveMemories: 200 });
  for (let i = 0; i < 6; i += 1) {
    await store.add({ content: `字节归档测试 ${i} `.repeat(20), summary: `字节归档 ${i}` });
  }
  const stats = await store.stats();
  assert.ok(stats.rawBytes <= 1200);
  assert.ok(stats.archivedCount > 0);
});

test('摘要版本最多保留 keepSummaryVersions 份', async (t) => {
  const { store } = await newStore(t, { keepSummaryVersions: 2 });
  await store.writeSummary('第一版摘要', { mode: 'auto' });
  await store.writeSummary('第二版摘要', { mode: 'auto' });
  await store.writeSummary('第三版摘要', { mode: 'auto' });
  await store.writeSummary('第四版摘要', { mode: 'manual' });
  assert.equal(await store.readSummary(), '第四版摘要');
  assert.equal((await store.listSummaryVersions()).length, 2);
  assert.equal((await store.stats()).summaryMode, 'manual');
});

test('写入相同摘要不重复归档', async (t) => {
  const { store } = await newStore(t);
  await store.writeSummary('稳定摘要', { mode: 'auto' });
  const again = await store.writeSummary('稳定摘要', { mode: 'auto' });
  assert.equal(again.changed, false);
  assert.equal((await store.listSummaryVersions()).length, 0);
});

test('重新打开后从磁盘恢复相同内容', async (t) => {
  const { store } = await newStore(t);
  await store.add({ content: '重启恢复测试', tags: '恢复', summary: '恢复测试' });
  await store.writeSummary('恢复后的摘要', { mode: 'manual' });
  const reopened = new MemoryStore({
    memoryDir: store.memoryDir,
    globalMemoryDir: store.globalMemoryDir,
    now: fixedNow(30),
  });
  await reopened.init();
  assert.equal((await reopened.listActive())[0].content, '重启恢复测试');
  assert.equal(await reopened.readSummary(), '恢复后的摘要');
  assert.equal((await reopened.stats()).summaryMode, 'manual');
});

test('损坏的原始条目会隔离并报告，而不是静默丢失', async (t) => {
  const { store } = await newStore(t);
  const file = path.join(store.memoryDir, 'raw_memories.md');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, '<!-- feiyu-raw v1 -->\n\n## mem-00000001\n- 标签: 坏数据\n', 'utf8');
  assert.deepEqual(await store.listActive(), []);
  const stats = await store.stats();
  assert.equal(stats.parseErrors, 1);
  assert.match(stats.parseErrorDetails[0].reason, /缺少创建时间/);
  await assert.rejects(() => store.add({ content: '不应覆盖坏文件', summary: '拒绝' }), (error) => error.code === 'MEMORY_CORRUPT');
});
