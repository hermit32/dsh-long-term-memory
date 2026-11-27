import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { UsageStore } from '../lib/usage.js';
import { makeTempDir, fixedNow, sequenceIds } from './helpers.js';
import { setupPlugin, hitRoute, callTool, fakeAgent } from './v2-helpers.js';
import { sha256 } from '../lib/text.js';

async function twoStores(t) {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const a = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await a.init();
  const b = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await b.init();
  return { a, b, memoryDir, dir };
}

test('长期写锁：两个实例的读-改-写不交错，CAS 冲突不被静默覆盖', async (t) => {
  const { a, b } = await twoStores(t);
  const events = [];
  const work = async (store, label, text, holdMs) => store.withLongTermLock(async () => {
    events.push(`${label}:enter:${Date.now()}`);
    await store.readSummary();
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    const result = await store.writeSummary(text, { mode: 'auto', reason: label });
    events.push(`${label}:leave:${Date.now()}`);
    return result;
  }, { op: label, timeoutMs: 10000 });

  const [first, second] = await Promise.all([
    work(a, 'curator', '## 长期记忆 A\n\n- 来自 Curator 的内容', 250),
    work(b, 'dreaming', '## 长期记忆 B\n\n- 来自 Dreaming 的内容', 250),
  ]);
  assert.equal(first.changed, true);
  assert.equal(second.changed, true);

  // 两次写必须串行：后进入者的 enter 在先进者 leave 之后。
  const order = events.map((item) => item.split(':'));
  const firstEnter = Number(order.find((item) => item[0] === 'curator' && item[1] === 'enter')[2]);
  const firstLeave = Number(order.find((item) => item[0] === 'curator' && item[1] === 'leave')[2]);
  const secondEnter = Number(order.find((item) => item[0] === 'dreaming' && item[1] === 'enter')[2]);
  const secondLeave = Number(order.find((item) => item[0] === 'dreaming' && item[1] === 'leave')[2]);
  const serialized = (secondEnter >= firstLeave) || (firstEnter >= secondLeave);
  assert.equal(serialized, true, `写入发生交错: ${events.join(' | ')}`);

  const text = await a.readSummary();
  assert.ok(text.includes('长期记忆 A') || text.includes('长期记忆 B'));
  // 后写入的那次会把前一版归档进 summary_history，至少 1 个历史版本。
  const versions = await a.listSummaryVersions();
  assert.ok(versions.length >= 1);
  const locked = await a.withLongTermLock(async () => 'inner');
  assert.equal(locked, 'inner');
});

test('命中统计默认 observe：不把命中带进归档决策；enforce 才带', async (t) => {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const old = '2026-10-01T10:00:00+08:00';
  const build = async (mode) => {
    const usageDir = path.join(dir, `u-${mode}`);
    const usage = new UsageStore({ memoryDir: usageDir, now: fixedNow() });
    await usage.init();
    const store = new MemoryStore({
      memoryDir: path.join(dir, `m-${mode}`),
      now: fixedNow(),
      idFactory: sequenceIds(),
      usage,
      hitStatsMode: mode,
      maxActiveMemories: 2,
      activityGraceHours: 1,
    });
    await store.init();
    const a = await store.add({ content: '甲的内容', summary: '甲', createdAt: old });
    const b = await store.add({ content: '乙的内容', summary: '乙', createdAt: old });
    await usage.recordHit(a.id, { sessionId: 's1', turn: 1 });
    await usage.recordHit(a.id, { sessionId: 's1', turn: 2 });
    await usage.recordHit(a.id, { sessionId: 's1', turn: 3 });
    // 第三条触发容量淘汰。
    await store.add({ content: '丙的内容', summary: '丙', createdAt: old });
    const archived = await store.listArchived();
    return { archived: archived.map((entry) => entry.id), a, b };
  };
  const observe = await build('observe');
  const enforce = await build('enforce');
  assert.equal(observe.archived.length, 1);
  assert.equal(enforce.archived.length, 1);
  // observe 忽略命中：按同一时间戳/ID 兜底，淘汰更早的 ID；
  // enforce 会把「被频繁引用」的甲抬高，于是淘汰乙。
  assert.equal(observe.archived[0], observe.a.id);
  assert.equal(enforce.archived[0], enforce.b.id);
});

test('恢复资格：只允许软删除或冷库里的条目', async (t) => {
  const { a } = await twoStores(t);
  const first = await a.add({ content: '会被软删除', summary: '软删除', createdAt: '2026-10-01T10:00:00+08:00' });
  const second = await a.add({ content: '会进冷库', summary: '冷库', createdAt: '2026-10-02T10:00:00+08:00' });
  const active = await a.restorable(second.id);
  assert.equal(active.allowed, false);
  assert.equal(active.reason, 'already-active');

  await a.forget(first.id, 'test');
  const deleted = await a.restorable(first.id);
  assert.equal(deleted.allowed, true);
  assert.equal(deleted.layer, 'raw');

  const missing = await a.restorable('mem-ffffffff');
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, 'missing');
  await assert.rejects(() => a.restore('mem-ffffffff'), /不能恢复/);

  await a.archiveActive(second.id, 'test-archive');
  const archived = await a.restorable(second.id);
  assert.equal(archived.allowed, true);
  assert.equal(archived.layer, 'archive');
});

test('搜索/回忆都读不到已删除内容；冷库搜索默认也排除删除条目', async (t) => {
  const { a } = await twoStores(t);
  const target = await a.add({ content: '删除后不应被检索到的独特词 鲸落', summary: '鲸落', tags: ['秘密'], createdAt: '2026-10-01T10:00:00+08:00' });
  await a.add({ content: '普通内容', summary: '普通', createdAt: '2026-10-02T10:00:00+08:00' });
  await a.forget(target.id, 'test');

  assert.equal((await a.search('鲸落')).length, 0);
  assert.equal((await a.search('鲸落', { includeArchived: true })).length, 0);
  assert.equal((await a.search('', { tags: '秘密' })).length, 0);
  assert.equal((await a.search(target.id)).length, 0);
  assert.equal((await a.searchArchive('鲸落')).length, 0);
  assert.equal((await a.recall('鲸落', { scope: 'all' })).length, 0);

  // 冷库里的删除条目同样不可被检索。
  const archived = await a.add({ content: '冷库后删除的独特词 深渊', summary: '深渊', createdAt: '2026-10-03T10:00:00+08:00' });
  await a.archiveActive(archived.id, 'test');
  await a.forget(archived.id, 'test');
  assert.equal((await a.searchArchive('深渊')).length, 0);
  assert.equal((await a.recall('深渊', { scope: 'archive' })).length, 0);
});

test('重复写同一片长期记忆时 CAS 冲突可见，不覆盖已有内容', async (t) => {
  const { a, b } = await twoStores(t);
  await a.writeSummary('第一版长期记忆', { mode: 'auto' });
  const staleHash = sha256(await b.readSummary());
  await a.writeSummary('第二版长期记忆（用户编辑）', { mode: 'auto' });
  await assert.rejects(
    () => b.writeSummary('基于旧版本的草稿', { expectedHash: staleHash, mode: 'auto' }),
    /已被其他写入更新/,
  );
  assert.equal(await a.readSummary(), '第二版长期记忆（用户编辑）');
});

/* --------------------------- 插件层：溯源与接口 --------------------------- */

test('溯源工具读不到已删除条目；状态接口不返回删除正文；冷库接口不恢复活动条目', async (t) => {
  const { workspace, tools, routes } = await setupPlugin(t);
  const agent = fakeAgent({ cwd: workspace }).agent;
  const added = await callTool(tools, 'memory_add', { content: '这条稍后会被删除，正文含独特词 碳酸锂。', summary: '待删除', tags: '测试' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  const keep = await callTool(tools, 'memory_add', { content: '保留的内容', summary: '保留', tags: '测试' }, agent);
  const keepId = /mem-[0-9a-f]{8}/.exec(keep)[0];

  const traceBefore = await callTool(tools, 'memory_trace', { id }, agent);
  assert.ok(traceBefore.includes(id));

  await callTool(tools, 'memory_forget', { id, reason: '测试删除' }, agent);

  const traceAfter = await callTool(tools, 'memory_trace', { id }, agent);
  assert.match(traceAfter, /已被删除/);
  assert.equal(traceAfter.includes('碳酸锂'), false, '删除后溯源不能带出正文');
  assert.equal(traceAfter.includes('指纹校验'), false, '删除后不再返回溯源校验细节');

  const state = await hitRoute(routes, 'state', {});
  const deleted = state.body.deleted.find((entry) => entry.id === id);
  assert.ok(deleted, '设置页仍能看到被删除条目的概述');
  assert.equal(deleted.content, '', '状态接口不返回删除条目的正文');
  assert.equal(deleted.contentHidden, true);

  const search = await callTool(tools, 'memory_search', { query: '碳酸锂' }, agent);
  assert.match(search, /没有找到/);

  // 冷库接口只能恢复冷库条目：活动条目应被拒绝。
  const deny = await hitRoute(routes, 'archive', { action: 'restore', id: keepId });
  assert.equal(deny.status, 400);
  assert.match(deny.body.error, /恢复/);

  // 活动区软删除仍可通过 /restore 恢复。
  const restored = await hitRoute(routes, 'restore', { id });
  assert.equal(restored.body.changed, true);
  const traceRestored = await callTool(tools, 'memory_trace', { id }, agent);
  assert.ok(traceRestored.includes(id));
});

test('命中统计的观察模式在接口层可见，且不驱动归档', async (t) => {
  const { routes } = await setupPlugin(t);
  const state = await hitRoute(routes, 'state', {});
  assert.equal(state.body.activity.mode, 'observe');
  assert.equal(state.body.activity.drivesArchiving, false);
});
