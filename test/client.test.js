import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const clientPath = path.join(import.meta.dirname, '..', 'lib', 'client.js');

async function loadClientModule(fetchImpl) {
  let loaded;
  const sandbox = {
    console,
    TextDecoder,
    TextEncoder,
    AbortController,
    fetch: fetchImpl ?? (async () => ({ ok: false, status: 401, json: async () => ({}) })),
    window: {
      __ModuleLoader__: {
        load(definition) {
          loaded = definition;
        },
      },
    },
  };
  const code = await readFile(clientPath, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: clientPath });
  assert.ok(loaded, 'client bundle must call __ModuleLoader__.load');
  return loaded;
}

function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
  };
}

function fakeContext(registrations) {
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: {}, writable: true, revision: 0 }),
    subscribe: () => () => {},
    mutate: async () => true,
  };
  const ctx = {
    effect(factory) {
      const cleanup = factory();
      return typeof cleanup === 'function' ? cleanup : () => {};
    },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    configForms: {
      get: (namespace) => {
        assert.equal(namespace, 'dsh-memory-feiyu');
        return scope;
      },
      whileServed: (namespaces, register) => {
        assert.deepEqual(Array.from(namespaces), ['dsh-memory-feiyu']);
        return register(new Set(namespaces));
      },
    },
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
    remote: {
      workspaceFiles: {
        readBytes: async (_sessionId, filePath) => {
          const files = {
            '.dsh/memories-feiyu/raw_memories.md': [
              '<!-- feiyu-raw v1 -->',
              '',
              '## mem-ef10732e',
              '- 创建: 2026-11-05T23:15:51+08:00',
              '- 标签: 项目, 重建',
              '- 概述: 完成从零重建',
              '- 正文:',
              '  正文内容',
              '',
              '## mem-11111111',
              '- 创建: 2026-11-06T08:00:00+08:00',
              '- 标签: 临时',
              '- 概述: 已被删除的条目',
              '- 重要度: 1',
              '- 状态: deleted',
              '- 删除于: 2026-11-06T09:00:00+08:00',
              '- 删除原因: 用户要求',
              '- 正文:',
              '  旧正文',
            ].join('\n'),
            '.dsh/memories-feiyu/memory_summary.md': '<!-- feiyu-summary v1 -->\n\n# 摘要\n- 条目',
            '.dsh/memories-feiyu/archive/raw_memories.md': '<!-- feiyu-archive v1 -->',
            '.dsh/memories-feiyu/journal.jsonl': '{"ts":"2026-11-05T15:15:51.338Z","op":"add","id":"mem-ef10732e"}',
          };
          return { data: new TextEncoder().encode(files[filePath] ?? '') };
        },
        list: async () => ({ entries: [{ name: '0001.md' }, { name: 'notes.txt' }] }),
      },
    },
  };
  return ctx;
}

test('客户端在 settings.section 注册“记忆”页', async () => {
  const definition = await loadClientModule();
  assert.equal(definition.id, 'dsh-memory-feiyu');
  const registrations = [];
  const exports = definition.factory((name) => {
    assert.equal(name, 'react');
    return fakeReact();
  });
  assert.deepEqual([...exports.inject].sort(), ['configForms', 'locale', 'remote', 'remote.workspaceFiles', 'sessions', 'slots']);
  exports.apply(fakeContext(registrations));
  assert.equal(registrations.length, 1);
  const { options, component } = registrations[0];
  assert.equal(options.name, 'settings.section');
  assert.equal(options.id, 'memory');
  assert.equal(options.order, 20);
  assert.equal(options.locale, 'settings.memory');
  assert.equal(typeof component, 'function');
  assert.equal(options.label(), 'nav');
});

test('客户端“记忆”页可以完成首次渲染', async () => {
  const definition = await loadClientModule();
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const { component, options } = registrations[0];
  const injected = options.inject();
  const tree = component({
    t: (key) => key,
    scope: injected.scope,
    loadMemory: async () => ({ active: [], archivedCount: 0, summaryBytes: 0, versions: 0, recent: [], indexEntries: [] }),
    useSessions: (selector) => selector({ byId: { s1: { retainedBy: { mainView: 1 } } } }),
    close: () => {},
  });
  assert.ok(tree);
  assert.equal(tree.type, 'div');
});

test('客户端状态读取解析活动、归档、摘要和版本', async () => {
  const definition = await loadClientModule();
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();
  assert.equal(typeof injected.loadMemory, 'function');
  const data = await injected.loadMemory('session-1', new AbortController().signal);
  assert.equal(data.active.length, 1);
  assert.equal(data.active[0].id, 'mem-ef10732e');
  assert.equal(data.active[0].tags, '项目, 重建');
  assert.equal(data.deleted.length, 1);
  assert.equal(data.deleted[0].id, 'mem-11111111');
  assert.equal(data.deleted[0].deleteReason, '用户要求');
  assert.deepEqual(data.versionNames, ['0001.md']);
  assert.equal(data.archivedCount, 0);
  assert.ok(data.summaryBytes > 0);
  assert.equal(data.versions, 1);
  assert.equal(data.recent[0].op, 'add');
});

test('客户端删除/恢复/回滚通过本机接口提交，并带客户端标记', async () => {
  const calls = [];
  const definition = await loadClientModule(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, version: '0002' }) };
  });
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();
  assert.equal(typeof injected.memoryAction, 'function');

  const forgetResult = await injected.memoryAction('forget', { id: 'mem-11111111', reason: '用户要求' });
  assert.equal(forgetResult.ok, true);
  assert.equal(calls[0].url, '/api/dsh-memory-feiyu/forget');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['x-dsh-memory-client'], 'dsh-memory-feiyu/1');
  assert.equal(JSON.parse(calls[0].options.body).id, 'mem-11111111');

  await injected.memoryAction('restore', { id: 'mem-11111111' });
  await injected.memoryAction('rollback', { version: '2' });
  assert.deepEqual(calls.map((call) => call.url), [
    '/api/dsh-memory-feiyu/forget',
    '/api/dsh-memory-feiyu/restore',
    '/api/dsh-memory-feiyu/rollback',
  ]);
});

test('优先使用 Host 端状态接口，不依赖会话工作目录', async () => {
  const definition = await loadClientModule(async (url) => {
    assert.equal(url, '/api/dsh-memory-feiyu/state');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        active: [{ id: 'mem-aaaaaaaa', createdAt: '2026-11-06T08:00:00+08:00', summary: '来自 Host', tags: ['t'], source: 's', context: 'c', importance: 2, status: 'active' }],
        deleted: [{ id: 'mem-bbbbbbbb', createdAt: '2026-11-06T07:00:00+08:00', summary: '已删除', tags: [], source: '', context: '', importance: 1, status: 'deleted', deletedAt: '2026-11-06T07:30:00+08:00', deleteReason: '测试' }],
        archivedCount: 2,
        summaryText: '<!-- feiyu-summary v1 -->\n\n# 摘要',
        summaryBytes: 44,
        versions: ['0001.md', '0002.md'],
        recent: [{ op: 'delete', id: 'mem-bbbbbbbb', ts: '2026-11-06T07:30:00.000Z' }],
      }),
    };
  });
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();
  const data = await injected.loadMemory(['session-1'], new AbortController().signal);
  assert.equal(data.source, undefined);
  assert.equal(data.sessionUsed, 'host');
  assert.equal(data.readEmpty, false);
  assert.equal(data.active[0].id, 'mem-aaaaaaaa');
  assert.equal(data.deleted[0].deleteReason, '测试');
  assert.equal(data.archivedCount, 2);
  assert.deepEqual(data.versionNames, ['0001.md', '0002.md']);
  assert.equal(data.summaryText.startsWith('# 摘要'), true);
  assert.equal(JSON.stringify(data.recent), JSON.stringify([{ op: 'delete', id: 'mem-bbbbbbbb', time: '07:30' }]));
});

test('Host 认证不可用时页面只读降级，不回退弱认证', async () => {
  const definition = await loadClientModule(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: 'auth-unavailable' }),
  }));
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();
  const data = await injected.loadMemory(['session-1'], new AbortController().signal);
  assert.equal(data.hostAuth, 'unavailable');
  assert.ok(data.active.length > 0);
  assert.equal(data.sessionUsed, 'session-1');
});

test('接口返回失败时抛出可读错误', async () => {
  const definition = await loadClientModule(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, error: '没有找到记忆 mem-99999999' }),
  }));
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();
  await assert.rejects(
    () => injected.memoryAction('forget', { id: 'mem-99999999' }),
    /没有找到记忆/,
  );
});

/* ------------------------------ v2.0 ------------------------------ */

test('v2 状态字段（浮动核心/命中/冷库/Dreaming/上限）来自 Host 并映射到页面', async () => {
  const definition = await loadClientModule(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      version: '2.0.0',
      active: [{
        id: 'mem-aaaaaaaa',
        createdAt: '2026-11-25T10:00:00+08:00',
        summary: '来自 Host',
        tags: ['t'],
        status: 'active',
        activity: { score: 912.5, hits: 3, lastActiveAt: '2026-11-25T02:00:00.000Z', ageDays: 0.2 },
        activityLabel: '活跃度 913 · 命中 3 · 今天',
      }],
      deleted: [],
      archivedCount: 4,
      archive: { total: 4, active: 4, deleted: 0, bytes: 2048 },
      summaryText: '# 摘要',
      summaryBytes: 12,
      versions: [],
      recent: [],
      core: {
        count: 2,
        maxItems: 10,
        bytes: 320,
        itemMaxBytes: 600,
        pinned: 1,
        sources: 4,
        tombstones: 0,
        errors: 0,
        maxBytes: 1600,
        enabled: true,
        items: [{ id: 'fc-00000001', title: '当前重点', body: '正文', sources: ['mem-aaaaaaaa'], pinned: true, updatedAt: '2026-11-25T02:00:00.000Z' }],
      },
      usage: { tracked: 12, totalHits: 40, todayHits: 5, activeToday: 3, lastHitAt: '2026-11-25T02:00:00.000Z', dailyHitCap: 5 },
      activity: { halfLifeDays: 30, dailyHitCap: 5, graceHours: 24 },
      dreaming: {
        enabled: true,
        available: true,
        running: false,
        due: { due: false, reason: 'unchanged' },
        lastRun: { runId: 'dream-1', status: 'ok', finishedAt: '2026-11-24T20:00:00.000Z' },
        recentRuns: [],
        runs: [{ runId: 'dream-1', status: 'ok', add: 1, update: 0, remove: 0, snapshotDir: 'dream/dream-1', finishedAt: '2026-11-24T20:00:00.000Z' }],
        counters: { runs: 1, added: 1, updated: 0, removed: 0, skipped: 0, failed: 0 },
      },
      limits: { maxActiveMemories: 200, rawArchiveMaxBytes: 300000, coreMaxItems: 10, coreMaxBytes: 1600, coreItemMaxBytes: 600, archiveRecallLimit: 20 },
    }),
  }));
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();
  const data = await injected.loadMemory(['session-1'], new AbortController().signal);
  assert.equal(data.active[0].activityLabel, '活跃度 913 · 命中 3 · 今天');
  assert.equal(data.core.items[0].id, 'fc-00000001');
  assert.equal(data.core.maxBytes, 1600);
  assert.equal(data.usage.todayHits, 5);
  assert.equal(data.archive.total, 4);
  assert.equal(data.dreaming.runs[0].runId, 'dream-1');
  assert.equal(data.dreaming.lastRun.status, 'ok');
  assert.equal(data.limits.coreMaxItems, 10);
  assert.equal(data.activity.halfLifeDays, 30);
});

test('浮动核心 / 冷库 / Dreaming 操作走各自接口', async () => {
  const calls = [];
  const definition = await loadClientModule(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, changed: true }) };
  });
  const registrations = [];
  const exports = definition.factory(() => fakeReact());
  exports.apply(fakeContext(registrations));
  const injected = registrations[0].options.inject();

  await injected.memoryAction('core', { action: 'update', id: 'fc-00000001', body: '新正文' });
  await injected.memoryAction('core', { action: 'history', id: 'fc-00000001' });
  await injected.memoryAction('archive', { action: 'list', query: '旧事' });
  await injected.memoryAction('archive', { action: 'restore', id: 'mem-aaaaaaaa' });
  await injected.memoryAction('dream', { action: 'run', force: true });
  await injected.memoryAction('dream', { action: 'revert', runId: 'dream-1' });

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/dsh-memory-feiyu/core',
    '/api/dsh-memory-feiyu/core',
    '/api/dsh-memory-feiyu/archive',
    '/api/dsh-memory-feiyu/archive',
    '/api/dsh-memory-feiyu/dream',
    '/api/dsh-memory-feiyu/dream',
  ]);
  assert.equal(JSON.parse(calls[0].options.body).action, 'update');
  assert.equal(JSON.parse(calls[2].options.body).query, '旧事');
  assert.equal(JSON.parse(calls[4].options.body).force, true);
});

test('设置页包含 v2 区块、命中排序与新增配置项', async () => {
  const source = await readFile(clientPath, 'utf8');
  for (const needle of [
    'coreSection',
    'archiveSection',
    'dreamingSection',
    'overviewSection',
    'sortActivity',
    'sortTime',
    'activityLabel',
    "key: 'coreMaxItems'",
    "key: 'coreMaxBytes'",
    "key: 'coreItemMaxBytes'",
    "key: 'usageHalfLifeDays'",
    "key: 'usageDailyHitCap'",
    "key: 'activityGraceHours'",
    "key: 'dreamingEnabled'",
    "key: 'dreamingIntervalHours'",
    "key: 'dreamingMinNewMemories'",
    "key: 'dreamingRunsPerDay'",
    "key: 'archiveRecallLimit'",
    "runAction('core'",
    "runAction('archive'",
    "runAction('dream'",
  ]) {
    assert.ok(source.includes(needle), needle);
  }
});
