import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { MemoryStore } from '../lib/store.js';
import {
  lockSummaries,
  parseLockBlocks,
  validateLongTermSummary,
} from '../lib/summary.js';
import { makeTempDir, sequenceIds, fixedNow } from './helpers.js';

async function setup(t) {
  const dir = await makeTempDir(t);
  const store = new MemoryStore({
    memoryDir: path.join(dir, 'memories'),
    idFactory: sequenceIds(),
    now: fixedNow(),
  });
  await store.init();
  return { dir, store };
}

test('长期记忆锁定块可以解析、校验且逐字保护', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '主人偏好茶。', summary: '偏好茶', tags: '偏好' });
  const body = [
    '# 长期记忆',
    '',
    '## 偏好',
    '<!-- feiyu-lock:start id="lk-11111111" -->',
    '- 主人偏好茶。[mem-00000001]',
    '<!-- feiyu-lock:end -->',
    '',
    '- 另一条。[mem-00000001]',
  ].join('\n');
  await store.writeSummary(body, { mode: 'auto' });
  const meta = await store.summaryMeta();
  assert.equal(meta.locks.length, 1);
  assert.equal(meta.locks[0].id, 'lk-11111111');
  assert.match(meta.text, /主人偏好茶/);
  assert.throws(
    () => validateLongTermSummary('# 长期记忆\n\n- 被改写', {
      currentText: meta.text,
      allowNewLocks: false,
      allowEmpty: false,
    }),
    /锁定块|逐字/,
  );
});

test('用户编辑自动锁定改动段落，可逐条解锁而不是冻结整份长期记忆', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '主人偏好茶。', summary: '偏好茶', tags: '偏好' });
  await store.add({ content: '主人在周末整理记忆。', summary: '周末整理', tags: '习惯' });
  const first = [
    '# 长期记忆',
    '',
    '## 偏好',
    '- 主人偏好茶。[mem-00000001]',
    '',
    '## 习惯',
    '- 主人在周末整理记忆。[mem-00000002]',
  ].join('\n');
  await store.writeSummary(first, { mode: 'auto' });
  const before = await store.summaryMeta();
  const edited = first.replace('主人偏好茶。', '主人偏好乌龙茶。');
  const updated = await store.updateLongTerm({
    text: edited,
    expectedHash: before.hash,
    protectChanged: true,
    reason: '测试用户编辑',
  });
  const meta = await store.summaryMeta();
  assert.equal(meta.locks.length, 1);
  assert.match(meta.text, /feiyu-lock:start/);
  assert.match(meta.text, /乌龙茶/);
  assert.ok(updated.changed);

  const lockId = meta.locks[0].id;
  await store.unlockLongTermBlock(lockId);
  const unlocked = await store.summaryMeta();
  assert.equal(unlocked.locks.length, 0);
  assert.match(unlocked.text, /乌龙茶/);
});

test('删除短期记忆后，仅由它支持的长期 claim 被移除，其他 claim 保留', async (t) => {
  const { store } = await setup(t);
  const a = await store.add({ content: '只有 A 支持的事实。', summary: 'A 事实', tags: '测试' });
  const b = await store.add({ content: 'B 支持的另一事实。', summary: 'B 事实', tags: '测试' });
  const body = [
    '# 长期记忆',
    '',
    '## 测试',
    `- 只由 A 支持的 claim。[${a.id}]`,
    `- A 和 B 共同支持的 claim。[${a.id}, ${b.id}]`,
  ].join('\n');
  await store.writeSummary(body, { mode: 'auto' });
  await store.forget(a.id, '测试删除');
  const result = await store.scrubLongTermForDeleted([a]);
  assert.equal(result.removedLines, 1);
  const text = await store.readSummary();
  assert.equal(text.includes('只由 A 支持的 claim'), false);
  assert.match(text, /A 和 B 共同支持的 claim/);
  assert.match(text, new RegExp(b.id));
  assert.equal(text.includes(a.id), false);
  assert.ok(store.longTermForgotten().some((item) => item.text.includes('只由 A 支持的 claim')));
});

test('用户删除长期段落会进入遗忘清单，自动合成校验拒绝复活', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '主人偏好茶。', summary: '偏好茶', tags: '偏好' });
  await store.add({ content: '主人在周末整理记忆。', summary: '周末整理', tags: '习惯' });
  const body = [
    '# 长期记忆',
    '',
    '## 偏好',
    '- 主人偏好茶。[mem-00000001]',
    '',
    '## 习惯',
    '- 主人在周末整理记忆。[mem-00000002]',
  ].join('\n');
  await store.writeSummary(body, { mode: 'auto' });
  await store.forgetLongTermBlock({ text: '- 主人偏好茶。[mem-00000001]', reason: '测试删除长期' });
  const forgotten = store.longTermForgotten();
  assert.ok(forgotten.some((item) => item.text.includes('主人偏好茶')));
  assert.throws(
    () => validateLongTermSummary('# 长期记忆\n\n- 主人偏好茶。[mem-00000001]', {
      memories: [{ id: 'mem-00000001' }],
      forgotten,
      allowEmpty: false,
    }),
    /已删除|遗忘|重新引入/,
  );
});

test('summary_history 索引缺失时阻止写入，安全修复后恢复', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '索引修复测试事实。', summary: '索引修复', tags: '测试' });
  await store.writeSummary('# 长期\n\n- 第一版。[mem-00000001]', { mode: 'auto' });
  await store.writeSummary('# 长期\n\n- 第二版。[mem-00000001]', { mode: 'auto' });
  await store.writeSummary('# 长期\n\n- 第三版。[mem-00000001]', { mode: 'auto' });
  const indexFile = path.join(store.historyDir, 'index.json');
  const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  const latest = Object.keys(index.entries).sort().at(-1);
  await fs.writeFile(indexFile, JSON.stringify({ version: 1, maxVersion: index.maxVersion, entries: { [latest]: index.entries[latest] } }, null, 2), 'utf8');
  const broken = await store.summaryIndexReport();
  assert.equal(broken.ok, false);
  assert.ok(broken.missing.length > 0);
  await assert.rejects(
    () => store.writeSummary('# 长期\n\n- 第三版。[mem-00000001]', { mode: 'auto' }),
    /索引|repair-summary-index/,
  );
  const repaired = await store.repairSummaryIndex({ apply: true });
  assert.equal(repaired.ok, true);
  assert.ok(repaired.repairedVersions >= 1);
  const after = await store.writeSummary('# 长期\n\n- 第四版。[mem-00000001]', { mode: 'auto' });
  assert.equal(after.changed, true);
});

test('锁定块格式错误不会被写入', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '格式测试事实。', summary: '格式测试', tags: '测试' });
  const parsed = parseLockBlocks('<!-- feiyu-lock:start id="lk-22222222" -->\n- 没有结束');
  assert.equal(parsed.errors.length, 1);
  assert.equal(lockSummaries('<!-- feiyu-lock:start id="bad" -->\n- x\n<!-- feiyu-lock:end -->').length, 1);
  await assert.rejects(
    () => store.writeSummary('<!-- feiyu-lock:start id="lk-22222222" -->\n- 没有结束', { mode: 'auto' }),
    /锁定块|缺少/,
  );
});
