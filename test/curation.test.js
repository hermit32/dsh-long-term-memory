import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planCurationBudget,
  composeCurationContext,
  curateEntries,
  mergeEntries,
} from '../lib/feiyu.js';

function entry(index, contentSize = 100) {
  return {
    id: `mem-${String(index).padStart(8, '0')}`,
    createdAt: `2026-11-05T${String(10 + (index % 10)).padStart(2, '0')}:00:00+08:00`,
    tags: ['策展'],
    source: 'test',
    context: 'case=curation',
    summary: `第 ${index} 条概述`,
    importance: index % 4,
    content: `第 ${index} 条完整内容：${'细'.repeat(contentSize)}`,
  };
}

test('策展预算严格按 25% / 50% / 25% 分段', () => {
  assert.deepEqual(planCurationBudget(64000), {
    summary: 16000,
    raw: 32000,
    conversation: 16000,
    total: 64000,
  });
});

test('摘要省下的预算回填原始条目，而不是对话', () => {
  const result = composeCurationContext({
    summary: '',
    entries: [entry(1, 1000)],
    conversation: '对话'.repeat(2000),
    maxBytes: 64000,
    maxTokens: 2000,
  });
  assert.equal(result.budget.summary, 16000);
  assert.equal(result.budget.conversation, 16000);
  assert.equal(result.raw.budget, 48000);
  assert.equal(result.conversation.budget, 16000);
});

test('对话不能挤掉原始记忆条目', () => {
  const entries = Array.from({ length: 80 }, (_, i) => entry(i + 1, 500));
  const result = composeCurationContext({
    summary: '一份不算短的摘要。'.repeat(500),
    entries,
    conversation: '很长的对话。'.repeat(5000),
    maxBytes: 64000,
    maxTokens: 2000,
  });
  assert.ok(result.raw.budget >= result.budget.raw);
  assert.equal(result.conversation.bytes <= 16000, true);
  assert.ok(result.raw.bytes > 0);
  assert.ok(result.raw.bytes <= result.raw.budget);
  assert.ok(result.totalBytes <= 64000 + 1000);
});

test('原始条目按完整块取舍，不切断正文', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry(i + 1, 300));
  const curated = curateEntries(entries, { maxBytes: 2500, maxTokens: 100000, entriesShown: 80 });
  assert.ok(curated.entries.length > 0);
  for (const kept of curated.entries) {
    assert.match(curated.text, new RegExp(`## ${kept.id}`));
    assert.equal(curated.text.includes(kept.content), true);
  }
  assert.ok(curated.omitted > 0);
});

test('合并记忆按 ID 去重并保留较新的记录', () => {
  const old = entry(1);
  const fresh = { ...entry(1), createdAt: '2026-11-06T10:00:00+08:00', content: '更新后的内容' };
  const merged = mergeEntries([old, entry(2)], [fresh]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === old.id)?.content, '更新后的内容');
});
