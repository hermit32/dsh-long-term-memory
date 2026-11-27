import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, INDEX_RULES } from '../lib/injection.js';
import { byteLength, estimateTokens } from '../lib/text.js';

const ACTIVE = [
  { id: 'mem-00000001', createdAt: '2026-11-20T10:00:00+08:00', updatedAt: '2026-11-20T10:00:00+08:00', summary: '偏好', tags: ['偏好'], importance: 2, content: '对方默认看离线模式。' },
  { id: 'mem-00000002', createdAt: '2026-11-21T10:00:00+08:00', updatedAt: '2026-11-21T10:00:00+08:00', summary: '相处方式', tags: ['关系'], importance: 2, content: '对方讨厌被催。' },
];

const CORE = [
  { id: 'fc-00000001', title: '当前重点', body: '对方正在重建记忆系统，要求先备份再改生产。', sources: ['mem-00000001', 'mem-00000002'], createdAt: '', updatedAt: '' },
];

test('快照包含浮动核心记忆小节，并标注来源', () => {
  const snapshot = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '# 我记住的用户\n\n对方是一个会自己动手的人。',
    entries: ACTIVE,
    coreItems: CORE,
    contextWindow: 200000,
    config: { privateWorkspace: 'C:/demo/workspace' },
  });
  assert.match(snapshot.text, /## 浮动核心记忆/);
  assert.match(snapshot.text, /fc-00000001/);
  assert.match(snapshot.text, /来源 00000001,00000002/);
  assert.equal(snapshot.core.shown, 1);
  assert.ok(snapshot.core.bytes > 0);
});

test('浮动核心关闭时不注入', () => {
  const snapshot = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '',
    entries: ACTIVE,
    coreItems: CORE,
    contextWindow: 200000,
    config: { privateWorkspace: 'C:/demo/workspace', coreEnabled: false },
  });
  assert.equal(/^## 浮动核心记忆$/m.test(snapshot.text), false);
  assert.equal(snapshot.core.shown, 0);
});

test('与长期记忆重复的浮动核心在注入时被跳过', () => {
  const snapshot = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '## 对方是谁\n\n对方正在重建记忆系统，要求先备份再改生产。',
    entries: ACTIVE,
    coreItems: CORE,
    contextWindow: 200000,
    config: { privateWorkspace: 'C:/demo/workspace' },
  });
  assert.equal(snapshot.text.includes('fc-00000001'), false);
  assert.equal(snapshot.core.shown, 0);
  assert.equal(snapshot.core.skipped[0].reason, 'overlaps-long-term');
});

test('浮动核心注入不突破上下文预算：预算很小时先收缩核心与索引', () => {
  const coreItems = Array.from({ length: 10 }, (_, index) => ({
    id: `fc-000000${String(index + 1).padStart(2, '0')}`,
    title: `重点 ${index}`,
    body: `综合结论 ${index} `.repeat(20),
    sources: ['mem-00000001'],
    createdAt: '',
    updatedAt: '',
  }));
  // 正常预算：整体必须落在上下文预算内。
  const normal = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '摘要'.repeat(200),
    entries: ACTIVE,
    coreItems,
    contextWindow: 20000,
    config: { privateWorkspace: 'C:/demo/workspace' },
  });
  assert.ok(byteLength(normal.text) <= normal.contextBudget.bytes, `${byteLength(normal.text)} <= ${normal.contextBudget.bytes}`);
  assert.ok(estimateTokens(normal.text) <= normal.contextBudget.tokens);
  assert.ok(normal.core.shown > 0);

  // 极小预算：索引与浮动核心都被收缩，不会把固定文案之外的条目硬塞进去。
  const tiny = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '摘要'.repeat(200),
    entries: ACTIVE,
    coreItems,
    contextWindow: 4000,
    config: { privateWorkspace: 'C:/demo/workspace' },
  });
  assert.equal(tiny.index.shown, 0);
  assert.equal(tiny.core.shown, 0);
});

test('索引规则说明冷库与浮动核心的用法', () => {
  assert.match(INDEX_RULES, /memory_recall/);
  assert.match(INDEX_RULES, /冷库/);
  assert.match(INDEX_RULES, /浮动核心/);
});
