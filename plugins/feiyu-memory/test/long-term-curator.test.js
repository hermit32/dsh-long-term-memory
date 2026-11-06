import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { MemoryStore } from '../lib/store.js';
import { CuratorService } from '../lib/curator.js';
import { makeTempDir, sequenceIds, fixedNow } from './helpers.js';

const WORKSPACE = 'C:\\PrivateWorkspace';

function makeSession(id, turns, base = 1_700_000_000_000) {
  const events = [];
  let seq = 1;
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({ type: 'turn/start', seq: seq++, time: base + turn * 1000, data: { turn } });
    events.push({
      type: 'user/message',
      seq: seq++,
      time: base + turn * 1000 + 1,
      data: { turn, content: [{ type: 'text', text: `第 ${turn} 轮：主人说他喜欢周末整理记忆。` }] },
    });
    events.push({
      type: 'assistant/message',
      seq: seq++,
      time: base + turn * 1000 + 2,
      data: { turn, message: { content: [{ type: 'text', text: '收到。' }] } },
    });
    events.push({ type: 'turn/end', seq: seq++, time: base + turn * 1000 + 3, data: { turn, reason: { kind: 'completed' } } });
  }
  return { header: { id, cwd: WORKSPACE, createdAt: base, delegationDepth: 0 }, events };
}

async function setup(t) {
  const dir = await makeTempDir(t);
  await mkdir(path.join(dir, '大肥鱼'), { recursive: true });
  const store = new MemoryStore({
    memoryDir: path.join(dir, 'memories'),
    idFactory: sequenceIds(),
    now: fixedNow(),
  });
  await store.init();
  return { dir, store };
}

test('首次启用默认只建立新游标，不回填历史对话', async (t) => {
  const { dir, store } = await setup(t);
  const sessions = [1, 2, 3, 4, 5].map((index) => makeSession(`session-${index}`, 3));
  const sessionQuery = {
    async listSessions() { return sessions.map((item) => ({ header: item.header })); },
    async readSession(id) { return sessions.find((item) => item.header.id === id); },
  };
  let calls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => { calls += 1; return '{"operations":[],"needsConfirmation":[]}'; } },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: { curatorEnabled: true, curatorBackfill: false, longTermMode: 'off' },
  });
  await curator.init();
  const first = await curator.runOnce('first-enable');
  assert.equal(first.ok, true);
  assert.equal(first.pendingTurns, 0);
  assert.equal(calls, 0);
  assert.equal(curator.state.baselineDone, true);
  assert.equal(curator.state.baselineMode, 'new-only');
  assert.equal(Object.keys(curator.state.cursors).length, 5);

  sessions.push(makeSession('session-new', 1));
  const second = await curator.runOnce('after-new-session');
  assert.equal(second.ok, true);
  assert.equal(second.pendingTurns, 1);
  assert.equal(calls, 1);
  assert.equal(curator.state.cursors['session-new'].lastTurn, 1);
  assert.equal(curator.state.cursors['session-1'].lastTurn, 3);
  assert.equal((await store.listActive()).length, 0);
});

test('首次启用不会因为已有短期记忆立刻回填长期摘要', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '启用前就存在的短期事实。', summary: '启用前事实', tags: '历史' });
  let calls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no sessions'); } },
    llm: { async generate() { calls += 1; return '# 长期记忆\n\n- 新事实。[mem-00000002]'; } },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: false,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const first = await curator.runOnce('enable');
  assert.equal(first.ok, true);
  assert.equal(calls, 0);
  assert.equal(await store.readSummary(), '');
  assert.equal(curator.state.longTerm.baseline, true);

  await store.add({ content: '启用后新增的事实。', summary: '启用后事实', tags: '新' });
  const second = await curator.runOnce('first-new-fact');
  assert.equal(second.ok, true);
  assert.equal(calls, 1);
  assert.match(await store.readSummary(), /新事实/);
});

test('Curator 第二阶段把模型 Markdown 写成长期记忆版本', async (t) => {
  const { store } = await setup(t);
  const entry = await store.add({
    content: '主人偏好茶，尤其是乌龙茶。',
    summary: '主人偏好乌龙茶',
    tags: '偏好',
  });
  assert.equal(entry.id, 'mem-00000001');
  let longTermCalls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery: {
      async listSessions() { return []; },
      async readSession() { throw new Error('no sessions'); },
    },
    llm: {
      async generate({ system }) {
        if (String(system).includes('长期记忆策展人')) {
          longTermCalls += 1;
          return [
            '# 大肥鱼长期记忆',
            '',
            '## 偏好与边界',
            '- 主人偏好乌龙茶，日常饮茶以乌龙为主。[mem-00000001]',
          ].join('\n');
        }
        return '{"operations":[],"needsConfirmation":[]}';
      },
    },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: true,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const result = await curator.runOnce('synthesis-test');
  assert.equal(result.ok, true);
  assert.equal(longTermCalls, 1);
  const summary = await store.readSummary();
  assert.match(summary, /主人偏好乌龙茶/);
  assert.match(summary, /mem-00000001/);
  assert.equal(summary.includes('自动汇编'), false);
  const meta = await store.summaryMeta();
  assert.equal(meta.mode, 'auto');
  assert.ok(meta.hash.length === 64);
  assert.ok(curator.state.longTerm.sourceHash.length === 64);
  assert.equal(curator.state.longTerm.summaryHash, meta.hash);
});

test('长期合成拒绝缺失锁定块和已删除引用，保留旧摘要', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '主人偏好茶。', summary: '偏好茶', tags: '偏好' });
  await store.writeSummary([
    '# 大肥鱼长期记忆',
    '<!-- feiyu-lock:start id="lk-33333333" -->',
    '- 主人偏好茶。[mem-00000001]',
    '<!-- feiyu-lock:end -->',
  ].join('\n'), { mode: 'auto' });
  const before = await store.readSummary();
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no sessions'); } },
    llm: { async generate() { return '# 大肥鱼长期记忆\n- 没有锁定块的新版本。[mem-00000001]'; } },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: true,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const result = await curator.runOnce('lock-reject');
  assert.equal(result.ok, true);
  assert.equal(result.longTermError.includes('锁定块'), true);
  assert.equal(await store.readSummary(), before);
});
