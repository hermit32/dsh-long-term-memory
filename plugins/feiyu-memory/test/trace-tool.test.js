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
  return { agent: { session: { id, header: { cwd }, deriveMessages: () => messages }, model: { current: () => undefined }, inject: (m) => messages.push(m) } };
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
  return { call, outside };
}

const FACT = '主人约定：每周六晚整理记忆库，先看摘要再决定是否回滚。';

test('memory_update 改正文后搜索到新内容，memory_history 能列出快照', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];

  const out = await call('memory_update', { id, content: `${FACT}时间改到周日。`, summary: '周日整理' });
  assert.match(out, /已更新短期记忆/);
  assert.match(await call('memory_search', { query: '时间改到周日' }), new RegExp(id));

  const history = await call('memory_history', { id });
  assert.match(history, /共 1 条修改历史/);
  assert.match(history, /content\/summary/);
});

test('memory_revert 把记忆退回到修改前的正文', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await call('memory_update', { id, content: '完全不同的新正文' });

  const reverted = await call('memory_revert', { id });
  assert.match(reverted, /已回退/);
  const search = await call('memory_search', { query: '每周六晚整理记忆库' });
  assert.match(search, new RegExp(id));
  assert.doesNotMatch(search, /完全不同的新正文/);
});

test('memory_trace 返回溯源与 verified 校验', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', {
    content: FACT,
    summary: '周六整理',
    tags: '约定',
    session: 'session-abc',
    turn: 3,
    seq: '88-96',
    quote: '主人：以后周六晚上一起整理记忆库',
  });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];

  const trace = await call('memory_trace', { id });
  assert.match(trace, /session=session-abc turn=3 seq=88-96/);
  assert.match(trace, /引文: 主人：以后周六晚上一起整理记忆库/);
  assert.match(trace, /verified/);
});

test('旧记忆没有引文时 memory_trace 明确说明', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  const trace = await call('memory_trace', { id });
  assert.match(trace, /missing-quote/);
  assert.match(trace, /（未记录）/);
});

test('已删除的记忆不能编辑，但能查修改历史以外的状态', async (t) => {
  const { call } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await call('memory_forget', { id, reason: '测试' });
  await assert.rejects(() => call('memory_update', { id, summary: '改' }), /已被删除/);
});

test('四个新工具在其他工作区一律拒绝', async (t) => {
  const { call, outside } = await setup(t);
  const added = await call('memory_add', { content: FACT, summary: '周六整理', tags: '约定' });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  for (const [name, args] of [
    ['memory_update', { id, summary: '改' }],
    ['memory_history', { id }],
    ['memory_revert', { id }],
    ['memory_trace', { id }],
  ]) {
    await assert.rejects(() => call(name, args, outside), /只在大肥鱼工作区可用/);
  }
});
