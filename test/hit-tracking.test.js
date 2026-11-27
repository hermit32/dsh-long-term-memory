import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setupPlugin, fakeAgent, callTool, hitRoute, waitFor } from './v2-helpers.js';

async function usageWal(dir) {
  try {
    return await readFile(path.join(dir, 'memories', 'usage.jsonl'), 'utf8');
  } catch {
    return '';
  }
}

function hitsOf(wal, id) {
  return wal
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.op === 'hit' && record.id === id);
}

test('有效命中：工具检索 + 助手真的引用，才计一次', async (t) => {
  const { dir, workspace, tools, handlers, liveAgents } = await setupPlugin(t);
  const { agent, events } = fakeAgent({ cwd: workspace, id: 'session-1' });
  liveAgents.push(agent);

  const added = await callTool(tools, 'memory_add', { content: '用户喜欢在深夜整理笔记，默认离线模式。', summary: '偏好', tags: '偏好' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];

  const search = await callTool(tools, 'memory_search', { query: '离线模式' }, agent);
  assert.ok(search.includes(id));

  events.push({
    seq: 1,
    type: 'assistant/message',
    data: { turn: 1, message: { content: [{ type: 'text', text: `我记得（${id}）：默认看离线模式。` }] } },
  });
  await handlers.get('session/event')({ id: 'session-1', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 1 } });

  const wal = await waitFor(async () => {
    const text = await usageWal(dir);
    return hitsOf(text, id).length > 0 ? text : null;
  });
  assert.ok(wal, '应该记录一次有效命中');
  assert.equal(hitsOf(wal, id).length, 1);
  assert.equal(hitsOf(wal, id)[0].s, 'session-1');
});

test('只搜到但没引用：不算有效命中', async (t) => {
  const { dir, workspace, tools, handlers, liveAgents } = await setupPlugin(t);
  const { agent, events } = fakeAgent({ cwd: workspace, id: 'session-2' });
  liveAgents.push(agent);
  const added = await callTool(tools, 'memory_add', { content: '用户讨厌被催，任务要一次做完。', summary: '相处方式', tags: '关系' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  await callTool(tools, 'memory_search', { query: '被催' }, agent);

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '好的。' }] } } });
  await handlers.get('session/event')({ id: 'session-2', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(hitsOf(await usageWal(dir), id).length, 0);
});

test('自动注入与索引文本不产生命中', async (t) => {
  const { dir, workspace, tools, handlers, liveAgents } = await setupPlugin(t);
  const { agent, injected } = fakeAgent({ cwd: workspace, id: 'session-3' });
  liveAgents.push(agent);
  const added = await callTool(tools, 'memory_add', { content: '用户要求出图保持演示角色人设一致。', summary: '出图人设', tags: '出图' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];
  // 触发一次注入：注入消息里包含概述，但没有任何工具检索。
  await handlers.get('session/event')({ id: 'session-3', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(injected.length > 0);
  assert.equal(hitsOf(await usageWal(dir), id).length, 0);
});

test('同一会话同一轮重复引用只计一次；跨轮再计', async (t) => {
  const { dir, workspace, tools, handlers, liveAgents } = await setupPlugin(t);
  const { agent, events } = fakeAgent({ cwd: workspace, id: 'session-4' });
  liveAgents.push(agent);
  const added = await callTool(tools, 'memory_add', { content: '用户的边界：不给开单建议。', summary: '边界 开单建议', tags: '边界' }, agent);
  const id = /mem-[0-9a-f]{8}/.exec(added)[0];

  await callTool(tools, 'memory_search', { query: '开单建议' }, agent);
  await callTool(tools, 'memory_search', { query: '边界' }, agent);
  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: `${id} ${id} 不给开单建议。` }] } } });
  await handlers.get('session/event')({ id: 'session-4', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 1 } });

  await waitFor(async () => hitsOf(await usageWal(dir), id).length >= 1);
  assert.equal(hitsOf(await usageWal(dir), id).length, 1);

  await callTool(tools, 'memory_search', { query: '开单' }, agent);
  events.push({ seq: 2, type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: `再次确认 ${id}` }] } } });
  await handlers.get('session/event')({ id: 'session-4', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 2 } });
  await waitFor(async () => hitsOf(await usageWal(dir), id).length >= 2);
  assert.equal(hitsOf(await usageWal(dir), id).length, 2);
});

test('冷库回忆命中也进入统计，且不会把条目搬回短期记忆', async (t) => {
  const { dir, workspace, tools, handlers, liveAgents, routes } = await setupPlugin(t, {
    config: { maxActiveMemories: 1 },
  });
  const { agent, events } = fakeAgent({ cwd: workspace, id: 'session-5' });
  liveAgents.push(agent);
  await callTool(tools, 'memory_add', { content: '旧经历：对方以前用别的方式记事。', summary: '旧经历', tags: '经历' }, agent);
  await callTool(tools, 'memory_add', { content: '新记忆占位内容。', summary: '占位', tags: '占位' }, agent);

  const status = JSON.parse(await callTool(tools, 'memory_status', {}, agent));
  assert.equal(status.archivedCount, 1);

  const archive = await hitRoute(routes, 'archive', { action: 'list' });
  const archivedEntry = archive.body.items[0];
  const id = archivedEntry.id;
  const query = archivedEntry.content.includes('旧经历') ? '旧经历' : '占位内容';

  const recalled = await callTool(tools, 'memory_recall', { query }, agent);
  assert.ok(recalled.includes(id), recalled.slice(0, 200));
  assert.match(recalled, /冷库/);

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: `想起 ${id}` }] } } });
  await handlers.get('session/event')({ id: 'session-5', header: { cwd: workspace } }, { type: 'turn/end', data: { turn: 1 } });
  await waitFor(async () => hitsOf(await usageWal(dir), id).length >= 1);
  assert.equal(hitsOf(await usageWal(dir), id).length, 1);

  const after = JSON.parse(await callTool(tools, 'memory_status', {}, agent));
  assert.equal(after.archivedCount, 1, '回忆不等于恢复');
});
