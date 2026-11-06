import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function contextFor(agent) {
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

function agentWith(workspace, messages) {
  return {
    session: { id: 'session-restart', header: { cwd: workspace }, deriveMessages: () => messages },
    model: { current: () => undefined },
    inject(message) { messages.push(message); },
  };
}

test('重启后仍能基于消息里的 sync 状态做增量同步，而不是重新全量覆盖', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const config = {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
  };
  const messages = [];
  const firstAgent = agentWith(workspace, messages);
  const first = contextFor(firstAgent);
  await apply(first.ctx, config);
  const callFirst = (name, args) => first.tools.get(name).definition.execute(args, { agent: firstAgent });
  await callFirst('memory_add', { content: '重启前事实', summary: '重启前' });
  first.handlers.get('session/event')({ id: firstAgent.session.id }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(messages.length, 1);

  // 模拟 DSH/插件重启：新 Context + 新 store 实例，但恢复同一份消息历史。
  const secondAgent = agentWith(workspace, messages);
  const second = contextFor(secondAgent);
  await apply(second.ctx, config);
  const callSecond = (name, args) => second.tools.get(name).definition.execute(args, { agent: secondAgent });
  await callSecond('memory_add', { content: '重启后新增事实', summary: '重启后' });
  second.handlers.get('session/event')({ id: secondAgent.session.id }, { type: 'turn/end', data: { turn: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(messages.length, 2);
  assert.match(messages[1].content[0].text, /增量同步/);
  assert.match(messages[1].content[0].text, /重启后新增事实/);
});
