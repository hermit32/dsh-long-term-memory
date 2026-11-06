import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function fakeContext(agent) {
  const tools = new Map();
  const handlers = new Map();
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
      if (name === 'agents') return { list: () => [], roots: () => [agent], get: () => agent };
      return undefined;
    },
  };
  return { ctx, tools, handlers };
}

function makeAgent(workspace) {
  const messages = [];
  return {
    messages,
    agent: {
      session: { id: 'session-long', header: { cwd: workspace }, deriveMessages: () => messages },
      model: { current: () => undefined },
      inject(message) { messages.push(message); },
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('30 轮长会话持续同步，不设完整快照/更新累计上限', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const made = makeAgent(workspace);
  const { ctx, tools, handlers } = fakeContext(made.agent);
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    maxSnapshotsPerSession: 1,
    fullSyncChangedEntries: 4,
  });
  const call = (name, args) => tools.get(name).definition.execute(args, { agent: made.agent });
  await call('memory_add', { content: '长会话初始事实', summary: '初始' });
  await handlers.get('agent/created')({ agent: made.agent });
  assert.equal(made.messages.length, 1);

  for (let index = 1; index <= 30; index += 1) {
    await call('memory_add', { content: `长会话事实 ${index}`, summary: `长会话 ${index}` });
    handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: index } });
    await wait(35);
  }
  assert.equal(made.messages.length, 31, '30 次变化都应持续同步，没有累计上限');
  assert.match(made.messages.at(-1).content[0].text, /长会话事实 30/);
  assert.match(made.messages.at(-1).content[0].text, /增量同步|长期记忆快照/);

  const beforeNoop = made.messages.length;
  handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: 31 } });
  await wait(100);
  assert.equal(made.messages.length, beforeNoop, '无变化不重复注入');

  const added = await call('memory_add', { content: '长会话待删除事实', summary: '待删除' });
  const deleteId = /mem-[0-9a-f]{8}/.exec(added)?.[0];
  assert.ok(deleteId);
  handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: 32 } });
  await wait(100);
  const beforeDelete = made.messages.length;
  await call('memory_forget', { id: deleteId, reason: '长会话删除测试' });
  handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: 33 } });
  await wait(150);
  assert.equal(made.messages.length, beforeDelete + 1);
  assert.equal(made.messages.at(-1).content[0].text.includes('待删除'), false);
  assert.match(made.messages.at(-1).content[0].text, /长期记忆快照|增量同步/);
});
