import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function fakeContext() {
  const tools = new Map();
  const handlers = new Map();
  const live = [];
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
      if (name === 'agents') {
        return {
          list: () => live,
          roots: () => live,
          get: (id) => live.find((item) => item.session.id === id),
        };
      }
      return undefined;
    },
  };
  return { ctx, tools, handlers, live };
}

function makeAgent(workspace, id) {
  const messages = [];
  return {
    messages,
    agent: {
      session: { id, header: { cwd: workspace }, deriveMessages: () => messages },
      model: { current: () => undefined },
      inject(message) { messages.push(message); },
    },
  };
}

test('一个根会话写入记忆后，其他存活根会话在下一次请求前同步', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools, handlers, live } = fakeContext();
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
  });
  const a = makeAgent(workspace, 'session-a');
  const b = makeAgent(workspace, 'session-b');
  live.push(a.agent, b.agent);
  const call = (name, args) => tools.get(name).definition.execute(args, { agent: a.agent });

  await call('memory_add', { content: '跨会话同步事实一', summary: '跨会话一' });
  handlers.get('session/event')({ id: a.agent.session.id }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(a.messages.length, 1);
  assert.equal(b.messages.length, 1);
  assert.match(b.messages[0].content[0].text, /跨会话一/);

  await call('memory_add', { content: '跨会话同步事实二', summary: '跨会话二' });
  handlers.get('session/event')({ id: a.agent.session.id }, { type: 'turn/end', data: { turn: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(b.messages.length, 2);
  assert.match(b.messages[1].content[0].text, /跨会话二/);
  assert.match(b.messages[1].content[0].text, /增量同步/);
});
