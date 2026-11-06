import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { MemoryStore } from '../lib/store.js';
import {
  CuratorService,
  buildCuratorInput,
  countPendingTurns,
  extractCuratorJson,
  extractTurns,
  planCurationBatches,
  validateCuratorOperations,
} from '../lib/curator.js';
import { makeTempDir } from './helpers.js';

const WORKSPACE = 'C:\\PrivateWorkspace';

function makeSession(index, turns = 4, baseTime = 1_700_000_000_000, cwd = WORKSPACE) {
  const events = [];
  let seq = 1;
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({ type: 'turn/start', seq: seq++, time: baseTime + turn * 1000, data: { turn } });
    events.push({
      type: 'user/message',
      seq: seq++,
      time: baseTime + turn * 1000 + 1,
      data: { turn, content: [{ type: 'text', text: `第 ${index} 个会话第 ${turn} 轮：主人说他喜欢周末整理记忆。` }] },
    });
    events.push({
      type: 'assistant/message',
      seq: seq++,
      time: baseTime + turn * 1000 + 2,
      data: { turn, message: { content: [{ type: 'text', text: `收到，第 ${turn} 轮。` }] } },
    });
    events.push({ type: 'turn/end', seq: seq++, time: baseTime + turn * 1000 + 3, data: { turn, reason: { kind: 'completed' } } });
  }
  return {
    header: { id: `session-test-${index}`, cwd, createdAt: baseTime + index, delegationDepth: 0 },
    events,
  };
}

async function setup(t, overrides = {}) {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const store = new MemoryStore({
    memoryDir: path.join(dir, 'memories'),
    now: () => new Date('2026-11-06T09:00:00+08:00'),
  });
  await store.init();
  const sessions = overrides.sessions ?? [
    makeSession(1, 4, undefined, workspace),
    makeSession(2, 4, undefined, workspace),
    makeSession(3, 4, undefined, workspace),
    makeSession(4, 4, undefined, workspace),
    makeSession(5, 4, undefined, workspace),
  ];
  for (const session of sessions) session.header.cwd = workspace;
  const sessionQuery = {
    async listSessions() {
      return sessions.map((session) => ({ header: session.header, live: true, persisted: true }));
    },
    async readSession(id) {
      const session = sessions.find((item) => item.header.id === id);
      if (!session) throw new Error('not found');
      return session;
    },
  };
  return { dir, workspace, store, sessions, sessionQuery };
}

function addOperation(quote = '主人说他喜欢周末整理记忆。') {
  return {
    operations: [{
      op: 'add',
      content: '主人偏好周末整理长期记忆，并希望先看摘要再决定是否回滚。',
      summary: '周末整理记忆的偏好',
      tags: ['偏好', '记忆维护'],
      importance: 2,
      evidence: [{
        sessionId: 'session-test-1',
        turn: 1,
        seqStart: 2,
        seqEnd: 3,
        quote,
      }],
      reason: '稳定偏好',
    }],
  };
}

test('5 个根会话各 4 轮合计 20 轮触发一次 Curator，重复运行不重复写入', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => JSON.stringify(addOperation()) },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorThresholdTurns: 20, curatorBatchBytes: 100000 },
  });
  await curator.init();
  const result = await curator.runOnce('threshold');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.added, 1);
  assert.equal((await store.listActive()).length, 1);
  assert.equal((await store.listActive())[0].content.includes('周末整理'), true);
  assert.equal((await store.listActive())[0].sourceType, 'curator');
  assert.equal((await store.listActive())[0].evidence.length, 1);
  assert.equal(curator.state.cursors['session-test-1'].lastTurn, 4);

  const second = await curator.runOnce('again');
  assert.equal(second.status, 'noop');
  assert.equal((await store.listActive()).length, 1);
});

test('未达到 20 轮不会误触发写入', async (t) => {
  const { workspace, store, sessionQuery, sessions } = await setup(t, {
    sessions: [makeSession(1, 4), makeSession(2, 4), makeSession(3, 4), makeSession(4, 4)],
  });
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => JSON.stringify(addOperation()) },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true },
  });
  await curator.init();
  assert.equal(await countPendingTurns(sessions, {}), 16);
  const scan = await curator.scan();
  assert.equal(scan.pendingTurns, 16);
  const result = await curator.onTurnEnd();
  assert.equal(result.triggered, false);
});

test('空结果不新增记忆，但推进游标避免重复处理', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => '{"operations":[],"needsConfirmation":[]}' },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000 },
  });
  await curator.init();
  const result = await curator.runOnce('empty');
  assert.equal(result.added, 0);
  assert.equal((await store.listActive()).length, 0);
  assert.equal(curator.state.cursors['session-test-5'].lastTurn, 4);
});

test('已删除记忆不会被自动重新添加', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const existing = await store.add({
    content: '主人偏好周末整理长期记忆，并希望先看摘要再决定是否回滚。',
    summary: '周末整理记忆的偏好',
    tags: ['偏好'],
  });
  await store.forget(existing.id, '用户删除');
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => JSON.stringify(addOperation()) },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000 },
  });
  await curator.init();
  const result = await curator.runOnce('deleted');
  assert.equal(result.added, 0);
  assert.ok(result.skipped >= 1);
  assert.equal((await store.listActive()).length, 0);
  assert.equal((await store.listDeleted()).length, 1);
});

test('已有手写事实比证据新时，Curator 标记待确认而不覆盖', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const existing = await store.add({
    content: '主人喜欢在周末整理记忆。',
    summary: '旧概述',
    tags: ['偏好'],
  });
  const operation = addOperation();
  operation.operations[0] = {
    ...operation.operations[0],
    op: 'update',
    id: existing.id,
    content: '主人喜欢在周末凌晨整理记忆。',
    summary: '新概述',
  };
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => JSON.stringify(operation) },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000 },
  });
  await curator.init();
  const result = await curator.runOnce('conflict');
  assert.equal(result.updated, 0);
  assert.ok(result.skipped >= 1);
  assert.equal((await store.get(existing.id)).content, '主人喜欢在周末整理记忆。');
});

test('证据引文不在原文中时被拒绝，不会写入', () => {
  const job = {
    sessionId: 's1',
    turns: [{
      turn: 1,
      startSeq: 1,
      endSeq: 4,
      text: 'USER: 主人喜欢周末整理记忆。',
      messages: [{ role: 'user', text: '主人喜欢周末整理记忆。' }],
    }],
  };
  const parsed = {
    operations: [{
      op: 'add',
      content: '主人喜欢周末整理记忆。',
      evidence: [{ sessionId: 's1', turn: 1, seqStart: 1, seqEnd: 4, quote: '这句话不存在于原文' }],
    }],
  };
  const validated = validateCuratorOperations(parsed, { jobs: [job], memories: [] });
  assert.equal(validated.operations.length, 0);
  assert.equal(validated.errors.length, 1);
  assert.match(validated.errors[0].error, /quote/);
});

test('代码块和前后解释中的 JSON 仍可解析', () => {
  const parsed = extractCuratorJson('说明\n```json\n{"operations":[]}\n```\n结束');
  assert.deepEqual(parsed, { operations: [] });
});

test('策展输入包含对话段，且不会一次性塞入全部历史', () => {
  const jobs = Array.from({ length: 8 }, (_, index) => ({
    sessionId: `s${index}`,
    fromTurn: 1,
    toTurn: 4,
    fromSeq: 1,
    toSeq: 16,
    turns: [{
      turn: 1,
      startSeq: 1,
      endSeq: 4,
      text: `USER: 第 ${index} 个会话的长期偏好。`,
      messages: [{ role: 'user', text: `第 ${index} 个会话的长期偏好。` }],
    }],
  }));
  const result = buildCuratorInput({ jobs, memories: [], curatorMaxBytes: 2000, curatorMaxTokens: 500 });
  assert.ok(result.jobs.length < jobs.length || result.bytes <= 2000);
  assert.ok(result.text.includes('待整理对话'));
});

test('批次规划每批最多 8 个会话，单次最多 8 批', () => {
  const sessions = Array.from({ length: 20 }, (_, index) => makeSession(index + 1, 4));
  const plan = planCurationBatches(sessions, {}, {
    curatorSessionsPerBatch: 8,
    curatorBatchesPerRun: 8,
    curatorTurnsPerSlice: 1,
    curatorBatchBytes: 100000,
  });
  assert.equal(plan.batches.length, 8);
  for (const batch of plan.batches) assert.ok(batch.jobs.length <= 8);
  assert.ok(plan.remaining >= 0);
  const turns = extractTurns(sessions[0].events);
  assert.equal(turns.length, 4);
});

test('prepareCall + stream 路径也能完成一次提取', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const text = JSON.stringify(addOperation());
  const llm = {
    async prepareCall() {
      return {
        config: { provider: 'fake', model: 'fake' },
        async *stream() {
          yield { type: 'text-delta', text: text.slice(0, 20) };
          yield { type: 'text-delta', text: text.slice(20) };
          yield { type: 'finish', finish: { kind: 'stop' } };
        },
      };
    },
  };
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm,
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000 },
  });
  await curator.init();
  const result = await curator.runOnce('prepared');
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal((await store.listActive()).length, 1);
});

test('重启后从 curator.json 恢复游标，不重复整理', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const llm = { generate: async () => JSON.stringify(addOperation()) };
  const first = new CuratorService({
    store,
    sessionQuery,
    llm,
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000 },
  });
  await first.init();
  await first.runOnce('first');
  const second = new CuratorService({
    store,
    sessionQuery,
    llm,
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000 },
  });
  await second.init();
  const result = await second.runOnce('restart');
  assert.equal(result.status, 'noop');
  assert.equal((await store.listActive()).length, 1);
  assert.equal(second.state.cursors['session-test-1'].lastTurn, 4);
});

test('模拟写入后未推进游标：重跑按内容去重，不重复新增', async (t) => {
  const { workspace, store, sessionQuery } = await setup(t);
  const llm = { generate: async () => JSON.stringify(addOperation()) };
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm,
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: workspace,
    config: { curatorEnabled: true, curatorBackfill: true, curatorBatchBytes: 100000, curatorRunsPerHour: 100 },
  });
  await curator.init();
  await curator.runOnce('first');
  curator.state.cursors = {};
  curator.state.appliedOps = {};
  await curator._writeState();
  const result = await curator.runOnce('retry-after-crash');
  assert.equal(result.added, 0);
  assert.ok(result.skipped >= 1);
  assert.equal((await store.listActive()).length, 1);
});
