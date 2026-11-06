#!/usr/bin/env node
/**
 * 安全修复 summary_history/index.json。
 *
 * 默认只读检查；加 --apply 才写入，并在写入前备份旧索引。
 * 用法：
 *   node scripts/repair-summary-index.mjs --memory-dir "X:\path\memories-feiyu" [--apply]
 */
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const memoryDir = arg('--memory-dir');
if (!memoryDir) {
  console.error('缺少 --memory-dir');
  process.exit(2);
}
const apply = process.argv.includes('--apply');
const store = new MemoryStore({ memoryDir: path.resolve(memoryDir) });
await store.init();
const before = await store.summaryIndexReport();
if (!apply) {
  console.log(JSON.stringify({ mode: 'check', memoryDir: store.memoryDir, ...before }, null, 2));
  process.exit(before.ok ? 0 : 1);
}
const result = await store.repairSummaryIndex({ apply: true });
console.log(JSON.stringify({ mode: 'apply', memoryDir: store.memoryDir, before, ...result }, null, 2));
