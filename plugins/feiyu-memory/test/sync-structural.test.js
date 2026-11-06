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
      session: { id: 'session-structural', header: { cwd: workspace }, deriveMessages: () => messages },
      model: { current: () => undefined },
      inject(message) { messages.push(message); },
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('修改、删除和大量变化选择正确的增量/完整同步', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const made = makeAgent(workspace);
  const { ctx, tools, handlers } = fakeContext(made.agent);
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    fullSyncChangedEntries: 2,
  });
  const call = (name, args) => tools.get(name).definition.execute(args, { agent: made.agent });
  const turnEnd = async (turn) => {
    handlers.get('session/event')({ id: made.agent.session.id }, { type: 'turn/end', data: { turn } });
    await wait(110);
  };

  const added = await call('memory_add', { content: '结构同步事实一', summary: '结构一' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await turnEnd(1);
  assert.equal(made.messages.length, 1);

  const updated = await call('memory_update', { id, content: '结构同步事实一（已修订）', summary: '结构一修订' });
  assert.match(updated, /已更新/);
  await turnEnd(2);
  assert.match(made.messages.at(-1).content[0].text, /增量同步/);
  assert.match(made.messages.at(-1).content[0].text, /已修订/);

  await call('memory_forget', { id, reason: '结构同步删除' });
  await turnEnd(3);
  assert.match(made.messages.at(-1).content[0].text, /长期记忆快照/);
  assert.equal(made.messages.at(-1).content[0].text.includes('结构同步事实一'), false);

  await call('memory_add', { content: '批量变化一', summary: '批量一' });
  await call('memory_add', { content: '批量变化二', summary: '批量二' });
  await call('memory_add', { content: '批量变化三', summary: '批量三' });
  await turnEnd(4);
  assert.match(made.messages.at(-1).content[0].text, /长期记忆快照/);
  assert.match(made.messages.at(-1).content[0].text, /批量三/);
});
