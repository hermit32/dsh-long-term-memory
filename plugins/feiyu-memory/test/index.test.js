import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIndexLine, renderIndex, buildSnapshot } from '../lib/injection.js';
import { resolveContextBudget, normalizeConfig, DEFAULT_CONFIG } from '../lib/config.js';
import { estimateTokens } from '../lib/text.js';

function entry(index, overrides = {}) {
  return {
    id: `mem-${String(index).padStart(8, '0')}`,
    createdAt: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T10:00:00+08:00`,
    tags: ['测试', `组${index % 3}`],
    source: 'test',
    context: `case=${index}`,
    summary: `第 ${index} 条记忆的概述，用于索引稳定性测试`,
    importance: index % 4,
    content: `第 ${index} 条记忆的完整正文。`,
    ...overrides,
  };
}

test('索引格式包含完整 ID、日期、标签和概述', () => {
  const line = formatIndexLine(entry(1));
  assert.match(line, /^- mem-00000001 · 2026-11-0\d 10:00 · 测试, 组1 · 第 1 条记忆的概述/);
  assert.equal(line.includes('mem-00000001'), true);
});

test('索引稳定排序且相同数据生成完全相同的内容', () => {
  const entries = [entry(3), entry(1), entry(2)];
  const first = renderIndex(entries, { maxBytes: 40960, maxTokens: 12000 });
  const second = renderIndex([...entries].reverse(), { maxBytes: 40960, maxTokens: 12000 });
  assert.equal(first.text, second.text);
  const ids = first.text.split('\n').filter((line) => line.startsWith('- mem-')).map((line) => line.slice(2, 14));
  assert.deepEqual(ids, ['mem-00000001', 'mem-00000002', 'mem-00000003']);
});

test('预算充足时索引包含全部 200 条活动记忆', () => {
  const entries = Array.from({ length: 200 }, (_, i) => entry(i + 1));
  const result = renderIndex(entries, { maxBytes: 40960, maxTokens: 12000 });
  assert.equal(result.total, 200);
  assert.equal(result.shown, 200);
  assert.equal(result.omitted, 0);
  assert.ok(result.bytes <= 40960);
  for (const item of entries) {
    assert.ok(result.text.includes(item.id), item.id);
  }
});

test('超出预算时按完整行截断并显示省略数量', () => {
  const entries = Array.from({ length: 80 }, (_, i) => entry(i + 1, {
    summary: `这是一条很长的概述用于测试索引截断行为 ${'细节'.repeat(20)}`,
  }));
  const result = renderIndex(entries, { maxBytes: 900, maxTokens: 1000 });
  assert.ok(result.omitted > 0);
  assert.equal(result.total, 80);
  assert.equal(result.shown + result.omitted, 80);
  assert.ok(result.bytes <= 900);
  assert.match(result.text, new RegExp(`（省略 ${result.omitted} 条记忆`));
  for (const line of result.text.split('\n').filter((line) => line.startsWith('- mem-'))) {
    assert.match(line, /^- mem-[0-9a-f]{8} · .+ · .+ · .+$/);
  }
});

test('索引预算为 0 时不输出任何条目', () => {
  const result = renderIndex([entry(1), entry(2)], { maxBytes: 0, maxTokens: 0 });
  assert.equal(result.shown, 0);
  assert.equal(result.omitted, 2);
  assert.equal(result.text.includes('mem-00000001'), false);
});

test('上下文预算：8%、10% 硬上限与 8192 回退', () => {
  const model = resolveContextBudget(128000, DEFAULT_CONFIG);
  assert.equal(model.tokens, 10240);
  assert.equal(model.bytes, 40960);
  assert.equal(model.hardTokens, 12800);
  assert.equal(model.source, 'model');

  const fallback = resolveContextBudget(undefined, DEFAULT_CONFIG);
  assert.equal(fallback.tokens, 8192);
  assert.equal(fallback.bytes, 32768);
  assert.equal(fallback.source, 'fallback');

  const actualWindow = resolveContextBudget(1048576, DEFAULT_CONFIG);
  assert.equal(actualWindow.tokens, 83886);
  assert.equal(actualWindow.hardTokens, 104857);
  assert.equal(actualWindow.source, 'model');

  const tiny = resolveContextBudget(1000, DEFAULT_CONFIG);
  assert.equal(tiny.tokens, 80);
  assert.ok(tiny.tokens <= tiny.hardTokens);
});

test('配置校验拒绝摘要预算被挤占', () => {
  assert.throws(() => normalizeConfig({
    privateWorkspace: 'C:/PrivateWorkspace',
    memoryDir: 'C:/PrivateWorkspace/.dsh/memories-feiyu',
    maxBytes: 1000,
    scopeMaxBytes: 12000,
    globalMaxBytes: 2000,
  }), /maxBytes/);
});

test('快照总量不超过实际上下文预算', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry(i + 1));
  const snap = buildSnapshot({
    globalSummary: '全局摘要：主人偏好简体中文。',
    workspaceSummary: '工作区摘要：正在进行大肥鱼记忆系统重建。',
    entries,
    contextWindow: 128000,
    config: { privateWorkspace: 'C:/PrivateWorkspace' },
  });
  assert.ok(snap.totalBytes <= snap.contextBudget.bytes);
  assert.ok(snap.totalTokens <= snap.contextBudget.tokens);
  assert.equal(snap.contextBudget.tokens, 10240);
  assert.match(snap.text, /## 全局摘要/);
  assert.match(snap.text, /## 长期记忆/);
  assert.match(snap.text, /## 短期记忆索引/);
  assert.match(snap.text, /索引使用规则/);
});

test('全局摘要预算不会被工作区摘要挤掉', () => {
  const snap = buildSnapshot({
    globalSummary: '全局摘要关键句：这条必须保留。',
    workspaceSummary: `工作区摘要：${'工'.repeat(30000)}`,
    entries: [],
    contextWindow: 128000,
    config: { privateWorkspace: 'C:/PrivateWorkspace' },
  });
  assert.match(snap.text, /全局摘要关键句：这条必须保留。/);
  assert.ok(snap.summaries.globalBytes > 0);
  assert.ok(snap.summaries.totalBytes <= 14000);
  assert.match(snap.text, /长期记忆因预算截断/);
});

test('窗口很小时索引按预算截断，整体不超预算', () => {
  const entries = Array.from({ length: 200 }, (_, i) => entry(i + 1));
  const snap = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '',
    entries,
    contextWindow: 16000,
    config: { privateWorkspace: 'C:/PrivateWorkspace' },
  });
  assert.equal(snap.contextBudget.tokens, 1280);
  assert.ok(snap.totalBytes <= snap.contextBudget.bytes);
  assert.ok(snap.totalTokens <= snap.contextBudget.tokens);
  assert.ok(snap.index.omitted > 0);
  assert.match(snap.text, new RegExp(`（省略 ${snap.index.omitted} 条记忆`));
});

test('无法读取窗口时使用 8192 tokens 回退', () => {
  const snap = buildSnapshot({
    workspaceSummary: '',
    entries: [entry(1)],
    contextWindow: undefined,
    config: { privateWorkspace: 'C:/PrivateWorkspace' },
  });
  assert.equal(snap.contextBudget.tokens, 8192);
  assert.equal(snap.contextBudget.source, 'fallback');
  assert.ok(snap.totalBytes <= 32768);
  assert.ok(snap.totalTokens <= 8192);
  assert.ok(estimateTokens(snap.text) <= 8192);
});
