import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_CONFIG, normalizeConfig, resolveContextBudget } from '../lib/config.js';
import { buildSnapshot, renderIndex } from '../lib/injection.js';

const UNLIMITED = {
  ...DEFAULT_CONFIG,
  scopeMaxBytes: 0,
  scopeMaxTokens: 0,
  maxBytes: 0,
  globalMaxBytes: 0,
  indexMaxBytes: 0,
  indexMaxTokens: 0,
  coreMaxBytes: 0,
  contextBudgetRatio: 0,
  contextBudgetHardRatio: 0,
};

test('0 = 不限：总预算返回 Infinity，不再按窗口比例封顶', () => {
  const budget = resolveContextBudget(128000, UNLIMITED);
  assert.equal(budget.tokens, Number.POSITIVE_INFINITY);
  assert.equal(budget.bytes, Number.POSITIVE_INFINITY);
  assert.equal(budget.source, 'unlimited');
});

test('正数比例仍然按窗口计算', () => {
  const config = { ...DEFAULT_CONFIG, contextBudgetRatio: 0.08, contextBudgetHardRatio: 0.10 };
  const budget = resolveContextBudget(128000, config);
  assert.equal(budget.tokens, 10240);
  assert.equal(budget.source, 'model');
});

test('配置层接受 0（0 = 不限），不会因互斥校验拒绝', () => {
  const config = normalizeConfig({
    ...UNLIMITED,
    privateWorkspace: path.resolve('test-workspace'),
    memoryDir: path.resolve('test-workspace/mem'),
    globalMemoryDir: '',
  });
  assert.equal(config.coreMaxBytes, 0);
  assert.equal(config.contextBudgetRatio, 0);
});

test('长期、核心、索引都不再截断', () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: `mem-${String(index + 1).padStart(8, '0')}`,
    summary: `第 ${index} 条短期事实`,
    tags: ['测试'],
    createdAt: '2026-01-01T00:00:00+08:00',
    content: '内容',
  }));
  const summary = ['# 长期记忆', '', ...Array.from({ length: 200 }, (_, index) => `- 第 ${index} 条长期认知，写得长一点以便超过旧上限。`)].join('\n');
  const coreItems = Array.from({ length: 10 }, (_, index) => ({
    id: `fc-${String(index + 1).padStart(8, '0')}`,
    title: `核心 ${index}`,
    body: '内容'.repeat(60),
    sources: ['mem-00000001'],
    pinned: false,
  }));
  const snapshot = buildSnapshot({
    entries,
    workspaceSummary: summary,
    coreItems,
    config: UNLIMITED,
  });
  assert.equal(snapshot.index.shown, 120);
  assert.equal(snapshot.index.omitted, 0);
  assert.equal(snapshot.core.shown, 10);
  assert.equal(snapshot.core.omitted, 0);
  assert.match(snapshot.text, /第 199 条长期认知/);
});

test('renderIndex 在 Infinity 预算下返回全部条目', () => {
  const entries = Array.from({ length: 300 }, (_, index) => ({
    id: `mem-${String(index + 1).padStart(8, '0')}`,
    summary: `条目 ${index}`,
    tags: [],
    createdAt: '2026-01-01T00:00:00+08:00',
  }));
  const rendered = renderIndex(entries, { maxBytes: Number.POSITIVE_INFINITY, maxTokens: Number.POSITIVE_INFINITY });
  assert.equal(rendered.shown, 300);
  assert.equal(rendered.omitted, 0);
});
