#!/usr/bin/env node
/**
 * 长记忆真实模型预览/应用工具（默认不写记忆）。
 *
 * 1) 生成 prompt：
 *    node scripts/preview-long-term.mjs --memory-dir <copy> --prompt-out prompt.json
 * 2) 校验模型返回：
 *    node scripts/preview-long-term.mjs --memory-dir <copy> --response output.md
 * 3) 在副本上应用（必须显式 --apply）：
 *    node scripts/preview-long-term.mjs --memory-dir <copy> --response output.md --apply
 *
 * 不要对生产记忆目录使用 --apply，除非已完成备份和审批。
 */
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { buildLongTermInput } from '../lib/curator.js';
import { sha256, validateLongTermSummary } from '../lib/summary.js';
import { byteLength, estimateTokens } from '../lib/text.js';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const memoryDir = arg('--memory-dir');
if (!memoryDir) {
  console.error('缺少 --memory-dir');
  process.exit(2);
}
const promptOut = arg('--prompt-out');
const responsePath = arg('--response');
const apply = process.argv.includes('--apply');
const store = new MemoryStore({ memoryDir: path.resolve(memoryDir) });
await store.init();
const [summary, active, deleted] = await Promise.all([store.readSummary(), store.listActive(), store.listDeleted()]);
const input = buildLongTermInput({
  currentSummary: summary,
  changedEntries: active,
  allEntries: active,
  deletedEntries: deleted,
  forgotten: store.longTermForgotten(),
});
if (promptOut) {
  fs.writeFileSync(path.resolve(promptOut), `${JSON.stringify({ system: input.system, text: input.text }, null, 2)}\n`, 'utf8');
}
if (!responsePath) {
  console.log(JSON.stringify({
    mode: 'prompt',
    memoryDir: store.memoryDir,
    active: active.length,
    deleted: deleted.length,
    promptBytes: input.bytes,
    promptTokens: input.tokens,
    promptOut: promptOut || null,
  }, null, 2));
  process.exit(0);
}
const body = fs.readFileSync(path.resolve(responsePath), 'utf8').trim();
const beforeRaw = sha256(fs.readFileSync(store.rawFile, 'utf8'));
const checked = validateLongTermSummary(body, {
  currentText: summary,
  allowNewLocks: false,
  allowEmpty: false,
  maxBytes: 12000,
  maxTokens: 4000,
  memories: active,
  forgotten: store.longTermForgotten(),
});
const report = {
  mode: apply ? 'apply' : 'validate',
  memoryDir: store.memoryDir,
  bytes: byteLength(checked.text),
  tokens: estimateTokens(checked.text),
  citations: [...new Set(checked.text.match(/mem-[0-9a-f]{8}/g) ?? [])],
  locks: checked.locks.length,
  apply: false,
};
if (apply) {
  const result = await store.writeSummary(checked.text, {
    mode: 'auto',
    expectedHash: sha256(summary),
    reason: 'real-model-preview',
    source: 'curator',
  });
  const afterRaw = sha256(fs.readFileSync(store.rawFile, 'utf8'));
  const meta = await store.summaryMeta();
  report.apply = true;
  report.changed = result.changed;
  report.summaryVersion = meta.summaryVersion;
  report.rawUnchanged = beforeRaw === afterRaw;
}
console.log(JSON.stringify(report, null, 2));
