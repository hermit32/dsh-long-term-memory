import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { FloatingCore } from '../lib/core.js';
import {
  DreamingService,
  buildDreamInput,
  applyDreamOps,
  extractDreamJson,
  memorySnapshot,
} from '../lib/dreaming.js';
import { makeTempDir, fixedNow, sequenceIds } from './helpers.js';

const WORKSPACE = 'C:\\demo\\workspace';

async function setup(t, plan = null, options = {}) {
  const dir = await makeTempDir(t);
  const memoryDir = path.join(dir, 'memories');
  const store = new MemoryStore({ memoryDir, now: fixedNow(), idFactory: sequenceIds() });
  await store.init();
  const core = new FloatingCore({ memoryDir, now: fixedNow(), maxItems: 10 });
  await core.init();
  const seeds = [];
  for (const [index, text] of (options.seeds ?? [
    ['用户喜欢在深夜整理笔记，默认离线模式。', '偏好'],
    ['用户讨厌被催，任务要一次做完。', '相处方式'],
    ['用户要求出图时保持演示角色人设一致。', '出图'],
    ['用户明确说过不给开单建议。', '边界'],
  ]).entries()) {
    const entry = await store.add({ content: String(text[0] ?? text), summary: String(text[1] ?? `记忆 ${index}`), tags: ['测试'], importance: 2 });
    seeds.push(entry);
  }
  const calls = [];
  const curator = {
    async callLlm(system, text, maxTokens, purpose) {
      calls.push({ system, text, maxTokens, purpose });
      if (options.llmDelayMs) await new Promise((resolve) => setTimeout(resolve, options.llmDelayMs));
      if (options.llmError) throw new Error(options.llmError);
      return { text: typeof plan === 'function' ? plan(calls.length) : JSON.stringify(plan) };
    },
    async synthesizeLongTerm(reason) {
      calls.push({ reason, longTerm: true });
      return { skipped: true, reason: 'test-long-term' };
    },
  };
  const config = {
    dreamingEnabled: true,
    dreamingIntervalHours: 24,
    dreamingMinNewMemories: 6,
    dreamingRunsPerDay: 5,
    dreamingMaxBytes: 48000,
    dreamingMaxTokens: 12000,
    dreamingMaxOutputTokens: 3000,
    dreamingCooldownMs: 0,
    dreamingCandidates: 60,
    coreMaxItems: 10,
    coreItemMaxBytes: 600,
    coreMinSources: 2,
    coreOverlapThreshold: 0.6,
    longTermMode: 'apply',
  };
  const dreaming = new DreamingService({ store, core, curator, config, now: fixedNow() });
  dreaming.route = { provider: 'test', model: 'test-model' };
  await dreaming.init();
  return { dir, memoryDir, store, core, dreaming, curator, config, seeds, calls };
}

test('Dreaming 输出解析：容忍代码块与解释', () => {
  const parsed = extractDreamJson('这里是计划：\n```json\n{"core":[],"promotions":[]}\n```\n完毕');
  assert.deepEqual(parsed.core, []);
  assert.throws(() => extractDreamJson('没有 JSON'), /没有 JSON 对象/);
});

test('applyDreamOps：新增/更新/删除，来源与固定条目的保护', () => {
  const core = [
    { id: 'fc-00000001', title: '固定条目', body: '用户固定的核心', sources: ['mem-00000001'], pinned: true, createdAt: '', updatedAt: '' },
  ];
  const parsed = {
    core: [
      { op: 'remove', id: 'fc-00000001', reason: '想删掉固定的' },
      { op: 'add', title: '新的重点', body: '对方最近在重建记忆系统。', sources: ['mem-00000001', 'mem-00000002'], reason: '高频' },
      { op: 'update', id: 'fc-00000001', title: '固定条目', body: '改写固定条目', sources: ['mem-00000001'] },
    ],
    promotions: [{ id: 'mem-00000001', why: '重要经历' }],
  };
  const result = applyDreamOps(parsed, {
    core,
    activeIds: ['mem-00000001', 'mem-00000002'],
    minSources: 2,
    maxItems: 10,
    itemMaxBytes: 600,
  });
  assert.equal(result.ops.length, 1);
  assert.equal(result.ops[0].op, 'add');
  assert.equal(result.errors.length, 2);
  assert.equal(result.promotions.length, 1);
  assert.equal(result.next.length, 2);
  assert.equal(result.next.find((item) => item.id === 'fc-00000001').body, '用户固定的核心');
});

test('applyDreamOps：来源不在活动集合、整份集合超限时给出明确错误', () => {
  const result = applyDreamOps({
    core: [{ op: 'add', title: '坏来源', body: '正文', sources: ['mem-ffffffff'] }],
  }, { core: [], activeIds: ['mem-00000001'], maxItems: 10 });
  assert.equal(result.ops.length, 0);
  assert.match(result.errors[0].reason, /不是活动或合法归档/);

  const tooMany = applyDreamOps({
    core: Array.from({ length: 11 }, (_, index) => ({
      op: 'add', title: `标题${index}`, body: `互不相同的综合结论 ${index}`, sources: ['mem-00000001', 'mem-00000002'],
    })),
  }, { core: [], activeIds: ['mem-00000001', 'mem-00000002'], maxItems: 10 });
  assert.ok(tooMany.validationError);
  assert.match(tooMany.validationError.message, /最多 10 条/);
});

test('buildDreamInput：包含长期记忆、核心、候选与遗忘清单，且受预算约束', () => {
  const input = buildDreamInput({
    core: [{ id: 'fc-00000001', title: '重点', body: '正文', sources: ['mem-00000001'], updatedAt: '' }],
    entries: [
      { id: 'mem-00000001', summary: '偏好', content: '对方喜欢深夜整理笔记', tags: ['偏好'], createdAt: '2026-11-01T00:00:00+08:00' },
      { id: 'mem-00000002', summary: '相处方式', content: '对方讨厌被催', tags: ['关系'], createdAt: '2026-11-02T00:00:00+08:00' },
    ],
    longTermText: '## 对方是谁\n\n用户是一个会自己动手的人。',
    forgotten: [{ text: '不要记住的旧事' }],
    deleted: [{ id: 'mem-00000003' }],
    usage: { 'mem-00000002': { hits: 7, lastHitAt: '2026-11-20T10:00:00.000Z' } },
    maxBytes: 12000,
    maxTokens: 4000,
    candidates: 10,
    maxItems: 10,
  });
  assert.ok(input.text.includes('浮動核心') || input.text.includes('浮动核心'));
  assert.ok(input.text.includes('不得与其重复'));
  assert.ok(input.text.includes('mem-00000002'));
  assert.ok(input.text.includes('禁止重写'));
  assert.ok(input.bytes <= 12000);
  assert.ok(input.candidates <= 2);
});

test('Dreaming 运行：生成浮动核心、写快照、记录运行，可回滚', async (t) => {
  const { memoryDir, core, dreaming, calls } = await setup(t, {
    core: [
      { op: 'add', title: '当前重点', body: '对方正在重建记忆系统，要求先备份再改生产。', sources: ['mem-00000001', 'mem-00000002'], reason: '高频出现' },
    ],
    promotions: [],
  });
  const before = await dreaming.dueNow({ force: true });
  assert.equal(before.due, true);

  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(core.items.length, 1);
  assert.equal(calls.length >= 1, true);
  assert.equal(result.ops.add, 1);

  const runsDir = path.join(memoryDir, 'dream');
  const runs = await readdir(runsDir);
  assert.equal(runs.length, 1);
  const manifest = JSON.parse(await readFile(path.join(runsDir, runs[0], 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 3);
  assert.ok(await stat(path.join(runsDir, runs[0], 'floating_core.md')));

  const state = JSON.parse(await readFile(path.join(memoryDir, 'dreaming.json'), 'utf8'));
  assert.equal(state.lastRun.status, 'ok');
  assert.equal(state.recentRuns.length, 1);
  assert.equal(state.counters.added, 1);

  // 回滚：浮动核心回到快照状态（空）。
  const reverted = await dreaming.revertRun(result.runId);
  assert.equal(reverted.reverted, true);
  assert.equal(core.items.length, 0);
});

test('Dreaming 拒绝重复长期记忆的计划，不落盘', async (t) => {
  const { core, store, dreaming } = await setup(t, {
    core: [{ op: 'add', title: '长期记忆副本', body: '对方喜欢在深夜整理笔记，默认离线模式。', sources: ['mem-00000001', 'mem-00000002'] }],
  });
  await store.writeSummary('# 我记住的用户\n\n## 对方是谁\n\n对方喜欢在深夜整理笔记，默认离线模式。', { mode: 'auto' });
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'rejected');
  assert.equal(core.items.length, 0);
  assert.match(result.errors.join(' '), /与长期记忆重复/);
});

test('Dreaming 无改动时不写盘也不产出快照', async (t) => {
  const { memoryDir, core, dreaming } = await setup(t, { core: [], promotions: [] });
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'noop');
  assert.equal(core.items.length, 0);
  const runs = await readdir(path.join(memoryDir, 'dream')).catch(() => []);
  assert.equal(runs.length, 0);
});

test('Dreaming 频率判断：无变化不跑，新记忆够数才跑', async (t) => {
  const { store, dreaming } = await setup(t, { core: [] });
  // 第一次：基线在 init 时建立，现有 4 条不算“新变化” → 未到期。
  let due = await dreaming.dueNow();
  assert.equal(due.due, false);
  assert.equal(due.reason, 'unchanged');

  // 写入 6 条新记忆后到期。
  for (let index = 0; index < 6; index += 1) {
    await store.add({ content: `新增测试记忆 ${index} 的内容`, summary: `新增 ${index}`, tags: ['测试'] });
  }
  due = await dreaming.dueNow();
  assert.equal(due.due, true);
  assert.equal(due.reason, 'new-memories');
  assert.ok(due.changed >= 6);
});

test('从未运行过时不会被 interval 分支直接触发', async (t) => {
  const { store, dreaming } = await setup(t, { core: [] });
  // 只改一条（低于阈值），且从未运行 → 不应因为“间隔”触发。
  const entry = await store.add({ content: '低频变化的一条记忆', summary: '低频变化', tags: ['测试'] });
  await store.update(entry.id, { content: '低频变化的一条记忆（已更新）' }, 'test');
  const due = await dreaming.dueNow();
  assert.equal(due.due, false);
  assert.equal(due.reason, 'below-threshold');
});

test('Dreaming 关闭时既不判断也不运行', async (t) => {
  const { dreaming } = await setup(t, { core: [] });
  dreaming.config.dreamingEnabled = false;
  const due = await dreaming.dueNow();
  assert.equal(due.due, false);
  assert.equal(due.reason, 'disabled');
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, false);
});

test('memorySnapshot 对活跃与删除条目都敏感', () => {
  const active = [{ id: 'mem-00000001', content: 'a', updatedAt: 't1' }, { id: 'mem-00000002', content: 'b', updatedAt: 't1' }];
  const deleted = [{ id: 'mem-00000003', content: 'c', deletedAt: 't2' }];
  const one = memorySnapshot(active, deleted);
  const two = memorySnapshot(active, []);
  assert.notEqual(one.hash, two.hash);
  assert.equal(one.hashes['mem-00000001'].startsWith('active|'), true);
  assert.equal(one.hashes['mem-00000003'].startsWith('deleted|'), true);
});

test('Dreaming 保存前核对核心：模型调用期间被编辑/固定/删除时整次放弃', async (t) => {
  const plan = {
    core: [{ op: 'add', title: '模型想加的核心', body: '这条不该在冲突时落盘。', sources: ['mem-00000001', 'mem-00000002'] }],
  };
  const { core, dreaming, memoryDir } = await setup(t, plan, { llmDelayMs: 250 });
  const running = dreaming.runOnce('test', { force: true });
  await new Promise((resolve) => setTimeout(resolve, 80));
  // 模拟用户在模型调用期间编辑核心。
  await core.add({ title: '用户手写的核心', body: '用户在 Dreaming 期间新增。', sources: ['mem-00000001', 'mem-00000002'] }, { activeIds: ['mem-00000001', 'mem-00000002', 'mem-00000003', 'mem-00000004'] });
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.status, 'conflict');
  assert.match(result.errors.join(' '), /浮动核心在 Dreaming 期间被修改/);
  assert.equal(core.items.length, 1);
  assert.equal(core.items[0].title, '用户手写的核心');
  assert.equal(core.items.some((item) => item.title === '模型想加的核心'), false);
  const journal = await readFile(path.join(memoryDir, 'journal.jsonl'), 'utf8');
  assert.match(journal, /dreaming-conflict/);
});

test('Dreaming 保存前核对固定状态：用户取消固定也算改动', async (t) => {
  const plan = {
    core: [{ op: 'update', id: 'fc-00000001', title: '固定条目', body: '模型想改写它。', sources: ['mem-00000001'] }],
  };
  const { core, dreaming } = await setup(t, plan, { llmDelayMs: 200 });
  const activeIds = ['mem-00000001', 'mem-00000002', 'mem-00000003', 'mem-00000004'];
  await core.add({ id: 'fc-00000001', title: '固定条目', body: '用户固定的内容。', sources: ['mem-00000001', 'mem-00000002'] }, { activeIds });
  await core.setPinned('fc-00000001', true, { activeIds });
  const running = dreaming.runOnce('test', { force: true });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await core.setPinned('fc-00000001', false, { activeIds });
  const result = await running;
  assert.equal(result.status, 'conflict');
  assert.equal(core.items[0].body, '用户固定的内容。');
});

test('回滚先验完整快照：任何文件被改动都拒绝回滚且不写盘', async (t) => {
  const { core, dreaming, memoryDir } = await setup(t, {
    core: [{ op: 'add', title: '可回滚核心', body: '这条会被快照记录。', sources: ['mem-00000001', 'mem-00000002'] }],
  });
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, true);
  const snapshotDir = path.join(memoryDir, result.snapshotDir);
  const corePath = path.join(memoryDir, 'floating_core.md');
  const before = await readFile(corePath, 'utf8');

  // 篡改快照里的长期摘要：即使核心快照完好，也必须整体拒绝。
  const summaryPath = path.join(snapshotDir, 'memory_summary.md');
  const originalSummary = await readFile(summaryPath, 'utf8');
  await (await import('node:fs/promises')).writeFile(summaryPath, `${originalSummary}\n被篡改的一行`, 'utf8');
  await assert.rejects(() => dreaming.revertRun(result.runId), /sha256 不一致/);
  assert.equal(await readFile(corePath, 'utf8'), before, '被拒绝的回滚不能写盘');

  // 修复快照后再篡改核心快照：同样拒绝。
  await (await import('node:fs/promises')).writeFile(summaryPath, originalSummary, 'utf8');
  const coreSnapshot = path.join(snapshotDir, 'floating_core.md');
  await (await import('node:fs/promises')).writeFile(coreSnapshot, '<!-- 篡改 -->\n', 'utf8');
  await assert.rejects(() => dreaming.revertRun(result.runId), /floating_core\.md 快照校验失败/);
  assert.equal(await readFile(corePath, 'utf8'), before);
});

test('回滚长期摘要前会校验引用：已删除记忆的旧摘要不能带回来', async (t) => {
  const { store, core, dreaming } = await setup(t, {
    core: [{ op: 'add', title: '核心', body: '与长期记忆无关的内容。', sources: ['mem-00000001', 'mem-00000002'] }],
  });
  const victim = (await store.listActive())[0];
  await store.writeSummary(`# 我记住的用户\n\n- 引用一条记忆 <!-- [${victim.id}] -->`, { mode: 'auto' });
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, true);
  await store.forget(victim.id, '测试删除');
  const before = await readFile(path.join(store.memoryDir, 'floating_core.md'), 'utf8');
  await assert.rejects(() => dreaming.revertRun(result.runId, { summary: true }), /引用|删除/);
  assert.equal(await readFile(path.join(store.memoryDir, 'floating_core.md'), 'utf8'), before);
  assert.equal(core.items.length, 1);
});

test('模型失败时已有核心与长期记忆保持完整', async (t) => {
  const { store, core, dreaming } = await setup(t, null, { llmError: '模拟模型 500' });
  const activeIds = ['mem-00000001', 'mem-00000002', 'mem-00000003', 'mem-00000004'];
  await core.add({ id: 'fc-00000001', title: '已有核心', body: '模型失败也不能动这条。', sources: ['mem-00000001', 'mem-00000002'] }, { activeIds });
  await store.writeSummary('已有长期记忆内容', { mode: 'auto' });
  const coreBefore = await readFile(path.join(store.memoryDir, 'floating_core.md'), 'utf8');
  const summaryBefore = await store.readSummary();
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /模拟模型 500/);
  assert.equal(await readFile(path.join(store.memoryDir, 'floating_core.md'), 'utf8'), coreBefore);
  assert.equal(await store.readSummary(), summaryBefore);
  assert.equal((await store.listActive()).length, 4);
});

test('真实模型输出非法 JSON 时会自动修复一次格式', async (t) => {
  let calls = 0;
  const plan = () => {
    calls += 1;
    if (calls === 1) return '{"core":[{"op":"add","title":"缺引号",,"body":"x"}]}';
    return JSON.stringify({ core: [{ op: 'add', title: '修复后的核心', body: '这次是合法 JSON。', sources: ['mem-00000001', 'mem-00000002'] }] });
  };
  const { core, dreaming } = await setup(t, plan);
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.equal(result.retries, 1);
  assert.equal(core.items.length, 1);
  assert.equal(core.items[0].title, '修复后的核心');
});

test('修复后仍然非法时整次失败，不写核心', async (t) => {
  const { core, dreaming } = await setup(t, () => '{"core": [ 这不是 JSON');
  const result = await dreaming.runOnce('test', { force: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /不是合法 JSON/);
  assert.equal(core.items.length, 0);
});

test('仅有长期提名时核心不动、但会触发长期提炼', async (t) => {
  const seeds = [
    ['用户喜欢在深夜整理笔记，默认离线模式。', '偏好'],
    ['用户讨厌被催，任务要一次做完。', '相处方式'],
  ];
  const { store, core, dreaming } = await setup(t, {
    core: [],
    promotions: [{ id: 'mem-00000001', why: '重要经历' }],
    needsConfirmation: [],
  }, { seeds });
  const activeIds = (await store.listActive()).map((entry) => entry.id);
  await core.add({ id: 'fc-00000001', title: '已有核心', body: '仅提名时不能改这条。', sources: activeIds }, { activeIds });
  const beforeCore = await readFile(path.join(store.memoryDir, 'floating_core.md'), 'utf8');
  const beforeSummary = await store.readSummary();
  const result = await dreaming.runOnce('promotions-only', { force: true });
  assert.equal(result.ok, true);
  assert.equal(result.ops.add + result.ops.update + result.ops.remove, 0);
  assert.equal(result.promotions, 1);
  assert.equal(await readFile(path.join(store.memoryDir, 'floating_core.md'), 'utf8'), beforeCore);
  assert.equal(result.longTerm?.reason ?? null, 'test-long-term');
  assert.equal(await store.readSummary(), beforeSummary === '' ? beforeSummary : beforeSummary);
  const state = JSON.parse(await readFile(path.join(store.memoryDir, 'dreaming.json'), 'utf8'));
  assert.equal(state.recentRuns.at(-1).status, 'ok');
  assert.ok(state.lastRun.snapshotDir, '仅提名也要留快照，便于回滚长期变更');
});
