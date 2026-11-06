import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { MEMORY_SOURCE_KIND } from '../lib/injection.js';
import { makeTempDir } from './helpers.js';

function fakeContext() {
  const tools = new Map();
  const handlers = new Map();
  const liveAgents = [];
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
    effect(factory) {
      return factory();
    },
    get(name) {
      if (name === 'llm') return undefined;
      if (name === 'agents') return { list: () => liveAgents, roots: () => liveAgents, get: () => liveAgents[0] };
      return undefined;
    },
  };
  return { ctx, tools, handlers, liveAgents };
}

function fakeAgent(cwd, id = 'session-1') {
  const messages = [];
  const injected = [];
  return {
    messages,
    injected,
    agent: {
      session: {
        id,
        header: { cwd },
        deriveMessages: () => messages,
      },
      model: { current: () => undefined },
      inject(message) {
        injected.push(message);
        messages.push(message);
      },
    },
  };
}

test('顶层 context 没有 tools 时，工具必须通过 inject 延后注册且 apply 不抛错', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace, { recursive: true });

  const tools = new Map();
  const ctx = {
    logger: { warn: () => {} },
    on() { return () => {}; },
    effect(factory) { return factory(); },
    get() { return undefined; },
    inject(deps, callback) {
      if (deps.includes('tools')) {
        callback({ tools: { register(definition, options = {}) { tools.set(definition.name, options); return () => {}; } } });
      }
      if (deps.includes('settings')) callback({ effect: (factory) => factory(), settings: { configure: () => {} } });
    },
  };

  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
  });

  assert.equal(tools.size, 12, '十二个工具都应该注册成功');
  assert.ok(tools.has('memory_update'));
  assert.ok(tools.has('memory_trace'));
  assert.ok(tools.has('memory_add'));
});

test('volatile 配置引用能转换为运行时配置', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools } = fakeContext();
  const ref = (value) => ({ get: () => value });
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: ref(true),
    injectIndex: ref(true),
    scopeMaxBytes: ref(12000),
    maxBytes: ref(14000),
    maxActiveMemories: ref(200),
    keepSummaryVersions: ref(30),
    indexMaxBytes: ref(40960),
    indexMaxTokens: ref(12000),
  });
  const agent = fakeAgent(workspace);
  const status = JSON.parse(await tools.get('memory_status').definition.execute({}, { agent: agent.agent }));
  assert.equal(status.activeCount, 0);
  assert.equal(status.contextBudget.source, 'fallback');
});

test('插件在真实 store 上注册工具、执行读写并隔离其他工作区', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools, handlers, liveAgents } = fakeContext();
  const config = {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
  };
  await apply(ctx, config);

  assert.deepEqual([...tools.keys()].sort(), [
    'memory_add',
    'memory_consolidate',
    'memory_curate',
    'memory_forget',
    'memory_history',
    'memory_restore',
    'memory_revert',
    'memory_search',
    'memory_status',
    'memory_summary_rollback',
    'memory_trace',
    'memory_update',
  ]);

  const inside = fakeAgent(workspace);
  const outside = fakeAgent(path.join(dir, '其他工作区'));
  liveAgents.push(inside.agent);

  for (const { options } of tools.values()) {
    assert.equal(options.when({ agent: inside.agent }), true);
    assert.equal(options.when({ agent: outside.agent }), false);
  }

  const addTool = tools.get('memory_add').definition;
  const added = await addTool.execute({
    content: '2026-11-05，主人完成了大肥鱼工作区插件集成测试。',
    summary: '完成插件集成测试',
    tags: '测试,插件',
    source: 'test',
    context: 'integration',
    importance: 2,
  }, { agent: inside.agent });
  assert.match(added, /已保存短期记忆 mem-[0-9a-f]{8}/);
  assert.equal(inside.injected.length, 0);
  handlers.get('session/event')({ id: inside.agent.session.id }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(inside.injected.length, 1);
  assert.equal(inside.injected[0].role, 'user');
  assert.equal(inside.injected[0].source.kind, MEMORY_SOURCE_KIND);
  assert.match(inside.injected[0].content[0].text, /## 短期记忆索引/);
  assert.match(inside.injected[0].content[0].text, /完成插件集成测试/);

  const status = JSON.parse(await tools.get('memory_status').definition.execute({}, { agent: inside.agent }));
  assert.equal(status.activeCount, 1);
  assert.equal(status.memoryDir, path.join(dir, 'memories'));
  assert.equal(status.contextBudget.source, 'fallback');
  assert.equal(status.contextBudget.tokens, 8192);

  const search = await tools.get('memory_search').definition.execute({
    query: '集成测试',
  }, { agent: inside.agent });
  assert.match(search, /mem-[0-9a-f]{8}/);
  assert.match(search, /插件集成测试/);

  const curated = await tools.get('memory_curate').definition.execute({}, { agent: inside.agent });
  assert.match(curated, /## 长期记忆/);
  assert.match(curated, /## 短期记忆条目/);

  const consolidated = await tools.get('memory_consolidate').definition.execute({
    summary: '2026-11-05 完成插件集成测试。',
  }, { agent: inside.agent });
  assert.match(consolidated, /长期记忆已更新/);

  await assert.rejects(
    tools.get('memory_status').definition.execute({}, { agent: outside.agent }),
    /只在大肥鱼工作区可用/,
  );
});
