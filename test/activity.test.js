import test from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, rankByActivity, selectArchiveCandidates, describeActivity } from '../lib/activity.js';

const NOW = new Date('2026-11-25T12:00:00+08:00');

function entry(id, createdAt, overrides = {}) {
  return { id, createdAt, updatedAt: createdAt, importance: 1, ...overrides };
}

test('活跃度主排序：最近被引用的压过很久没动的', () => {
  const fresh = entry('mem-00000001', '2026-11-25T11:00:00+08:00');
  const stale = entry('mem-00000002', '2026-10-01T11:00:00+08:00');
  const a = activityOf(fresh, { hits: 0 });
  const b = activityOf(stale, { hits: 0 }, { now: NOW });
  assert.ok(a.score > b.score);
});

test('引用频率与重要度只是辅助：不能压过明显更新的条目', () => {
  const recent = entry('mem-00000001', '2026-11-25T11:00:00+08:00');
  const oldButHot = entry('mem-00000002', '2026-09-01T11:00:00+08:00', { importance: 3 });
  const recentScore = activityOf(recent, { hits: 0 }, { now: NOW }).score;
  const oldScore = activityOf(oldButHot, { hits: 500 }, { now: NOW }).score;
  assert.ok(recentScore > oldScore, `${recentScore} 应大于 ${oldScore}`);
});

test('同一天内的细微差别由命中数打破', () => {
  const base = entry('mem-00000001', '2026-11-25T11:00:00+08:00');
  const other = entry('mem-00000002', '2026-11-25T11:00:00+08:00');
  const a = activityOf(base, { hits: 1 }, { now: NOW });
  const b = activityOf(other, { hits: 9 }, { now: NOW });
  assert.ok(b.score > a.score);
});

test('rankByActivity 稳定排序并附带 activity 字段', () => {
  const items = [
    entry('mem-00000001', '2026-11-24T11:00:00+08:00'),
    entry('mem-00000002', '2026-11-25T11:00:00+08:00'),
    entry('mem-00000003', '2026-11-20T11:00:00+08:00'),
  ];
  const ranked = rankByActivity(items, {}, { now: NOW, halfLifeDays: 30 });
  assert.deepEqual(ranked.map((item) => item.id), ['mem-00000002', 'mem-00000001', 'mem-00000003']);
  assert.equal(typeof ranked[0].activity.score, 'number');
  assert.match(describeActivity(ranked[0].activity), /活跃度/);
});

test('淘汰选择：保护窗口内的不搬，先搬最不活跃的', () => {
  const items = [
    entry('mem-00000001', '2026-10-01T11:00:00+08:00'),
    entry('mem-00000002', '2026-10-02T11:00:00+08:00'),
    entry('mem-00000003', '2026-11-25T11:30:00+08:00'),
  ];
  const picked = selectArchiveCandidates(items, { 'mem-00000002': { lastHitAt: '2026-11-25T11:50:00.000Z' } }, {
    now: NOW,
    graceHours: 24,
    count: 1,
  });
  assert.deepEqual(picked.map((item) => item.id), ['mem-00000001']);
});

test('严重超容时保护窗口让位，但永远保留最新一条', () => {
  const items = [
    entry('mem-00000001', '2026-11-25T11:10:00+08:00'),
    entry('mem-00000002', '2026-11-25T11:20:00+08:00'),
    entry('mem-00000003', '2026-11-25T11:30:00+08:00'),
  ];
  const picked = selectArchiveCandidates(items, {}, { now: NOW, graceHours: 24, count: 2 });
  assert.equal(picked.length, 2);
  assert.equal(picked.some((item) => item.id === 'mem-00000003'), false, '最新一条必须保住');
});

test('重要度 3 的条目在容量允许时最后才被搬走', () => {
  const items = [
    entry('mem-00000001', '2026-10-01T11:00:00+08:00', { importance: 3 }),
    entry('mem-00000002', '2026-10-02T11:00:00+08:00'),
  ];
  const picked = selectArchiveCandidates(items, {}, { now: NOW, graceHours: 24, count: 1 });
  assert.deepEqual(picked.map((item) => item.id), ['mem-00000002']);
});
