import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FloatingCore,
  parseCore,
  renderCore,
  validateCoreItems,
  bigramOverlap,
  overlapsLongTerm,
  selectCoreForInjection,
  coreFingerprint,
} from '../lib/core.js';
import { makeTempDir, fixedNow } from './helpers.js';

function item(id, overrides = {}) {
  return {
    id,
    title: overrides.title ?? `核心 ${id}`,
    body: overrides.body ?? `这是 ${id} 的综合结论，来自两条短期记忆。`,
    sources: overrides.sources ?? ['mem-00000001', 'mem-00000002'],
    createdAt: overrides.createdAt ?? '2026-11-20T10:00:00+08:00',
    updatedAt: overrides.updatedAt ?? '2026-11-20T10:00:00+08:00',
    pinned: overrides.pinned === true,
  };
}

const ACTIVE = ['mem-00000001', 'mem-00000002', 'mem-00000003'];

test('渲染与解析往返：标题、正文、来源、固定状态都保留', () => {
  const text = renderCore([item('fc-00000001', { pinned: true })]);
  const parsed = parseCore(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, 'fc-00000001');
  assert.equal(parsed.items[0].title, '核心 fc-00000001');
  assert.deepEqual(parsed.items[0].sources, ['mem-00000001', 'mem-00000002']);
  assert.equal(parsed.items[0].pinned, true);
});

test('坏块被隔离，不影响其它条目', () => {
  const good = renderCore([item('fc-00000001')]);
  const broken = good.replace('<!-- feiyu-core:end -->', '');
  const parsed = parseCore(broken);
  assert.equal(parsed.items.length, 0);
  assert.ok(parsed.errors.length > 0);
});

test('校验：上限、重复、来源、秘密与墓碑', () => {
  const items = Array.from({ length: 11 }, (_, index) => item(`fc-000000${String(index + 1).padStart(2, '0')}`, {
    body: `第 ${index} 条不同的结论内容，避免重复检测。`,
  }));
  assert.throws(() => validateCoreItems(items, { maxItems: 10 }), /最多 10 条/);
  assert.throws(() => validateCoreItems([item('fc-00000001'), { ...item('fc-00000002'), title: item('fc-00000001').title, body: item('fc-00000001').body }], { maxItems: 10, activeIds: ACTIVE }), /内容重复/);
  assert.throws(() => validateCoreItems([item('fc-00000001', { sources: ['mem-ffffffff'] })], { activeIds: ACTIVE }), /不存在的短期记忆/);
  assert.throws(() => validateCoreItems([item('fc-00000001', { body: '密码是 hunter2hunter2' })], { activeIds: ACTIVE }), /密码|令牌|密钥|秘密/);
  const tombstone = { hash: coreFingerprint(item('fc-00000009').title, item('fc-00000009').body) };
  assert.throws(() => validateCoreItems([item('fc-00000009')], { activeIds: ACTIVE, tombstones: [tombstone] }), /删除过/);
});

test('与长期记忆重复的条目被拒绝', () => {
  const longTerm = '## 对方是谁\n\n对方喜欢在深夜整理笔记，默认离线模式，不喜欢被催。\n\n## 我们怎么相处\n\n提前问清楚再动手。';
  const bad = item('fc-00000001', { title: '整理笔记', body: '对方喜欢在深夜整理笔记，默认离线模式，不喜欢被催。' });
  assert.throws(() => validateCoreItems([bad], { activeIds: ACTIVE, longTermText: longTerm }), /与长期记忆重复/);
  const ok = item('fc-00000002', { title: '音乐口味', body: '对方最近常听城市流行和爵士，讨厌吵闹的电音。' });
  assert.doesNotThrow(() => validateCoreItems([ok], { activeIds: ACTIVE, longTermText: longTerm }));
  assert.ok(overlapsLongTerm(bad.title, bad.body, longTerm).score >= 0.6);
  assert.ok(bigramOverlap('完全不同的内容', longTerm) < 0.2);
});

test('注入选择：跳过与长期记忆重复的，按预算整条裁剪', () => {
  const longTerm = '对方喜欢在深夜整理笔记，默认离线模式。';
  const items = [
    item('fc-00000001', { body: '对方喜欢在深夜整理笔记，默认离线模式。' }),
    item('fc-00000002', { body: '对方讨厌被催，任务要一次做完。' }),
  ];
  const picked = selectCoreForInjection(items, { maxBytes: 400, longTermText: longTerm });
  assert.deepEqual(picked.items, ['fc-00000002']);
  assert.equal(picked.skipped[0].reason, 'overlaps-long-term');
  const tiny = selectCoreForInjection(items, { maxBytes: 20, longTermText: '' });
  assert.equal(tiny.items.length, 0);
  assert.ok(tiny.skipped.some((entry) => entry.reason === 'budget'));
});

test('浮动核心存储：新增、修改、固定不可被自动流程删除、删除写墓碑', async (t) => {
  const dir = await makeTempDir(t);
  const core = new FloatingCore({ memoryDir: dir, now: fixedNow(), maxItems: 3 });
  await core.init();
  const activeIds = ['mem-00000001', 'mem-00000002'];

  const added = await core.add({ title: '当前重点', body: '对方最近在重建记忆系统。', sources: activeIds }, { activeIds });
  assert.equal(added.changed, true);
  assert.equal(core.items.length, 1);
  const id = core.items[0].id;

  await core.setPinned(id, true, { activeIds });
  assert.equal(core.get(id).pinned, true);

  // 自动流程用 replace 尝试清空：固定条目必须保留。
  const replaced = await core.replace([], { activeIds });
  assert.equal(replaced.changed, false);
  assert.equal(core.items.length, 1);

  await core.update(id, { body: '对方最近在重建记忆系统，v2 已进入测试。' }, { activeIds });
  assert.match(core.get(id).body, /v2/);

  const history = await core.history(id);
  assert.ok(history.length >= 2);
  const removed = await core.remove(id, 'test-delete', { activeIds });
  assert.equal(removed.changed, true);
  assert.equal(core.items.length, 0);
  assert.equal((await core.history(id)).length >= 3, true);
  // 墓碑阻止同样内容被重新写入。
  assert.throws(() => core.validate([{
    id: 'fc-0000000a', title: '当前重点', body: '对方最近在重建记忆系统，v2 已进入测试。', sources: activeIds,
  }], { activeIds }), /删除过/);
});

test('历史回退能恢复被修改前的正文', async (t) => {
  const dir = await makeTempDir(t);
  const core = new FloatingCore({ memoryDir: dir, now: fixedNow(), maxItems: 3 });
  await core.init();
  const activeIds = ['mem-00000001', 'mem-00000002'];
  await core.add({ title: '标题', body: '第一版正文', sources: activeIds }, { activeIds });
  const id = core.items[0].id;
  await core.update(id, { body: '第二版正文' }, { activeIds });
  const history = await core.history(id);
  const firstUpdate = history.find((record) => record.op === 'update');
  assert.ok(firstUpdate);
  await core.restoreFromHistory(id, firstUpdate.seq, { activeIds });
  assert.equal(core.get(id).body, '第一版正文');
});

test('显式修改 pinned 是用户操作，不被固定保护挡住', async (t) => {
  const dir = await makeTempDir(t);
  const core = new FloatingCore({ memoryDir: dir, now: fixedNow(), maxItems: 3 });
  await core.init();
  const activeIds = ['mem-00000001', 'mem-00000002'];
  await core.add({ title: '固定测试', body: '这条会被固定再取消固定。', sources: activeIds }, { activeIds });
  const id = core.items[0].id;

  const pinned = await core.update(id, { pinned: true }, { activeIds });
  assert.equal(pinned.changed, true);
  assert.equal(core.get(id).pinned, true);

  // 自动流程（不显式传 pinned）不能解锁。
  await core.replace([{ ...core.get(id), pinned: false }], { activeIds });
  assert.equal(core.get(id).pinned, true);

  const unpinned = await core.update(id, { pinned: false }, { activeIds });
  assert.equal(unpinned.changed, true);
  assert.equal(core.get(id).pinned, false);
});
