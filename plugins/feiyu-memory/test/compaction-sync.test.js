import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function fakeContext() {
  const tools = new Map();
  const handlers = new Map();
  let live = null;
  const ctx = {
    logger: { warn: () => {} },
    tools: {
      register(definition, options = {}) {
        tools.set(definition.name, { definition, options });
        return () => tools.delete(definition.name);
      },
    },
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    effect(factory) { return factory(); },
    get(name) {
      if (name === 'agents') return { list: () => [], roots: () => (live ? [live] : []), get: () => live };
      return undefined;
    },
  };
  return { ctx, tools, handlers, setLive: (agent) => { live = agent; } };
}

function makeAgent(workspace) {
  const messages = [];
  const pending = [];
  const agent = {
    session: { id: 'session-compact', header: { cwd: workspace }, deriveMessages: () => messages },
    model: { current: () => undefined },
    inbox: {
      nextStep: pending,
      replace(id, message) {
        const index = pending.findIndex((item) => item.id === id);
        if (index < 0) return false;
        pending.splice(index, 1, message);
        return true;
      },
      remove(id) {
        const index = pending.findIndex((item) => item.id === id);
        if (index < 0) return false;
        pending.splice(index, 1);
        return true;
      },
    },
    inject(message) { pending.push(message); },
  };
  return { messages, pending, agent };
}

test('DSH 压缩后下一次 pre-step 重新注入最新完整长期记忆，而非旧快照', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools, handlers, setLive } = fakeContext();
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
  });
  const made = makeAgent(workspace);
  setLive(made.agent);
  const call = (name, args) => tools.get(name).definition.execute(args, { agent: made.agent });

  await call('memory_add', { content: '压缩前的事实', summary: '压缩前' });
  await handlers.get('agent/created')({ agent: made.agent });
  made.messages.push(...made.pending);
  made.pending.length = 0;
  assert.equal(made.messages.length, 1);
  const oldText = made.messages[0].content[0].text;

  await call('memory_add', { content: '压缩后仍应出现的新事实', summary: '压缩后新事实' });
  // 模拟原生压缩：旧快照可能仍被保留，同时出现 compaction summary。
  made.messages.push({
    role: 'user',
    source: { kind: 'compaction' },
    content: [{ type: 'text', text: '这是原生上下文压缩摘要，可能包含旧记忆。' }],
  });
  handlers.get('session/event')({ id: made.agent.session.id, header: made.agent.session.header }, { type: 'compaction/end', data: { compactionId: 'c1', turn: 2 } });
  assert.equal(typeof handlers.get('agent/pre-step'), 'function');

  const decision = { kind: 'enter', messages: [...made.messages] };
  const next = async () => decision;
  const entered = await handlers.get('agent/pre-step')({ agent: made.agent, messages: made.messages, step: 2 }, next);
  assert.equal(entered.messages.length, 3);
  const latest = entered.messages[2];
  assert.equal(latest.source.kind, 'feiyu-memory');
  assert.equal(latest.source.reason, 'post-compaction');
  assert.match(latest.content[0].text, /压缩后新事实/);
  assert.notEqual(latest.content[0].text, oldText);
  assert.match(entered.messages[0].content[0].text, /压缩前/);
  assert.match(entered.messages[1].content[0].text, /压缩摘要/);
  assert.equal(made.pending.length, 0, 'pre-step 已接管并清理 pending，避免下一边界重复');
});
