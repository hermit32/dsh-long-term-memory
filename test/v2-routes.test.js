import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPlugin, hitRoute, callTool, fakeAgent } from './v2-helpers.js';

test('/state 返回 v2 各层状态（浮动核心/命中/冷库/Dreaming/活跃度）', async (t) => {
  const { workspace, tools, routes } = await setupPlugin(t);
  const agent = fakeAgent({ cwd: workspace }).agent;
  await callTool(tools, 'memory_add', { content: '接口测试用记忆内容。', summary: '接口测试', tags: '接口' }, agent);

  const result = await hitRoute(routes, 'state', {});
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.version, '2.0.2');
  assert.ok(Array.isArray(result.body.active));
  assert.equal(result.body.active.length, 1);
  assert.ok(result.body.active[0].activity, '每条记忆都带活跃度');
  assert.match(result.body.active[0].activityLabel, /活跃度/);
  assert.equal(typeof result.body.usage.totalHits, 'number');
  assert.ok(result.body.core);
  assert.equal(result.body.core.maxItems, 10);
  assert.ok(Array.isArray(result.body.core.items));
  assert.ok(result.body.archive);
  assert.equal(typeof result.body.archive.total, 'number');
  assert.ok(result.body.dreaming);
  assert.equal(typeof result.body.dreaming.enabled, 'boolean');
  assert.equal(result.body.activity.halfLifeDays, 30);
  assert.equal(result.body.limits.coreMaxItems, 10);
});

test('/core：列表 / 修改 / 固定 / 历史 / 删除', async (t) => {
  const { workspace, tools, routes } = await setupPlugin(t);
  const agent = fakeAgent({ cwd: workspace }).agent;
  const first = await callTool(tools, 'memory_add', { content: '来源一：用户喜欢深夜整理笔记。', summary: '来源一', tags: '偏好' }, agent);
  const second = await callTool(tools, 'memory_add', { content: '来源二：用户默认看离线模式。', summary: '来源二', tags: '偏好' }, agent);
  const idA = /mem-[0-9a-f]{8}/.exec(first)[0];
  const idB = /mem-[0-9a-f]{8}/.exec(second)[0];

  const created = await hitRoute(routes, 'core', {
    action: 'update',
    id: 'fc-00000001',
    title: '习惯',
    body: `对方深夜整理笔记，默认离线模式。${idA} ${idB}`,
    sources: `${idA},${idB}`,
  });
  // 不存在时 update 会失败：说明接口真的走存储层校验。
  assert.equal(created.status, 400);

  const dummy = await callTool(tools, 'memory_core', {
    action: 'add',
    title: '习惯',
    body: '对方深夜整理笔记，默认离线模式。',
    sources: `${idA},${idB}`,
  }, agent);
  const coreId = /fc-[0-9a-f]{8}/.exec(dummy)[0];

  let list = await hitRoute(routes, 'core', { action: 'list' });
  assert.equal(list.body.core.items.length, 1);
  assert.equal(list.body.core.items[0].id, coreId);

  const pinned = await hitRoute(routes, 'core', { action: 'update', id: coreId, pinned: true });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.items[0].pinned, true);

  const edited = await hitRoute(routes, 'core', { action: 'update', id: coreId, body: '对方深夜整理笔记，默认离线模式，不喜欢被追问。' });
  assert.equal(edited.body.items[0].body.includes('不喜欢被追问'), true);

  const history = await hitRoute(routes, 'core', { action: 'history', id: coreId });
  assert.ok(history.body.history.length >= 2);
  const updateRecord = history.body.history.find((record) => record.op === 'update' && record.previous);
  const restored = await hitRoute(routes, 'core', { action: 'restore', id: coreId, seq: updateRecord.seq });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.items[0].body, '对方深夜整理笔记，默认离线模式。');

  const removed = await hitRoute(routes, 'core', { action: 'delete', id: coreId, reason: '接口测试' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.items.length, 0);
});

test('/archive：列表、搜索、恢复、手动归档', async (t) => {
  const { workspace, tools, routes } = await setupPlugin(t, { config: { maxActiveMemories: 1 } });
  const agent = fakeAgent({ cwd: workspace }).agent;
  const first = await callTool(tools, 'memory_add', { content: '旧内容：对方以前用 Excel 记账。', summary: '旧记账方式', tags: '经历' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(first)[0];
  const second = await callTool(tools, 'memory_add', { content: '新内容：现在用记忆系统。', summary: '新方式', tags: '项目' }, agent);
  const secondId = /mem-[0-9a-f]{8}/.exec(second)[0];

  const list = await hitRoute(routes, 'archive', { action: 'list' });
  assert.equal(list.body.total, 1);
  const archivedId = list.body.items[0].id;
  assert.ok([id, secondId].includes(archivedId), '冷库里应是被淘汰的那一条');
  assert.ok(list.body.items[0].archivedAt);

  const query = archivedId === id ? 'Excel' : '记忆系统';
  const search = await hitRoute(routes, 'archive', { action: 'list', query });
  assert.equal(search.body.items.length, 1);
  assert.equal(search.body.items[0].id, archivedId);

  const restored = await hitRoute(routes, 'archive', { action: 'restore', id: archivedId });
  assert.equal(restored.body.changed, true);
  // 容量上限 1 仍然生效：恢复后另一条被挤出活动区，冷库仍有 1 条。
  assert.equal(restored.body.overflowArchived, 1);
  assert.equal(restored.body.entryArchived, false);
  const afterRestore = await hitRoute(routes, 'archive', { action: 'list' });
  assert.equal(afterRestore.body.total, 1);
  assert.notEqual(afterRestore.body.items[0].id, archivedId);

  // 手动归档：把刚恢复的条目再搬回冷库。
  const demoted = await hitRoute(routes, 'archive', { action: 'demote', id: archivedId });
  assert.equal(demoted.body.archived, true);
  const afterDemote = await hitRoute(routes, 'archive', { action: 'list' });
  assert.ok(afterDemote.body.items.some((item) => item.id === archivedId));
});

test('/dream：状态查询可用；无模型路由时运行被跳过并给出原因', async (t) => {
  const { routes } = await setupPlugin(t, { config: { dreamingEnabled: true } });
  const status = await hitRoute(routes, 'dream', { action: 'status' });
  assert.equal(status.status, 200);
  assert.equal(status.body.dreaming.enabled, true);
  assert.ok(Array.isArray(status.body.core.items));

  const run = await hitRoute(routes, 'dream', { action: 'run', force: true });
  assert.equal(run.status, 200);
  assert.equal(run.body.skipped, true);
  assert.ok(['llm-unavailable', 'disabled', 'no-route'].includes(run.body.reason));
});

test('接口仍然要求 client 头与 owner 身份', async (t) => {
  const { routes } = await setupPlugin(t, { context: { connection: { admit: () => ({ rejection: 403 }) } } });
  const denied = await hitRoute(routes, 'core', { action: 'list' });
  assert.equal(denied.status, 403);

  const { routes: okRoutes } = await setupPlugin(t);
  const missingHeader = await hitRoute(okRoutes, 'state', {}, { headers: { 'x-dsh-memory-client': '' } });
  assert.equal(missingHeader.status, 403);
  assert.equal(missingHeader.body.error, 'client-required');
});
