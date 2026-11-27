/**
 * UTF-8 文本工具：字节、token 估算、稳定截断。
 * 本模块不依赖任何 DSH 包，便于 node --test 直接测试。
 * @module dsh-memory-feiyu/text
 */
import { createHash } from 'node:crypto';

/** 返回 UTF-8 字节数。 */
export function byteLength(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8');
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
const ASCII_WORD_RE = /[A-Za-z0-9_]/;

/**
 * 估算文本 token 数。中文按 1 字 1 token，ASCII 按 4 字符 1 token，
 * 空白和标点按 0.25～0.5 token 计。结果向上取整。
 * 估算偏保守，绝不主动超过真实预算。
 */
export function estimateTokens(text) {
  let total = 0;
  for (const ch of String(text ?? '')) {
    if (CJK_RE.test(ch)) total += 1;
    else if (ASCII_WORD_RE.test(ch)) total += 0.25;
    else if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') total += 0.25;
    else total += 0.5;
  }
  return Math.ceil(total);
}

/** 把多行文本压成一行，超过 maxChars 个字符时加省略号。 */
export function oneLine(text, maxChars = 80) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

/** 规范化标签：支持数组或逗号分隔字符串。 */
export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '').split(/[,，、;；]/);
  const tags = [];
  for (const item of raw) {
    const tag = oneLine(item, 24).replace(/[·]/g, '/');
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

/** 按 UTF-8 字节安全截断，不产生半个字符。 */
export function truncateUtf8(text, maxBytes, suffix = '') {
  const value = String(text ?? '');
  const max = Math.max(0, Number(maxBytes) || 0);
  if (byteLength(value) <= max) return value;
  const tail = String(suffix ?? '');
  const budget = Math.max(0, max - byteLength(tail));
  if (budget <= 0) return truncateUtf8(tail, max);
  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const size = byteLength(chars.slice(0, mid).join(''));
    if (size <= budget) low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, low).join('')}${tail}`;
}

/**
 * 在字节和 token 双预算内截断文本，优先保留完整行。
 * @param {string} text
 * @param {{maxBytes:number,maxTokens?:number,suffix?:string}} options
 */
export function fitTextToBudget(text, options) {
  const value = String(text ?? '');
  const maxBytes = Math.max(0, options.maxBytes ?? 0);
  const maxTokens = options.maxTokens ?? Number.POSITIVE_INFINITY;
  const suffix = options.suffix ?? '\n（摘要因预算截断）';
  if (byteLength(value) <= maxBytes && estimateTokens(value) <= maxTokens) return value;

  let cut = truncateUtf8(value, Math.max(0, maxBytes - byteLength(suffix)), '');
  if (cut.length > 0 && cut.length < value.length) {
    const lastNewline = cut.lastIndexOf('\n');
    if (lastNewline > 0) cut = cut.slice(0, lastNewline);
  }
  let result = `${cut}${suffix}`;
  while (result.length > 0 && (byteLength(result) > maxBytes || estimateTokens(result) > maxTokens)) {
    if (cut.length === 0) break;
    cut = cut.slice(0, Math.max(0, cut.length - 16));
    result = `${cut}${suffix}`;
  }
  return result;
}

/** 计算文本的 sha256；用于快照去重，不使用随机数。 */
export function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}
