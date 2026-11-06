import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
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
      if (name === 'llm') return undefined;
      if (name === 'agents') return { list: () => [], get: () => agent, roots: () => [agent] };
      return undefined;
    },
  };
  return { ctx, tools, handlers };
}

function makeAgent(cwd, header = {}) {
  const messages = [];
  return {
    messages,
    agent: {
      session: {
        id: header.id ?? 'session-root',
        header: { cwd, ...header },
        deriveMessages: () => messages,
      },
      model: { current: () => undefined },
      inject(message) { messages.push(message); },
    },
  };
}

async function setup(t, config = {}) {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const made = makeAgent(workspace);
  const agent = made.agent;
  const { ctx, tools, handlers } = fakeContext(agent);
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
    maxSnapshotsPerSession: 1,
    ...config,
  });
  const call = (name, args, target = agent) => tools.get(name).definition.execute(args, { agent: target });
  return { dir, workspace, ctx, tools, handlers, agent, messages: made.messages, call };
}

test('子代理不能调用任何记忆写工具，根会话可以', async (t) => {
  const { workspace, call, tools } = await setup(t);
  const child = makeAgent(workspace, { id: 'session-child', parentSession: 'session-root', origin: 'subagent', delegationDepth: 1 }).agent;
  await assert.rejects(() => call('memory_add', { content: '子代理不应写入' }, child), /根会话|只在大肥鱼工作区可用/);
  await assert.rejects(() => call('memory_forget', { id: 'mem-00000001' }, child), /根会话|只在大肥鱼工作区可用/);
  for (const name of tools.keys()) {
    const options = tools.get(name).options ?? {};
    if (typeof options.when === 'function') {
      assert.equal(options.when({ agent: child }), false, `${name} 的 when 应对子代理为 false`);
    }
  }
  const out = await call('memory_add', { content: '根会话可以写入的事实', summary: '根会话' });
  assert.match(out, /已保存短期记忆/);
});

test('同一次注入操作并发调用只写入一份快照', async (t) => {
  const { workspace, handlers, call } = await setup(t, { maxSnapshotsPerSession: 2 });
  const writer = makeAgent(workspace).agent;
  writer.inject = undefined;
  await call('memory_add', { content: '并发注入测试事实一', summary: '注入一' }, writer);
  const fresh = makeAgent(workspace);
  const onCreated = handlers.get('agent/created');
  assert.equal(typeof onCreated, 'function');
  await Promise.all([onCreated({ agent: fresh.agent }), onCreated({ agent: fresh.agent })]);
  assert.equal(fresh.messages.length, 1, '并发 agent/created 只能注入一份');
});

test('完整快照之后的变化继续同步，改用增量而不是停止', async (t) => {
  const { handlers, agent, messages, call } = await setup(t, {
    maxSnapshotsPerSession: 1,
  });
  await call('memory_add', { content: '快照后续同步事实一', summary: '后续一' });
  await handlers.get('agent/created')({ agent });
  assert.equal(messages.length, 1);
  await call('memory_add', { content: '快照后续同步事实二', summary: '后续二' });
  handlers.get('session/event')({ id: agent.session.id }, { type: 'turn/end', data: { turn: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(messages.length, 2);
  assert.match(messages[1].content[0].text, /增量同步/);
  assert.match(messages[1].content[0].text, /后续二/);
});

test('长会话持续同步，取消累计次数硬上限', async (t) => {
  const { handlers, agent, messages, call } = await setup(t, {
    maxSnapshotsPerSession: 8,
  });
  for (let index = 0; index < 8; index += 1) {
    messages.push({
      id: `full-${index}`,
      role: 'user',
      source: { kind: 'feiyu-memory', scope: 'workspace', form: 'snapshot' },
      content: [{ type: 'text', text: `full snapshot ${index}` }],
    });
  }
  for (let index = 1; index <= 3; index += 1) {
    await call('memory_add', { content: `上限后的变化${index}`, summary: `变化${index}` });
    handlers.get('session/event')({ id: agent.session.id }, { type: 'turn/end', data: { turn: 9 + index } });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  assert.equal(messages.length, 11, '每次变化都同步，不设累计次数上限');
  assert.match(messages[10].content[0].text, /增量同步/);
});

test('每次记忆变化后都主动同步，不人为等待轮次间隔', async (t) => {
  const { handlers, agent, messages, call } = await setup(t, {
    maxSnapshotsPerSession: 8,
  });
  for (let index = 0; index < 8; index += 1) {
    messages.push({
      id: `full-${index}`,
      role: 'user',
      source: { kind: 'feiyu-memory', scope: 'workspace', form: 'snapshot' },
      content: [{ type: 'text', text: `full snapshot ${index}` }],
    });
  }
  await call('memory_add', { content: '即时同步变化一', summary: '即时一' });
  handlers.get('session/event')({ id: agent.session.id }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(messages.length, 9);
  await call('memory_add', { content: '即时同步变化二', summary: '即时二' });
  handlers.get('session/event')({ id: agent.session.id }, { type: 'turn/end', data: { turn: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(messages.length, 10, '下一次轮末即同步，不等待固定间隔');
});

test('快照明确标注最新与历史快照的区别', async (t) => {
  const { handlers, agent, messages } = await setup(t);
  await handlers.get('agent/created')({ agent });
  const text = messages[0]?.content?.[0]?.text ?? '';
  assert.match(text, /最新快照/);
  assert.match(text, /历史快照/);
  assert.match(text, /以本消息为准/);
});

test('手工摘要中已删除记忆的 ID 会从注入中排除，但不改写磁盘摘要', async (t) => {
  const { workspace, handlers, call } = await setup(t);
  const added = await call('memory_add', { content: '将被删除并残留在旧摘要中的事实', summary: '残留测试' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await call('memory_consolidate', { summary: `# 手工摘要\n- 旧事实 ${id}` });
  await call('memory_forget', { id, reason: '测试' });
  const fresh = makeAgent(workspace);
  await handlers.get('agent/created')({ agent: fresh.agent });
  const text = fresh.messages[0]?.content?.[0]?.text ?? '';
  assert.equal(text.includes(id), false);
  assert.match(text, /手工摘要/);
});

test('即使磁盘长期摘要仍残留已删 ID，注入过滤也不会送入模型', async (t) => {
  const { dir, workspace, handlers, call } = await setup(t);
  const added = await call('memory_add', { content: '注入过滤兜底测试事实', summary: '兜底测试' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await call('memory_consolidate', { summary: `# 手工摘要\n- 仅由 ${id} 支持的事实` });
  await call('memory_forget', { id, reason: '测试' });
  // 模拟清洗失败/旧文件残留：直接把带已删 ID 的长期摘要写回磁盘。
  await writeFile(path.join(dir, 'memories', 'memory_summary.md'), `<!-- feiyu-summary v1 -->\n\n# 手工摘要\n- 仅由 ${id} 支持的事实\n`, 'utf8');
  const fresh = makeAgent(workspace);
  await handlers.get('agent/created')({ agent: fresh.agent });
  const text = fresh.messages[0]?.content?.[0]?.text ?? '';
  assert.equal(text.includes(id), false);
  assert.equal(text.includes('支持的事实'), false);
});
