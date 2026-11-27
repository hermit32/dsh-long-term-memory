import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageStore, dayKey } from '../lib/usage.js';
import { makeTempDir, fixedNow } from './helpers.js';

async function newUsage(t, overrides = {}) {
  const dir = await makeTempDir(t);
  const usage = new UsageStore({ memoryDir: dir, now: fixedNow(), ...overrides });
  await usage.init();
  return { usage, dir };
}

const A = 'mem-00000001';
const B = 'mem-00000002';

test('有效命中：同会话同轮只计一次，跨轮累加', async (t) => {
  const { usage } = await newUsage(t);
  const first = await usage.recordHit(A, { sessionId: 's1', turn: 1 });
  assert.equal(first.counted, true);
  assert.equal(first.hits, 1);
  const dup = await usage.recordHit(A, { sessionId: 's1', turn: 1 });
  assert.equal(dup.counted, false);
  assert.equal(dup.reason, 'duplicate');
  const next = await usage.recordHit(A, { sessionId: 's1', turn: 2 });
  assert.equal(next.counted, true);
  assert.equal(next.hits, 2);
  const other = await usage.recordHit(A, { sessionId: 's2', turn: 1 });
  assert.equal(other.counted, true);
  assert.equal(usage.get(A).hits, 3);
});

test('每日命中上限防止长会话自我强化', async (t) => {
  const { usage } = await newUsage(t, { dailyHitCap: 2 });
  assert.equal((await usage.recordHit(A, { sessionId: 's1', turn: 1 })).counted, true);
  assert.equal((await usage.recordHit(A, { sessionId: 's1', turn: 2 })).counted, true);
  const capped = await usage.recordHit(A, { sessionId: 's1', turn: 3 });
  assert.equal(capped.counted, false);
  assert.equal(capped.reason, 'daily-cap');
  assert.equal(usage.get(A).hits, 2);
});

test('实质性内容更新时间与最后活动时间', async (t) => {
  const { usage } = await newUsage(t);
  assert.equal(usage.lastActivityAt(A, { createdAt: '2026-11-05T15:10:00+08:00' }), '2026-11-05T07:10:00.000Z');
  await usage.recordContentUpdate(A, '2026-11-06T10:00:00+08:00');
  assert.equal(usage.get(A).contentUpdatedAt, '2026-11-06T02:00:00.000Z');
  assert.equal(usage.lastActivityAt(A, {}), '2026-11-06T02:00:00.000Z');
  await usage.recordHit(A, { sessionId: 's1', turn: 4, at: '2026-11-07T10:00:00+08:00' });
  assert.equal(usage.lastActivityAt(A, {}), '2026-11-07T02:00:00.000Z');
  const stats = usage.stats();
  assert.equal(stats.tracked, 1);
  assert.equal(stats.totalHits, 1);
  assert.ok(stats.lastHitAt.startsWith('2026-11-07'));
});

test('写入是 append-only WAL：重启后重放命中，不丢数据', async (t) => {
  const dir = await makeTempDir(t);
  const first = new UsageStore({ memoryDir: dir, now: fixedNow() });
  await first.init();
  await first.recordHit(A, { sessionId: 's1', turn: 1 });
  await first.recordHit(B, { sessionId: 's1', turn: 1 });
  await first.recordContentUpdate(A);
  const reopened = new UsageStore({ memoryDir: dir, now: fixedNow() });
  await reopened.init();
  assert.equal(reopened.get(A).hits, 1);
  assert.equal(reopened.get(B).hits, 1);
  assert.equal(reopened.get(A).contentUpdatedAt.length > 0, true);
  assert.equal(reopened.stats().recovered, true);
});

test('超过压缩阈值后折叠成快照，命中数保持不变', async (t) => {
  const dir = await makeTempDir(t);
  const usage = new UsageStore({ memoryDir: dir, now: fixedNow(), compactAfterLines: 200, dailyHitCap: 1000 });
  await usage.init();
  for (let turn = 1; turn <= 205; turn += 1) {
    await usage.recordHit(A, { sessionId: 's1', turn });
  }
  assert.ok(usage.compactions >= 1, '应该至少折叠过一次');
  assert.equal(usage.get(A).hits, 205);
  const snapshot = JSON.parse(await readFile(path.join(dir, 'usage.json'), 'utf8'));
  assert.ok(snapshot.entries[A].hits >= 200, '快照至少包含折叠时的命中数');
  assert.ok(snapshot.lastSeq >= 200);
  const reopened = new UsageStore({ memoryDir: dir, now: fixedNow(), compactAfterLines: 200, dailyHitCap: 1000 });
  await reopened.init();
  assert.equal(reopened.get(A).hits, 205);
});

test('归档/恢复状态被记录，且不影响命中数', async (t) => {
  const { usage } = await newUsage(t);
  await usage.recordHit(A, { sessionId: 's1', turn: 1 });
  await usage.noteArchive(A, '2026-11-08T10:00:00+08:00');
  assert.equal(usage.get(A).archivedAt, '2026-11-08T02:00:00.000Z');
  await usage.noteRestore(A);
  assert.equal(usage.get(A).archivedAt, '');
  assert.equal(usage.get(A).hits, 1);
});

test('非法 ID 与损坏快照不会让统计崩掉', async (t) => {
  const dir = await makeTempDir(t);
  const usage = new UsageStore({ memoryDir: dir, now: fixedNow() });
  await usage.init();
  const bad = await usage.recordHit('not-an-id', { sessionId: 's1', turn: 1 });
  assert.equal(bad.counted, false);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dir, 'usage.json'), '{not json', 'utf8');
  const reopened = new UsageStore({ memoryDir: dir, now: fixedNow() });
  await reopened.init();
  assert.equal(reopened.stats().tracked, 0);
});

test('dayKey 使用 +08:00 自然日', () => {
  assert.equal(dayKey(new Date('2026-11-05T17:00:00.000Z')), '2026-11-06');
  assert.equal(dayKey(new Date('2026-11-05T15:00:00.000Z')), '2026-11-05');
});
