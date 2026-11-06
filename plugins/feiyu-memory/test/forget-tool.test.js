import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function fakeContext() {
  const tools = new Map();
  const ctx = {
    logger: { warn: () => {} },
    tools: {
      register(definition, options = {}) {
        tools.set(definition.name, { definition, options });
        return () => tools.delete(definition.name);
      },
    },
    on() { return () => {}; },
    effect(factory) { return factory(); },
    get(name) {
      if (name === 'llm') return undefined;
      if (name === 'agents') return { list: () => [], get: () => undefined };
      return undefined;
    },
  };
  return { ctx, tools };
}

function fakeAgent(cwd, id = 'session-1') {
  const messages = [];
  return {
    agent: {
      session: { id, header: { cwd }, deriveMessages: () => messages },
      model: { current: () => undefined },
      inject(message) { messages.push(message); },
    },
  };
}

async function setup(t) {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools } = fakeContext();
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
  });
  const inside = fakeAgent(workspace);
  const outside = fakeAgent(path.join(dir, '其他工作区'));
  const call = (name, args, agent = inside) => tools.get(name).definition.execute(args, { agent: agent.agent });
  return { tools, call, inside, outside, workspace, dir };
}

const FACT = '主人约定：每周六晚上一起整理记忆库，先看摘要再决定是否回滚。';

test('memory_forget 软删除后搜索不到，状态里可见', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理记忆库', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];

  const out = await call('memory_forget', { id, reason: '主人改主意了' });
  assert.match(out, /已软删除/);

  const search = await call('memory_search', { query: '整理记忆库' });
  assert.match(search, /没有找到/);

  const status = JSON.parse(await call('memory_status', {}));
  assert.equal(status.activeCount, 0);
  assert.equal(status.deletedCount, 1);

  assert.equal((await call('memory_forget', { id, reason: '再来一次' })).includes('已经是删除状态'), true);
});

test('memory_restore 恢复后重新可搜索', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理记忆库', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await call('memory_forget', { id, reason: '临时' });

  const restored = await call('memory_restore', { id });
  assert.match(restored, /已恢复/);

  const search = await call('memory_search', { query: '整理记忆库' });
  assert.match(search, new RegExp(id));
  assert.match(await call('memory_restore', { id }), /本来就是活动状态/);
});

test('删除后 memory_add 无法把同一事实重新写回来', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理记忆库', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await call('memory_forget', { id, reason: '' });

  await assert.rejects(
    () => call('memory_add', { content: FACT, summary: '再记一次', tags: '约定' }),
    (error) => /已被主人删除/.test(error.message) && error.message.includes(id),
  );
});

test('memory_summary_rollback 把摘要回滚到历史版本并切换到 manual', async (t) => {
  const { call } = await setup(t);
  await call('memory_consolidate', { summary: '# 第一版\n- 旧结论' });
  await call('memory_consolidate', { summary: '# 第二版\n- 新结论' });

  const out = await call('memory_summary_rollback', { version: '1' });
  assert.match(out, /已回滚到版本 0001/);
  assert.match(out, /manual/);

  const status = JSON.parse(await call('memory_status', {}));
  assert.equal(status.summaryMode, 'manual');
  assert.ok(status.summaryVersions >= 2);
});

test('三个新工具在其他工作区一律拒绝', async (t) => {
  const { call, outside } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理记忆库', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  for (const [name, args] of [
    ['memory_forget', { id }],
    ['memory_restore', { id }],
    ['memory_summary_rollback', { version: '1' }],
  ]) {
    await assert.rejects(() => call(name, args, outside), /私人工作区/);
  }
});
