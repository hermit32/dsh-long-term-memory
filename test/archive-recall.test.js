import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import { buildSnapshot } from '../lib/injection.js';
import { planCurationBatches } from '../lib/curator.js';
import { makeTempDir, fixedNow, sequenceIds } from './helpers.js';

async function setup(t, options = {}) {
  const dir = await makeTempDir(t);
  const store = new MemoryStore({ memoryDir: pathJoin(dir), now: fixedNow(), idFactory: sequenceIds(), maxActiveMemories: 1, ...options });
  await store.init();
  return { dir, store };
}

function pathJoin(dir) {
  return `${dir}\\memories`;
}

test('冷库不参与默认搜索，只有显式包含或按需回忆才能看到', async (t) => {
  const { store } = await setup(t);
  const first = await store.add({ content: '旧偏好：默认看离线模式', summary: '离线模式偏好', tags: ['偏好'] });
  await store.add({ content: '新记忆：另一件事', summary: '另一件事', tags: ['其他'] });

  const archived = await store.listArchived();
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, first.id);
  assert.ok(archived[0].archivedAt, '归档时间应被记录');

  const plain = await store.search('离线模式');
  assert.equal(plain.length, 0, '默认搜索不应命中冷库');
  const withArchive = await store.search('离线模式', { includeArchived: true });
  assert.equal(withArchive.length, 1);
  assert.equal(withArchive[0].id, first.id);
});

test('memory_recall 的存储层：按需回忆冷库，只读不搬回', async (t) => {
  const { store } = await setup(t);
  const first = await store.add({ content: '旧经历：三年前养过一只猫', summary: '旧经历 猫', tags: ['经历'] });
  await store.add({ content: '当前状态：在写记忆系统', summary: '当前状态', tags: ['项目'] });

  const recalled = await store.recall('猫', { scope: 'archive' });
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].id, first.id);
  assert.equal(recalled[0].layer, 'archive');
  // 回忆不改变分层：仍在冷库，活动集合不变。
  assert.equal((await store.listActive()).length, 1);
  assert.equal((await store.listArchived()).length, 1);

  const all = await store.recall('记忆系统', { scope: 'all' });
  assert.equal(all.length, 1);
  assert.equal(all[0].layer, 'active');

  const activeOnly = await store.recall('猫', { scope: 'active' });
  assert.equal(activeOnly.length, 0);
});

test('回忆不会复活已删除条目；恢复仍然只能显式调用 restore', async (t) => {
  const { store } = await setup(t);
  const first = await store.add({ content: '被删除的旧事实内容', summary: '被删除的旧事实', tags: ['删除'] });
  await store.add({ content: '占位内容 A', summary: '占位 A', tags: ['占位'] });
  await store.forget(first.id, '测试删除');
  const recalled = await store.recall('被删除的旧事实', { scope: 'all' });
  assert.equal(recalled.length, 0);

  // 冷库里的删除条目仍然留在冷库（保留历史），但不会被 recall 带出来。
  const archivedDeleted = (await store.listArchived()).filter((entry) => entry.status === 'deleted');
  assert.equal(archivedDeleted.length, 1);
  assert.equal(archivedDeleted[0].id, first.id);
});

test('冷库条目可显式恢复回短期记忆，归档元数据被清除', async (t) => {
  const { store } = await setup(t);
  const first = await store.add({ content: '要恢复的旧记忆', summary: '旧记忆', tags: ['恢复'] });
  await store.add({ content: '占位内容 B', summary: '占位 B', tags: ['占位'] });
  assert.equal((await store.listArchived()).length, 1);

  const restored = await store.restore(first.id);
  assert.equal(restored.changed, true);
  assert.equal(restored.entry.archivedAt, '');
  assert.equal(restored.entryArchived, false, '刚恢复的条目不能被容量约束立刻搬回去');
  // 容量上限 1 仍然生效：恢复把另一条挤出活动区。
  const active = await store.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, first.id);
  assert.equal(restored.overflowArchived, 1);
  assert.equal((await store.listArchived()).length, 1);
  assert.ok(await store.search('要恢复的旧记忆'));
});

test('手动归档：活动记忆可以搬进冷库，之后默认搜索不到', async (t) => {
  const { store } = await setup(t, { maxActiveMemories: 200 });
  const entry = await store.add({ content: '手动归档的内容', summary: '手动归档', tags: ['归档'] });
  const result = await store.archiveActive(entry.id, 'manual-test');
  assert.equal(result.archived, true);
  assert.equal((await store.listActive()).length, 0);
  assert.equal((await store.search('手动归档的内容')).length, 0);
  assert.equal((await store.searchArchive('手动归档的内容')).length, 1);
});

test('注入快照只用活动记忆：冷库不会出现在索引里', async (t) => {
  const { store } = await setup(t);
  const archivedEntry = await store.add({ content: '冷库里的内容不应该被注入', summary: '冷库内容', tags: ['冷库'] });
  await store.add({ content: '活动记忆的内容', summary: '活动内容', tags: ['活动'] });
  const active = await store.listActive();
  const snapshot = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '',
    entries: active,
    contextWindow: 200000,
    config: { privateWorkspace: 'C:/demo/workspace' },
  });
  assert.equal(snapshot.text.includes('冷库内容'), false);
  assert.equal(snapshot.text.includes(archivedEntry.id), false);
  assert.equal(snapshot.text.includes('活动内容'), true);
});

test('自动整理扫描只看活跃记忆，冷库不进入 Curator 批次', async () => {
  const batches = planCurationBatches([
    {
      header: { id: 'session-1', cwd: 'C:\\demo\\workspace', createdAt: 1 },
      events: [
        { seq: 1, type: 'turn/start', data: { turn: 1 } },
        { seq: 2, type: 'user/message', data: { turn: 1, content: [{ type: 'text', text: '你好' }] } },
        { seq: 3, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '在' }] } } },
        { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    },
  ], {}, {});
  assert.equal(batches.batches.length, 1);
  // 批次里只包含对话回合，没有任何冷库/记忆对象。
  const serialized = JSON.stringify(batches);
  assert.equal(serialized.includes('archive'), false);
  assert.equal(serialized.includes('archivedAt'), false);
});
