import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function makeContext() {
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
      if (name === 'agents') return { list: () => [], get: () => live, roots: () => (live ? [live] : []) };
      return undefined;
    },
  };
  return { ctx, tools, handlers, setLive: (agent) => { live = agent; } };
}

function makeAgent(workspace) {
  const messages = [];
  const pending = [];
  const agent = {
    session: {
      id: 'session-coalesce',
      header: { cwd: workspace },
      deriveMessages: () => messages,
    },
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
  return { agent, messages, pending };
}

test('同一轮多次写入只保留一条最终待注入快照，并在消费后不重复', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools, handlers, setLive } = makeContext();
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    maxSnapshotsPerSession: 8,
  });
  const made = makeAgent(workspace);
  setLive(made.agent);
  const call = (name, args) => tools.get(name).definition.execute(args, { agent: made.agent });
  await call('memory_add', { content: '同轮合并事实一', summary: '合并一' });
  await call('memory_add', { content: '同轮合并事实二', summary: '合并二' });
  assert.equal(made.pending.length, 0, '工具写入阶段不应直接入队');

  handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(made.pending.length, 1);
  assert.match(made.pending[0].content[0].text, /合并一/);
  assert.match(made.pending[0].content[0].text, /合并二/);
  assert.equal(made.pending[0].source.form, 'snapshot');

  // 模拟下一次 step 的 claim：把 pending 提交到会话 surface。
  made.messages.push(...made.pending);
  made.pending.length = 0;
  handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(made.pending.length, 0, '内容未变化时不再注入');
  assert.equal(made.messages.length, 1, '同一份快照只提交一次');
});
