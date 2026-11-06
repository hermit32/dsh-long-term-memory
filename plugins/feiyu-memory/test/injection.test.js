import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshot,
  hasSnapshotMessage,
  shouldInjectSnapshot,
  lastSnapshotText,
  MEMORY_SOURCE_KIND,
} from '../lib/injection.js';

function snapshot(extra = {}) {
  return buildSnapshot({
    globalSummary: '全局：主人使用简体中文。',
    workspaceSummary: '工作区：大肥鱼记忆系统。',
    entries: [{
      id: 'mem-00000001',
      createdAt: '2026-11-05T23:10:00+08:00',
      tags: ['测试'],
      source: 'test',
      context: 'case=injection',
      summary: '第一条记忆',
      importance: 1,
      content: '第一条完整内容。',
      ...extra,
    }],
    contextWindow: 128000,
    config: { privateWorkspace: 'C:/PrivateWorkspace' },
  });
}

test('新会话首次注入包含摘要、完整索引和检索规则', () => {
  const snap = snapshot();
  for (const needle of [
    '## 全局摘要',
    '全局：主人使用简体中文。',
    '## 长期记忆',
    '工作区：大肥鱼记忆系统。',
    '## 短期记忆索引',
    'mem-00000001',
    '## 索引使用规则',
    'memory_search',
  ]) {
    assert.ok(snap.text.includes(needle), needle);
  }
});

test('新会话没有快照时需要注入', () => {
  const snap = snapshot();
  assert.equal(shouldInjectSnapshot([], snap.text), true);
  assert.equal(hasSnapshotMessage([], snap.text), false);
});

test('相同快照不重复注入', () => {
  const snap = snapshot();
  const messages = [{
    role: 'user',
    source: { kind: MEMORY_SOURCE_KIND, scope: 'workspace' },
    content: [{ type: 'text', text: snap.text }],
  }];
  assert.equal(hasSnapshotMessage(messages, snap.text), true);
  assert.equal(shouldInjectSnapshot(messages, snap.text), false);
});

test('记忆变化后生成新快照并注入', () => {
  const first = snapshot();
  const messages = [{
    role: 'user',
    source: { kind: MEMORY_SOURCE_KIND, scope: 'workspace' },
    content: [{ type: 'text', text: first.text }],
  }];
  const second = snapshot({
    id: 'mem-00000002',
    content: '第二条完整内容。',
    summary: '第二条记忆',
  });
  assert.notEqual(second.hash, first.hash);
  assert.equal(shouldInjectSnapshot(messages, second.text), true);
});

test('其他来源的相同文本不算已注入', () => {
  const snap = snapshot();
  const messages = [{
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: snap.text }],
  }];
  assert.equal(hasSnapshotMessage(messages, snap.text), false);
});

test('lastSnapshotText 返回最后一条记忆快照', () => {
  const first = snapshot();
  const second = snapshot({ id: 'mem-00000002', content: '更新内容', summary: '更新概述' });
  const messages = [
    { role: 'user', source: { kind: MEMORY_SOURCE_KIND }, content: [{ type: 'text', text: first.text }] },
    { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '收到' }] },
    { role: 'user', source: { kind: MEMORY_SOURCE_KIND }, content: [{ type: 'text', text: second.text }] },
  ];
  assert.equal(lastSnapshotText(messages), second.text);
});
