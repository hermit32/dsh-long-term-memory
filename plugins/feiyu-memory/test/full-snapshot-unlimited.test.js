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
      session: { id: 'session-full', header: { cwd: workspace }, deriveMessages: () => messages },
      model: { current: () => undefined },
      inject(message) { messages.push(message); },
    },
  };
}

test('完整快照也不设累计次数上限，超过旧 8 份后仍按结构变化重注入', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const made = makeAgent(workspace);
  const { ctx, tools, handlers } = fakeContext(made.agent);
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    fullSyncChangedEntries: 1,
  });
  const call = (name, args) => tools.get(name).definition.execute(args, { agent: made.agent });
  await call('memory_add', { content: '完整快照初始事实', summary: '初始' });
  await handlers.get('agent/created')({ agent: made.agent });
  assert.equal(made.messages.length, 1);

  for (let index = 1; index <= 12; index += 1) {
    await call('memory_add', { content: `完整快照事实 ${index}A`, summary: `快照 ${index}A` });
    await call('memory_add', { content: `完整快照事实 ${index}B`, summary: `快照 ${index}B` });
    handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn: index } });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  assert.equal(made.messages.length, 13, '12 次结构变化都使用完整快照，没有 8 份上限');
  assert.match(made.messages.at(-1).content[0].text, /长期记忆快照/);
  assert.match(made.messages.at(-1).content[0].text, /快照 12B/);
});
