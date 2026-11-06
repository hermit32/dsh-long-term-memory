import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, searchMemories } from '../lib/search.js';

const entries = [
  {
    id: 'mem-00000001',
    createdAt: '2026-11-01T10:00:00+08:00',
    tags: ['项目', '记忆系统'],
    source: 'conversation',
    context: 'session=a',
    summary: '确认使用全新的长期记忆系统',
    importance: 2,
    content: '主人在 2026-11-01 确认：大肥鱼工作区使用全新的长期记忆系统，旧数据不导入。',
  },
  {
    id: 'mem-00000002',
    createdAt: '2026-11-02T11:00:00+08:00',
    tags: ['偏好', '回复'],
    source: 'conversation',
    context: 'session=b',
    summary: '主人喜欢简洁的微信式回复',
    importance: 1,
    content: '主人明确说过日常回复保持 30～45 个汉字，不要动不动长篇大论。',
  },
  {
    id: 'mem-00000003',
    createdAt: '2026-11-03T12:00:00+08:00',
    tags: ['项目', '插件'],
    source: 'file',
    context: 'README.md',
    summary: '记忆插件需要完整索引',
    importance: 3,
    content: 'dsh-memory-feiyu 必须提供常驻记忆索引，索引只显示目录，细节用 memory_search 读取。',
  },
];

test('中文 n-gram 分词包含单字、双字和三字', () => {
  const tokens = tokenize('记忆系统');
  for (const expected of ['记', '忆', '记忆', '系统', '记忆系', '忆系统']) {
    assert.ok(tokens.includes(expected), expected);
  }
});

test('精确 ID 检索返回完整原始记录', () => {
  const results = searchMemories(entries, { id: 'mem-00000002' });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'mem-00000002');
  assert.equal(results[0].score, 100000);
  assert.match(results[0].content, /30～45/);
});

test('标签检索要求全部标签匹配', () => {
  const results = searchMemories(entries, { tags: '项目,插件' });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'mem-00000003');
});

test('关键词与中文 n-gram 检索', () => {
  const byKeyword = searchMemories(entries, { query: '长期记忆' });
  assert.equal(byKeyword[0].id, 'mem-00000001');
  const byNgram = searchMemories(entries, { query: '索引' });
  assert.ok(byNgram.some((entry) => entry.id === 'mem-00000003'));
});

test('相关性排序稳定，且结果包含原始 ID', () => {
  const results = searchMemories(entries, { query: '记忆', limit: 10 });
  assert.ok(results.length >= 2);
  assert.ok(results.every((entry) => /^mem-[0-9a-f]{8}$/.test(entry.id)));
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score);
  }
  const repeated = searchMemories(entries, { query: '记忆', limit: 10 });
  assert.deepEqual(repeated.map((entry) => entry.id), results.map((entry) => entry.id));
});

test('空查询返回空数组，limit 生效', () => {
  assert.deepEqual(searchMemories(entries, {}), []);
  const results = searchMemories(entries, { query: '记忆', limit: 1 });
  assert.equal(results.length, 1);
});

test('无匹配时返回空数组', () => {
  assert.deepEqual(searchMemories(entries, { query: '完全不存在的外星词汇xyz' }), []);
});
