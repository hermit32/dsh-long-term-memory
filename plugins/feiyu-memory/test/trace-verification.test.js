import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

const QUOTE = '主人说他喜欢在周六整理记忆。';

function sessionEvents() {
  return [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 1001, data: { turn: 1, content: [{ type: 'text', text: QUOTE }] } },
    { type: 'assistant/message', seq: 3, time: 1002, data: { turn: 1, message: { content: [{ type: 'text', text: '收到。' }] } } },
    { type: 'turn/end', seq: 4, time: 1003, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
}

test('memory_trace 分层校验：哈希、会话、坐标、正文支持分开报告', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const tools = new Map();
  const agent = {
    session: { id: 'session-root', header: { cwd: workspace }, deriveMessages: () => [] },
    model: { current: () => undefined },
    inject() {},
  };
  const sessionQuery = {
    async listSessions() { return [{ header: { id: 'session-src', cwd: workspace, createdAt: 1000 }, live: true }]; },
    async readSession(id) {
      assert.equal(id, 'session-src');
      return { header: { id, cwd: workspace, createdAt: 1000 }, events: sessionEvents() };
    },
  };
  const ctx = {
    logger: { warn: () => {} },
    tools: { register(definition, options = {}) { tools.set(definition.name, { definition, options }); return () => {}; } },
    on() { return () => {}; },
    effect(factory) { return factory(); },
    get(name) {
      if (name === 'agents') return { list: () => [], get: () => undefined, roots: () => [] };
      if (name === 'sessionQuery') return sessionQuery;
      return undefined;
    },
    inject(deps, callback) {
      if (deps.includes('sessionQuery')) callback({ sessionQuery });
      if (deps.includes('tools')) callback(ctx);
      if (deps.includes('settings')) callback({ effect: (factory) => factory(), settings: { configure: () => {} } });
    },
  };
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
  });
  const call = (name, args) => tools.get(name).definition.execute(args, { agent });
  const added = await call('memory_add', {
    content: `主人偏好：${QUOTE}`,
    summary: '周六整理记忆的偏好',
    session: 'session-src',
    turn: 1,
    seq: '2-3',
    quote: QUOTE,
  });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  const trace = await call('memory_trace', { id });
  assert.match(trace, /指纹校验: verified/);
  assert.match(trace, /会话存在: verified/);
  assert.match(trace, /坐标命中: verified/);
  assert.match(trace, /正文支持: quote-in-content/);
  assert.match(trace, /综合: source-verified/);
});

test('坐标不匹配时 memory_trace 不把整条记忆标为 source-verified', async (t) => {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const tools = new Map();
  const agent = {
    session: { id: 'session-root', header: { cwd: workspace }, deriveMessages: () => [] },
    model: { current: () => undefined },
    inject() {},
  };
  const sessionQuery = {
    async listSessions() { return []; },
    async readSession(id) { return { header: { id, cwd: workspace }, events: sessionEvents() }; },
  };
  const ctx = {
    logger: { warn: () => {} },
    tools: { register(definition, options = {}) { tools.set(definition.name, { definition, options }); return () => {}; } },
    on() { return () => {}; },
    effect(factory) { return factory(); },
    get(name) {
      if (name === 'agents') return { list: () => [], get: () => undefined, roots: () => [] };
      if (name === 'sessionQuery') return sessionQuery;
      return undefined;
    },
    inject(deps, callback) {
      if (deps.includes('sessionQuery')) callback({ sessionQuery });
      if (deps.includes('tools')) callback(ctx);
      if (deps.includes('settings')) callback({ effect: (factory) => factory(), settings: { configure: () => {} } });
    },
  };
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
  });
  const call = (name, args) => tools.get(name).definition.execute(args, { agent });
  const added = await call('memory_add', {
    content: `主人偏好：${QUOTE}`,
    summary: '坐标错误测试',
    session: 'session-src',
    turn: 2,
    seq: '99-100',
    quote: QUOTE,
  });
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  const trace = await call('memory_trace', { id });
  assert.match(trace, /坐标命中: mismatch/);
  assert.doesNotMatch(trace, /综合: source-verified/);
});
