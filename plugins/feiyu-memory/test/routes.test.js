import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir } from './helpers.js';

function fakeContext(options = {}) {
  const tools = new Map();
  const routes = new Map();
  const connection = Object.prototype.hasOwnProperty.call(options, 'connection')
    ? options.connection
    : { admit: () => ({ peer: { principal: { kind: 'owner' } } }) };
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
      if (name === 'connection') return connection;
      return undefined;
    },
    inject(deps, callback) {
      if (deps.includes('tools')) callback(ctx);
      if (deps.includes('webServer')) {
        callback({
          webServer: {
            register(route) {
              routes.set(route.path, route);
              return () => routes.delete(route.path);
            },
          },
          effect(factory) { return factory(); },
        });
      }
      if (deps.includes('settings')) {
        callback({ effect: (factory) => factory(), settings: { configure: () => {} } });
      }
    },
  };
  return { ctx, tools, routes };
}

function fakeRequest(body, options = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const buffer = Buffer.from(text, 'utf8');
  const headers = {
    'x-dsh-memory-client': 'dsh-memory-feiyu/1',
    'content-type': 'application/json',
    ...(options.headers ?? {}),
  };
  return {
    method: options.method ?? 'POST',
    socket: { remoteAddress: options.ip ?? '127.0.0.1' },
    headers,
    async *[Symbol.asyncIterator]() {
      yield buffer;
    },
  };
}

function fakeResponse() {
  const state = { status: 0, body: '' };
  return {
    state,
    destroyed: false,
    writableEnded: false,
    writeHead(status) { state.status = status; },
    end(body) { state.body = body ?? ''; this.writableEnded = true; },
  };
}

async function setup(t, options = {}) {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, '大肥鱼');
  await mkdir(workspace, { recursive: true });
  const { ctx, tools, routes } = fakeContext(options);
  await apply(ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
  });
  const agent = {
    session: { id: 'session-1', header: { cwd: workspace }, deriveMessages: () => [] },
    model: { current: () => undefined },
    inject() {},
  };
  const call = (name, args) => tools.get(name).definition.execute(args, { agent });
  const hit = async (name, body, options) => {
    const route = routes.get(`/api/dsh-memory-feiyu/${name}`);
    assert.ok(route, `缺少路由 ${name}`);
    const response = fakeResponse();
    await route.handler(fakeRequest(body, options), response);
    return { status: response.state.status, body: response.state.body ? JSON.parse(response.state.body) : null };
  };
  return { call, hit, routes };
}

async function addMemory(call, text, summary) {
  const out = await call('memory_add', { content: text, summary, tags: '接口测试' });
  return /mem-[0-9a-f]{8}/.exec(out)[0];
}

test('接口注册了完整路由集合', async (t) => {
  const { routes } = await setup(t);
  assert.deepEqual([...routes.keys()].sort(), [
    '/api/dsh-memory-feiyu/forget',
    '/api/dsh-memory-feiyu/history',
    '/api/dsh-memory-feiyu/long-term',
    '/api/dsh-memory-feiyu/restore',
    '/api/dsh-memory-feiyu/revert',
    '/api/dsh-memory-feiyu/rollback',
    '/api/dsh-memory-feiyu/state',
    '/api/dsh-memory-feiyu/update',
  ]);
});

test('认证拒绝时一律拒绝，不依赖回环地址', async (t) => {
  const { hit } = await setup(t, { connection: { admit: () => ({ rejection: 403 }) } });
  const result = await hit('forget', { id: 'mem-00000001' }, { ip: '192.168.1.9' });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'forbidden');
});

test('connection 不可用时 fail-closed 返回 503', async (t) => {
  const { hit } = await setup(t, { connection: null });
  const result = await hit('state', {});
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'auth-unavailable');
});

test('非 owner peer 不能调用设置页写接口', async (t) => {
  const { hit } = await setup(t, {
    connection: { admit: () => ({ peer: { principal: { kind: 'api' } } }) },
  });
  const result = await hit('forget', { id: 'mem-00000001' });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'forbidden');
});

test('connection.admit 抛异常时 fail-closed 返回 503', async (t) => {
  const { hit } = await setup(t, {
    connection: { admit: () => { throw new Error('auth backend down'); } },
  });
  const result = await hit('state', {});
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'auth-unavailable');
});

test('缺少客户端标记一律 403', async (t) => {
  const { hit } = await setup(t);
  const result = await hit('forget', { id: 'mem-00000001' }, { headers: { 'x-dsh-memory-client': 'browser' } });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'client-required');
});

test('接口删除后搜索不到，恢复后又能搜到', async (t) => {
  const { call, hit } = await setup(t);
  const id = await addMemory(call, '接口测试：主人同意周末整理记忆库的时间改到周日晚上。', '接口删除测试');

  const removed = await hit('forget', { id, reason: '接口测试' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.equal(removed.body.changed, true);
  assert.match(await call('memory_search', { query: '周末整理记忆库' }), /没有找到/);

  const restored = await hit('restore', { id });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.changed, true);
  assert.match(await call('memory_search', { query: '周末整理记忆库' }), new RegExp(id));
});

test('接口删除未知 ID 返回 400 与可读原因', async (t) => {
  const { hit } = await setup(t);
  const result = await hit('forget', { id: 'mem-99999999' });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /没有找到记忆/);
});

test('接口回滚不存在的版本返回 400', async (t) => {
  const { hit } = await setup(t);
  const result = await hit('rollback', { version: '9' });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /不存在/);
});

test('接口 edit / history / revert 形成闭环', async (t) => {
  const { call, hit } = await setup(t);
  const id = await addMemory(call, '接口编辑测试：主人把整理记忆库的时间从周六改到周日。', '接口编辑原稿');

  const updated = await hit('update', {
    id,
    content: '接口编辑测试：主人把整理记忆库的时间从周六改到周日晚八点。',
    summary: '接口编辑新稿',
    reason: '接口测试',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.changed, true);
  assert.deepEqual(updated.body.fields.sort(), ['content', 'summary']);

  const history = await hit('history', { id });
  assert.equal(history.status, 200);
  assert.equal(history.body.revisions.length, 1);
  assert.equal(history.body.revisions[0].reason, '接口测试');

  const reverted = await hit('revert', { id, version: 1 });
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.changed, true);
  assert.match(await call('memory_search', { query: '从周六改到周日' }), new RegExp(id));
});

test('接口 update 没有可改字段时返回 400', async (t) => {
  const { call, hit } = await setup(t);
  const id = await addMemory(call, '接口编辑测试二：用于验证空补丁被拒绝。', '空补丁');
  const result = await hit('update', { id });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /没有需要修改的字段/);
});

test('接口回滚成功并返回 manual 模式', async (t) => {  const { call, hit } = await setup(t);
  await call('memory_consolidate', { summary: '# 甲版\n- 结论甲' });
  await call('memory_consolidate', { summary: '# 乙版\n- 结论乙' });
  const result = await hit('rollback', { version: '1' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.version, '0001.md');
  assert.equal(result.body.mode, 'manual');
});

test('非法 JSON 返回 400 而不是崩溃', async (t) => {
  const { hit } = await setup(t);
  const result = await hit('forget', 'not-json');
  assert.equal(result.status, 400);
  assert.match(result.body.error, /JSON/);
});

test('接口只允许 POST，GET 返回 405', async (t) => {
  const { hit } = await setup(t);
  const result = await hit('state', {}, { method: 'GET' });
  assert.equal(result.status, 405);
});

test('DSH 连接认证拒绝时返回 401，不依赖固定请求头', async (t) => {
  const { hit } = await setup(t, { connection: { admit: () => ({ rejection: 401 }) } });
  const result = await hit('forget', { id: 'mem-00000001' });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'unauthorized');
});

test('状态接口返回摘要模式、Curator 状态和损坏记录计数', async (t) => {
  const { hit } = await setup(t);
  const result = await hit('state', {});
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.summaryMode, 'auto');
  assert.ok(result.body.curator);
  assert.equal(typeof result.body.parseErrors, 'number');
  assert.ok(Array.isArray(result.body.versionInfo));
});

test('状态接口可以显式把 manual 摘要切回 auto', async (t) => {
  const { call, hit } = await setup(t);
  await call('memory_consolidate', { summary: '# 手写摘要\n- 一条' });
  const manual = await hit('state', {});
  assert.equal(manual.body.summaryMode, 'manual');
  const switched = await hit('state', { mode: 'auto' });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.summaryMode, 'auto');
});

test('长期记忆接口支持编辑加锁、逐条解锁和删除', async (t) => {
  const { call, hit } = await setup(t);
  const id = await addMemory(call, '长期接口测试：主人偏好乌龙茶。', '偏好乌龙茶');
  await call('memory_consolidate', { summary: `# 长期记忆\n\n## 偏好\n- 主人偏好茶。[${id}]` });
  const before = await hit('state', {});
  const updated = await hit('long-term', {
    action: 'update',
    text: `# 长期记忆\n\n## 偏好\n- 主人偏好乌龙茶。[${id}]`,
    expectedHash: before.body.summaryHash,
    protectChanged: true,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.ok, true);
  const afterUpdate = await hit('state', {});
  assert.equal(afterUpdate.body.longTermLocks.length, 1);
  const lockId = afterUpdate.body.longTermLocks[0].id;

  const unlocked = await hit('long-term', { action: 'unlock', id: lockId });
  assert.equal(unlocked.status, 200);
  const afterUnlock = await hit('state', {});
  assert.equal(afterUnlock.body.longTermLocks.length, 0);
  assert.match(afterUnlock.body.summaryText, /乌龙茶/);

  const second = await hit('long-term', {
    action: 'update',
    text: `# 长期记忆\n\n## 偏好\n- 主人偏好红茶。[${id}]`,
    expectedHash: afterUnlock.body.summaryHash,
    protectChanged: true,
  });
  assert.equal(second.status, 200);
  const afterSecond = await hit('state', {});
  const secondLock = afterSecond.body.longTermLocks[0].id;
  const forgotten = await hit('long-term', { action: 'forget', id: secondLock, reason: '接口测试删除' });
  assert.equal(forgotten.status, 200);
  const finalState = await hit('state', {});
  assert.equal(finalState.body.summaryText.includes('红茶'), false);
  assert.ok(finalState.body.longTermForgottenList.length >= 1);
});

test('修改历史返回稳定 rev 标识', async (t) => {
  const { call, hit } = await setup(t);
  const id = await addMemory(call, '接口 rev 测试：主人喜欢在周日整理记忆。', 'rev 测试');
  await hit('update', { id, summary: 'rev 新概述', reason: 'rev 测试' });
  const history = await hit('history', { id });
  assert.match(history.body.revisions[0].rev, /^rev-\d{6}$/);
  assert.equal(history.body.revisions[0].version, history.body.revisions[0].rev);
});
