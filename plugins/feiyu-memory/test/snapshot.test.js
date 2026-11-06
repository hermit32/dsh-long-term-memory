import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { buildSnapshot } from '../lib/injection.js';
import { buildAutoSummary } from '../lib/feiyu.js';
import { makeTempDir, sequenceIds, fixedNow } from './helpers.js';

async function setup(t) {
  const dir = await makeTempDir(t);
  const store = new MemoryStore({
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    idFactory: sequenceIds(),
    now: fixedNow(),
  });
  await store.init();
  await store.add({ content: '主人确认使用新的记忆系统。', tags: '项目', summary: '确认新记忆系统' });
  await store.add({ content: '主人喜欢简洁的回复。', tags: '偏好', summary: '偏好简洁回复' });
  await store.writeSummary(buildAutoSummary(await store.listActive(), { maxBytes: 12000 }), { mode: 'auto' });
  return { dir, store };
}

function currentSnapshot(store, privateWorkspace = 'C:/PrivateWorkspace') {
  return store.readGlobalSummary().then(async (globalSummary) => buildSnapshot({
    globalSummary,
    workspaceSummary: await store.readSummary(),
    entries: await store.listActive(),
    contextWindow: 128000,
    config: { privateWorkspace },
  }));
}

test('同一数据重复生成的快照逐字节相同', async (t) => {
  const { store } = await setup(t);
  const first = await currentSnapshot(store);
  const second = await currentSnapshot(store);
  assert.equal(first.text, second.text);
  assert.equal(first.hash, second.hash);
  assert.equal(first.hash.length, 64);
});

test('重新打开记忆库后快照仍然稳定', async (t) => {
  const { store } = await setup(t);
  const before = await currentSnapshot(store);
  const reopened = new MemoryStore({ memoryDir: store.memoryDir, globalMemoryDir: store.globalMemoryDir });
  await reopened.init();
  const after = await currentSnapshot(reopened);
  assert.equal(after.hash, before.hash);
  assert.equal(after.text, before.text);
});

test('跨进程重新生成的内容完全一致', async (t) => {
  const { store } = await setup(t);
  const local = await currentSnapshot(store);
  const child = path.resolve(import.meta.dirname, '..', 'scripts', 'snapshot-child.mjs');
  const output = execFileSync(process.execPath, [child], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FEIYU_MEMORY_DIR: store.memoryDir,
      FEIYU_GLOBAL_DIR: store.globalMemoryDir,
      FEIYU_WORKSPACE: 'C:/PrivateWorkspace',
    },
  });
  const remote = JSON.parse(output);
  assert.equal(remote.hash, local.hash);
  assert.equal(remote.text, local.text);
});

test('快照不包含生成时间或随机信息', async (t) => {
  const { store } = await setup(t);
  const snap = await currentSnapshot(store);
  assert.equal(/生成于|generated at|随机/u.test(snap.text), false);
  assert.match(snap.text, /## 短期记忆索引/);
  assert.match(snap.text, /mem-00000001/);
  assert.match(snap.text, /## 索引使用规则/);
});
