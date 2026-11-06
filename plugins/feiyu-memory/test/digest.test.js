import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryDigest, countFullSnapshots, digestUsage, MEMORY_SOURCE_KIND } from '../lib/injection.js';
import { byteLength } from '../lib/text.js';

function entry(index) {
  const updatedAt = new Date(Date.UTC(2026, 10, 6, 0, 0, index)).toISOString();
  return {
    id: `mem-${String(index).padStart(8, '0')}`,
    createdAt: updatedAt,
    updatedAt,
    tags: ['测试'],
    summary: `第 ${index} 条短期记忆概述 ${'细节'.repeat(20)}`,
    importance: 1,
  };
}

test('精简更新严格受字节/条目预算限制并保留最新条目', () => {
  const entries = Array.from({ length: 300 }, (_, index) => entry(index + 1));
  const digest = buildMemoryDigest({
    summary: '# 长期记忆\n\n- 一条很长的长期记忆。'.repeat(50),
    entries,
    maxBytes: 2200,
    maxTokens: 600,
    summaryMaxBytes: 900,
    recentEntries: 50,
    config: { privateWorkspace: 'C:/PrivateWorkspace' },
  });
  assert.ok(digest.totalBytes <= 2200);
  assert.ok(digest.totalTokens <= 600);
  assert.match(digest.text, /精简/);
  assert.match(digest.text, /mem-00000300|mem-00000299|mem-00000298/);
});

test('完整快照计数不把 digest 算进去，digestUsage 单独统计', () => {
  const messages = [
    { role: 'user', source: { kind: MEMORY_SOURCE_KIND, form: 'snapshot' }, content: [{ type: 'text', text: 'full' }] },
    { role: 'user', source: { kind: MEMORY_SOURCE_KIND, form: 'digest', turn: 7 }, content: [{ type: 'text', text: 'digest one' }] },
    { role: 'user', source: { kind: MEMORY_SOURCE_KIND, form: 'digest', turn: 9 }, content: [{ type: 'text', text: 'digest two' }] },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'not memory' }] },
  ];
  assert.equal(countFullSnapshots(messages), 1);
  const usage = digestUsage(messages);
  assert.equal(usage.count, 2);
  assert.equal(usage.lastTurn, 9);
  assert.equal(usage.bytes, byteLength('digest one') + byteLength('digest two'));
});
