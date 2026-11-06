import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

const WORKSPACE = 'C:\\PrivateWorkspace';

function session(index, turns = 4) {
  const events = [];
  let seq = 1;
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({ type: 'turn/start', seq: seq++, time: 1_700_000_000_000 + turn * 1000, data: { turn } });
    events.push({ type: 'user/message', seq: seq++, time: 1_700_000_000_001 + turn * 1000, data: { turn, content: [{ type: 'text', text: `第 ${index} 个会话第 ${turn} 轮：主人说他喜欢周末整理记忆。` }] } });
    events.push({ type: 'assistant/message', seq: seq++, time: 1_700_000_000_002 + turn * 1000, data: { turn, message: { content: [{ type: 'text', text: '收到。' }] } } });
    events.push({ type: 'turn/end', seq: seq++, time: 1_700_000_000_003 + turn * 1000, data: { turn, reason: { kind: 'completed' } } });
  }
  return { header: { id: `session-flow-${index}`, cwd: WORKSPACE, createdAt: 1_700_000_000_000 + index }, events };
}

test('turn/end 达到阈值后自动触发 Curator，并把提取结果写入记忆库', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const sessions = [1, 2, 3, 4, 5].map((index) => session(index));
  for (const item of sessions) item.header.cwd = workspace;

  const tools = new Map();
  const handlers = new Map();
  const injected = [];
  const agent = {
    session: { id: 'session-root', header: { cwd: workspace }, deriveMessages: () => [] },
    model: { current: () => ({ provider: 'fake', model: 'fake' }) },
    inject(message) { injected.push(message); },
  };
  const llm = {
    async generate() {
      return JSON.stringify({
        operations: [{
          op: 'add',
          content: '主人偏好周末整理长期记忆，并希望先看摘要再决定是否回滚。',
          summary: '周末整理记忆的偏好',
          tags: ['偏好', '记忆维护'],
          importance: 2,
          evidence: [{
            sessionId: 'session-flow-1',
            turn: 1,
            seqStart: 2,
            seqEnd: 3,
            quote: '主人说他喜欢周末整理记忆。',
          }],
        }],
      });
    },
  };
  const sessionQuery = {
    async listSessions() { return sessions.map((item) => ({ header: item.header, live: true, persisted: true })); },
    async readSession(id) { return sessions.find((item) => item.header.id === id); },
  };
  const ctx = {
    logger: { warn: () => {} },
    tools: { register(definition, options = {}) { tools.set(definition.name, { definition, options }); return () => {}; } },
    on(event, handler) { handlers.set(event, handler); return () => {}; },
    effect(factory) { return factory(); },
    get(name) {
      if (name === 'llm') return llm;
      if (name === 'sessionQuery') return sessionQuery;
      if (name === 'agents') return { list: () => [agent], get: () => agent, roots: () => [agent] };
      return undefined;
    },
    inject(deps, callback) {
      if (deps.includes('sessionQuery')) callback({ sessionQuery });
      if (deps.includes('tools')) callback(ctx);
      if (deps.includes('settings')) callback({ effect: (factory) => factory(), settings: { configure: () => {} } });
    },
  };
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
    curatorBackfill: true,
    curatorThresholdTurns: 20,
    curatorStartupDelayMs: 60000,
  });

  const onTurnEnd = handlers.get('session/event');
  assert.equal(typeof onTurnEnd, 'function');
  onTurnEnd({ id: 'session-root' }, { type: 'turn/end', data: { turn: 1 } });
  // Curator 通过 setTimeout 在后台运行；等待它完成。
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const status = JSON.parse(await tools.get('memory_status').definition.execute({}, { agent }));
  assert.equal(status.activeCount, 1);
  assert.equal(status.curator.pendingTurns, 0);
  assert.equal(status.curator.cursors, 5);
  const search = await tools.get('memory_search').definition.execute({ query: '周末整理' }, { agent });
  assert.match(search, /周末整理/);
  assert.ok(injected.length >= 1);
});
