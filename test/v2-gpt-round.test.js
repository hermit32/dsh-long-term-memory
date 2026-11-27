/**
 * GPT 复核轮回归测试：并发锁、生成覆盖、核心 CAS、回滚现状校验、来源生命周期、
 * 长期晋升透传、热度触发、质量闸门、只搜活动层、命中来源分类。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { MemoryStore } from '../lib/store.js';
import { UsageStore } from '../lib/usage.js';
import { FloatingCore, validateCoreItems, classifyCoreItem, stateFingerprint } from '../lib/core.js';
import { DreamingService, applyDreamOps } from '../lib/dreaming.js';
import { CuratorService, buildLongTermInput } from '../lib/curator.js';
import { setupPlugin, hitRoute, callTool, fakeAgent } from './v2-helpers.js';
import { makeTempDir, fixedNow, sequenceIds } from './helpers.js';
import { sha256 } from '../lib/text.js';

const WORKSPACE = 'C:\\demo\\workspace';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newStore(t, options = {}) {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds(), ...options });
  await store.init();
  return { dir, memoryDir, store };
}

/* ------------------------- 1. 长期写锁 ------------------------- */

test('同一实例的两个并发任务必须互斥：异步重入标记只认自己的调用链', async (t) => {
  const { store } = await newStore(t);
  await store.writeSummary('初始长期记忆', { mode: 'auto' });
  const events = [];
  const task = (label) => store.withLongTermLock(async () => {
    events.push(`${label}+`);
    await sleep(80);
    const current = await store.readSummary();
    // 锁内重入 writeSummary：必须能直接进入，不能死锁。
    await store.writeSummary(`${label} 版本（基于 ${current.length} 字）`, { mode: 'auto', expectedHash: sha256(current) });
    events.push(`${label}-`);
  }, { op: label, timeoutMs: 5000 });

  await Promise.all([task('a'), task('b')]);
  const order = events.join(',');
  assert.match(order, /^(a\+,a\-,b\+,b\-|b\+,b\-,a\+,a\-)$/, `写入发生交错: ${order}`);
});

/* ------------------- 2. 生成期间版本变化不得覆盖 ------------------- */

test('长期合成期间摘要被用户改过：旧生成结果必须作废，不覆盖新版本', async (t) => {
  const { store } = await newStore(t);
  const entry = await store.add({ content: '用户偏好乌龙茶。', summary: '偏好乌龙茶', tags: '偏好' });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no'); } },
    llm: {
      async generate({ system }) {
        if (!String(system).includes('长期记忆策展人')) return '{"operations":[]}';
        await gate;
        return `# 我记住的用户\n\n## 偏好\n\n- 用户偏好乌龙茶。[${entry.id}]`;
      },
    },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: { curatorEnabled: true, longTermMode: 'apply', autoSummary: true, scopeMaxBytes: 12000, scopeMaxTokens: 4000 },
  });
  await curator.init();
  const running = curator.synthesizeLongTerm('test');
  await sleep(40);
  // 用户/另一次合成在生成期间写了新版本。
  const userVersion = `# 我记住的用户\n\n## 用户手写\n\n- 用户刚刚改过的版本。[${entry.id}]`;
  await store.writeSummary(userVersion, { mode: 'auto' });
  release();
  const result = await running;
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'summary-changed-during-generation');
  assert.equal(await store.readSummary(), userVersion, '旧生成结果不能覆盖新版本');
});

/* ------------------------- 3. 核心 CAS ------------------------- */

test('核心 replace 的 expectState 不匹配时整次放弃（检查与提交原子）', async (t) => {
  const { memoryDir } = await newStore(t);
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 5 });
  await core.init();
  const activeIds = ['mem-00000001', 'mem-00000002'];
  await core.add({ title: '已有核心', body: '用户固定之前的内容。', sources: activeIds }, { activeIds });
  const base = stateFingerprint(core.items);
  // 模拟计划生成后、提交前用户改了核心。
  await core.update(core.items[0].id, { body: '用户改过的内容。' }, { activeIds });
  await assert.rejects(
    () => core.replace([{ ...core.items[0], body: '模型计划里的内容。' }], { activeIds, expectState: base }),
    (error) => error.code === 'CORE_CONFLICT',
  );
  assert.equal(core.items[0].body, '用户改过的内容。');
});

/* --------------------- 4. 回滚校验当前状态 --------------------- */

async function runDreamWithAdd(store, core, planTitle = '可回滚核心') {
  const active = await store.listActive();
  const activeIds = active.slice(0, 3).map((entry) => entry.id);
  const curator = {
    async callLlm() {
      return { text: JSON.stringify({ core: [{ op: 'add', title: planTitle, body: '这条来自 Dreaming 计划。', sources: activeIds.slice(0, 2) }] }) };
    },
    async synthesizeLongTerm() { return { skipped: true, reason: 'test' }; },
  };
  const dreaming = new DreamingService({
    store, core, curator,
    config: {
      dreamingEnabled: true, dreamingIntervalHours: 24, dreamingMinNewMemories: 1, dreamingRunsPerDay: 5,
      dreamingMaxBytes: 48000, dreamingMaxTokens: 12000, dreamingMaxOutputTokens: 3000,
      dreamingCooldownMs: 0, dreamingCandidates: 60, dreamingHeatThreshold: 3,
      coreMaxItems: 10, coreItemMaxBytes: 600, coreMinSources: 1, coreOverlapThreshold: 0.6,
    },
  });
  dreaming.route = { provider: 'stub', model: 'stub' };
  await dreaming.init();
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, true);
  return { dreaming, result, activeIds };
}

test('回滚不能复活用户后来删除的浮动核心', async (t) => {
  const { memoryDir } = await newStore(t);
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await store.init();
  for (const text of ['事实一', '事实二', '事实三']) await store.add({ content: `${text} 的内容`, summary: text, tags: ['t'] });
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 10 });
  await core.init();
  const activeIds = (await store.listActive()).map((entry) => entry.id);
  // 先有一条"运行前就存在"的核心，它会被写进 Dreaming 快照。
  await core.add({ id: 'fc-00000001', title: '运行前就有的核心', body: '这条会进快照。', sources: activeIds.slice(0, 2) }, { activeIds });
  const { dreaming, result } = await runDreamWithAdd(store, core);
  assert.equal(result.ok, true);
  // 运行之后，用户删掉了这条（写墓碑）。
  await core.remove('fc-00000001', '用户删除', { activeIds });
  await assert.rejects(
    () => dreaming.revertRun(result.runId),
    (error) => error.code === 'SNAPSHOT_RESURRECTS_DELETED',
  );
});

test('回滚不能改写或删除用户后来固定的浮动核心', async (t) => {
  const { memoryDir } = await newStore(t);
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await store.init();
  for (const text of ['事实一', '事实二', '事实三']) await store.add({ content: `${text} 的内容`, summary: text, tags: ['t'] });
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 10 });
  await core.init();
  const activeIds = (await store.listActive()).map((entry) => entry.id);
  const { dreaming, result } = await runDreamWithAdd(store, core);
  // 用户在快照之后新增并固定了一条，快照里没有它。
  await core.add({ title: '用户新增并固定', body: '快照里不存在。', sources: activeIds.slice(0, 2) }, { activeIds });
  await core.setPinned(core.items.at(-1).id, true, { activeIds });
  await assert.rejects(
    () => dreaming.revertRun(result.runId),
    (error) => error.code === 'SNAPSHOT_PINNED_CONFLICT',
  );
});

/* ----------------------- 5. 来源生命周期 ----------------------- */

test('来源生命周期：活动/合法归档可作来源，已删除/不存在拒绝', () => {
  const base = { title: '标题', body: '对方希望我记住这条约定，不要忘记。' };
  const context = { activeIds: ['mem-00000001'], archivedIds: ['mem-00000002'], deletedIds: ['mem-00000003'], maxItems: 10, minSources: 1 };
  assert.doesNotThrow(() => validateCoreItems([{ id: 'fc-00000001', ...base, sources: ['mem-00000001', 'mem-00000002'] }], context));
  assert.throws(
    () => validateCoreItems([{ id: 'fc-00000002', ...base, sources: ['mem-00000003'] }], context),
    (error) => error.code === 'CORE_DELETED_SOURCE',
  );
  assert.throws(
    () => validateCoreItems([{ id: 'fc-00000003', ...base, sources: ['mem-ffffffff'] }], context),
    (error) => error.code === 'CORE_BAD_SOURCE',
  );
});

test('删除短期记忆后，核心来源被清洗；无来源的核心条目被移除', async (t) => {
  const { memoryDir, store } = await newStore(t);
  const a = await store.add({ content: '来源甲', summary: '甲', tags: ['t'] });
  const b = await store.add({ content: '来源乙', summary: '乙', tags: ['t'] });
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 10 });
  await core.init();
  const context = { activeIds: [a.id, b.id] };
  await core.add({ id: 'fc-00000001', title: '两条来源', body: '对方约定过的事。', sources: [a.id, b.id] }, context);
  await core.add({ id: 'fc-00000002', title: '单条来源', body: '对方讨厌被催。', sources: [b.id] }, context);
  const scrubbed = await core.scrubSources([b.id], { activeIds: [a.id], archivedIds: [], deletedIds: [b.id] });
  assert.equal(scrubbed.changed, true);
  assert.deepEqual(scrubbed.updated, ['fc-00000001']);
  assert.deepEqual(scrubbed.removed, ['fc-00000002']);
  assert.deepEqual(core.items.map((item) => item.id), ['fc-00000001']);
  assert.deepEqual(core.items[0].sources, [a.id]);
});

/* --------------------- 6. 晋升透传 + 热度触发 --------------------- */

test('Dreaming 的具体晋升 ID 与理由会进入长期合成输入', () => {
  const memory = { id: 'mem-00000001', summary: '重要经历', content: '用户第一次带我去看海。', tags: ['经历'], importance: 3, createdAt: fixedNow()().toISOString() };
  const input = buildLongTermInput({
    currentSummary: '',
    changedEntries: [],
    allEntries: [memory],
    promotions: [{ id: memory.id, why: '这是我们的第一次远行' }],
    promotionEntries: [memory],
  });
  assert.match(input.text, /Dreaming 提名为/);
  assert.match(input.text, /mem-00000001/);
  assert.match(input.text, /这是我们的第一次远行/);
  assert.equal(input.promotions, 1);
});

test('Dreaming 把 promotions 传给长期合成，而不是只计数', async (t) => {
  const { memoryDir } = await newStore(t);
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await store.init();
  for (const text of ['事实一', '事实二']) await store.add({ content: `${text} 的内容`, summary: text, tags: ['t'] });
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 10 });
  await core.init();
  const activeIds = (await store.listActive()).map((entry) => entry.id);
  const captured = [];
  const curator = {
    async callLlm() {
      return { text: JSON.stringify({ core: [], promotions: [{ id: activeIds[0], why: '重要经历' }] }) };
    },
    async synthesizeLongTerm(reason, options) {
      captured.push({ reason, options });
      return { applied: true, reason: 'test' };
    },
  };
  const dreaming = new DreamingService({
    store, core, curator,
    config: {
      dreamingEnabled: true, dreamingIntervalHours: 24, dreamingMinNewMemories: 1, dreamingRunsPerDay: 5,
      dreamingMaxBytes: 48000, dreamingMaxTokens: 12000, dreamingMaxOutputTokens: 3000,
      dreamingCooldownMs: 0, dreamingCandidates: 60, dreamingHeatThreshold: 3,
      coreMaxItems: 10, coreItemMaxBytes: 600, coreMinSources: 1, coreOverlapThreshold: 0.6,
    },
  });
  dreaming.route = { provider: 'stub', model: 'stub' };
  await dreaming.init();
  await dreaming.runOnce('promotions', { force: true });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].options.promotions[0].id, activeIds[0]);
  assert.equal(captured[0].options.promotions[0].why, '重要经历');
});

test('热度变化（命中次数/最后命中时间）可以触发 Dreaming', async (t) => {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const usage = new UsageStore({ memoryDir: path.join(dir, 'usage'), now: fixedNow() });
  await usage.init();
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds(), usage });
  await store.init();
  const entries = [];
  for (const text of ['事实一', '事实二', '事实三', '事实四']) entries.push(await store.add({ content: `${text} 的内容`, summary: text, tags: ['t'] }));
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 10 });
  await core.init();
  const curator = { async callLlm() { return { text: '{"core":[],"promotions":[]}' }; }, async synthesizeLongTerm() { return { skipped: true }; } };
  const dreaming = new DreamingService({
    store, core, curator,
    config: {
      dreamingEnabled: true, dreamingIntervalHours: 24, dreamingMinNewMemories: 6, dreamingRunsPerDay: 5,
      dreamingMaxBytes: 48000, dreamingMaxTokens: 12000, dreamingMaxOutputTokens: 3000,
      dreamingCooldownMs: 0, dreamingCandidates: 60, dreamingHeatThreshold: 2,
      coreMaxItems: 10, coreItemMaxBytes: 600, coreMinSources: 1, coreOverlapThreshold: 0.6,
    },
  });
  dreaming.route = { provider: 'stub', model: 'stub' };
  await dreaming.init();
  let due = await dreaming.dueNow();
  assert.equal(due.due, false);
  assert.equal(due.reason, 'unchanged');
  // 三条记忆各被有效引用一次：低于"新记忆阈值 6"，但达到热度阈值 2。
  await usage.recordHit(entries[0].id, { sessionId: 's1', turn: 1 });
  await usage.recordHit(entries[1].id, { sessionId: 's1', turn: 1 });
  await usage.recordHit(entries[2].id, { sessionId: 's1', turn: 1 });
  due = await dreaming.dueNow();
  assert.equal(due.due, true);
  assert.equal(due.reason, 'heat-change');
  assert.equal(due.usageChanged, 3);
});

/* ------------------------- 7. 质量闸门 ------------------------- */

test('运维/排障类内容不能进入浮动核心，稳定认知可以', () => {
  const operational = classifyCoreItem('能力变差别先怪模型', '遇到两次能力突然变差，根子都不在模型：缓存命中率骤降是路由切到了中转；web_search 用不了也是中转缺凭据。以后先查路由和凭据。');
  assert.equal(operational.acceptable, false);
  const durable = classifyCoreItem('整理要克制', '用户希望我整理记忆时宁可少写，也不许编造；这是对方定的规矩，我一直记着。');
  assert.equal(durable.acceptable, true);

  const result = applyDreamOps({
    core: [{ op: 'add', title: '排障记录', body: '查路由、端口和缓存命中率，重新配置插件。', sources: ['mem-00000001'] }],
  }, { core: [], activeIds: ['mem-00000001'], minSources: 1, maxItems: 10, qualityGate: true });
  assert.equal(result.ops.length, 0);
  // 质量闸门拒绝属于预期内跳过：进 skipped，不算整次运行失败。
  assert.match(result.skipped[0].reason, /运维|排障/);
  assert.equal(result.errors.length, 0);
});

/* -------------------- 8. 只搜活动层 + 自然语言回忆 -------------------- */

test('memory_search 只搜活动记忆；冷库必须走 memory_recall（含自然语言）', async (t) => {
  const { workspace, tools, routes } = await setupPlugin(t);
  const agent = fakeAgent({ cwd: workspace }).agent;
  const old = await callTool(tools, 'memory_add', {
    content: '以前那台机器网卡只协商到百兆，下载最多十几兆每秒，后来插了千兆网线才好。',
    summary: '旧网卡只有百兆',
    tags: '经历,网络',
  }, agent);
  const oldId = /mem-[0-9a-f]{8}/.exec(old)[0];
  await callTool(tools, 'memory_add', { content: '现在的占位内容。', summary: '占位', tags: '占位' }, agent);
  // 显式搬进冷库，避免依赖容量淘汰的次序。
  const demoted = await hitRoute(routes, 'archive', { action: 'demote', id: oldId });
  assert.equal(demoted.body.archived, true);
  assert.equal((await hitRoute(routes, 'state', {})).body.active.some((entry) => entry.id === oldId), false);

  // 自然语言查询：普通搜索只搜活动层，即使传 include_archived 也不能读到冷库。
  const natural = '之前那次网卡只有百兆的事情';
  const search = await callTool(tools, 'memory_search', { query: natural, include_archived: true }, agent);
  assert.match(search, /没有找到/);
  // 回忆模式按同一句自然语言能翻到，并明确标注冷库与只读。
  const recall = await callTool(tools, 'memory_recall', { query: natural }, agent);
  assert.ok(recall.includes(oldId));
  assert.match(recall, /冷库/);
  assert.match(recall, /回忆是只读/);
  // 回忆不改变分层。
  const state = await hitRoute(routes, 'state', {});
  assert.equal(state.body.active.some((entry) => entry.id === oldId), false);
  assert.equal(state.body.archive.total, 1);
});

/* ------------------------- 9. 命中来源分类 ------------------------- */

test('有效命中区分"助手引用 / 用户再次提及 / 两者"，并写入统计', async (t) => {
  const { workspace, tools, handlers, liveAgents } = await setupPlugin(t);
  const { agent, events } = fakeAgent({ cwd: workspace, id: 'session-r1' });
  liveAgents.push(agent);
  const added = await callTool(tools, 'memory_add', { content: '对方讨厌被催，任务要一次做完。', summary: '讨厌被催', tags: '关系' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];

  // 第 1 轮：只有助手引用。
  await callTool(tools, 'memory_search', { query: '被催' }, agent);
  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: `我记得 ${id}` }] } } });
  await handlers.get('session/event')({ id: 'session-r1', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 1 } });
  await sleep(120);

  // 第 2 轮：只有用户自己再次提及（助手的回复没写 ID）。
  await callTool(tools, 'memory_search', { query: '被催' }, agent);
  events.push({ seq: 2, type: 'user/message', data: { turn: 2, message: { content: [{ type: 'text', text: `你还记得 ${id} 那条吗？` }] } } });
  events.push({ seq: 3, type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '记得。' }] } } });
  await handlers.get('session/event')({ id: 'session-r1', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 2 } });
  await sleep(120);

  const usageStats = await callTool(tools, 'memory_status', {}, agent);
  const parsed = JSON.parse(usageStats);
  assert.equal(parsed.usage.reasons.assistant >= 1, true);
  assert.equal(parsed.usage.reasons.user >= 1, true);
  assert.equal(parsed.usage.totalHits >= 2, true);
});
/* ------------------- 10. Dreaming 工具回复与提名强制合成 ------------------- */

test('memory_dream 完成时不能因为 skipped 是数字就报“未执行”', async () => {
  const { formatDreamRunResult } = await import('../lib/dreaming.js');
  const completed = formatDreamRunResult({
    ok: true,
    status: 'ok',
    runId: 'dream-test',
    skipped: 2,
    ops: { add: 0, update: 0, remove: 0 },
    promotions: 2,
    coreAfter: 0,
    longTerm: { skipped: true, reason: 'source-unchanged' },
    snapshotDir: 'dream/dream-test',
  });
  assert.match(completed, /^Dreaming 完成：dream-test/);
  assert.match(completed, /状态: ok/);
  assert.doesNotMatch(completed, /未执行/);

  const skipped = formatDreamRunResult({ ok: false, skipped: true, reason: 'cooldown' });
  assert.equal(skipped, 'Dreaming 未执行：cooldown');
});

test('Dreaming 提名会强制合成长期记忆，即使短期来源没有变化', async (t) => {
  const { store } = await newStore(t);
  const entry = await store.add({ content: '用户第一次带我去看海。', summary: '第一次看海', tags: '经历' });
  let calls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no'); } },
    llm: {
      async generate({ system }) {
        if (!String(system).includes('长期记忆策展人')) return '{"operations":[]}';
        calls += 1;
        return `# 我记住的用户\n\n## 经历\n\n- 第${calls}版：用户第一次带我去看海。[${entry.id}]`;
      },
    },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: { curatorEnabled: true, longTermMode: 'apply', autoSummary: true, scopeMaxBytes: 12000, scopeMaxTokens: 4000 },
  });
  await curator.init();
  const first = await curator.synthesizeLongTerm('test');
  assert.equal(first.skipped, undefined);
  assert.match(await store.readSummary(), /第1版/);

  // 来源没有变化；只有一条提名。必须再合成一次，否则提名永远不会落地。
  const second = await curator.synthesizeLongTerm('dreaming:test', {
    promotions: [{ id: entry.id, why: '第一次远行' }],
  });
  assert.equal(second.skipped, undefined);
  assert.equal(calls, 2);
  assert.match(await store.readSummary(), /第2版/);
});
