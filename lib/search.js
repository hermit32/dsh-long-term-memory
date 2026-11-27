/**
 * 原始记忆检索：精确 ID、标签、关键词、中文字符 n-gram、相关性评分。
 * 纯函数，无 DSH 依赖。
 * @module dsh-memory-feiyu/search
 */
import { normalizeTags } from './text.js';

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const ASCII_RE = /[a-z0-9_]/;
const ASCII_TOKEN_RE = /^[a-z0-9_]+$/;

/**
 * 长查询只用双字及以上 n-gram 打分，避免“的”“不”等单字造成大量假匹配。
 * 单字查询仍保留单字匹配。
 */
function meaningfulQueryTokens(tokens, query) {
  const length = Array.from(String(query ?? '')).length;
  if (length <= 1) return tokens;
  const filtered = tokens.filter((token) => {
    if (ASCII_TOKEN_RE.test(token)) return token.length >= 2;
    return Array.from(token).length >= 2;
  });
  return filtered.length > 0 ? filtered : tokens;
}

function addCjkRun(run, output) {
  const chars = Array.from(run);
  for (const ch of chars) output.add(ch);
  for (let n = 2; n <= 3; n += 1) {
    for (let i = 0; i + n <= chars.length; i += 1) output.add(chars.slice(i, i + n).join(''));
  }
}

/**
 * 中英文混合分词。中文生成 1～3 字符 n-gram，英文按单词。
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const output = new Set();
  const value = String(text ?? '').toLowerCase();
  let cjk = '';
  let ascii = '';
  const flushCjk = () => {
    if (cjk) addCjkRun(cjk, output);
    cjk = '';
  };
  const flushAscii = () => {
    if (ascii) output.add(ascii);
    ascii = '';
  };
  for (const ch of value) {
    if (CJK_RE.test(ch)) {
      flushAscii();
      cjk += ch;
    } else if (ASCII_RE.test(ch)) {
      flushCjk();
      ascii += ch;
    } else {
      flushCjk();
      flushAscii();
    }
  }
  flushCjk();
  flushAscii();
  return [...output].slice(0, 120);
}

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 20) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function includesTag(tags, wanted) {
  const target = wanted.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === target);
}

/**
 * 对一条记忆评分。
 * @returns {number} 0 表示不相关。
 */
export function scoreEntry(entry, queryTokens, options = {}) {
  const summary = String(entry.summary ?? '').toLowerCase();
  const content = String(entry.content ?? '').toLowerCase();
  const tags = entry.tags ?? [];
  const tagsText = tags.join(' ').toLowerCase();
  const context = `${entry.source ?? ''} ${entry.context ?? ''}`.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (includesTag(tags, token)) score += 12;
    else if (tagsText.includes(token)) score += 6;

    const summaryHits = countOccurrences(summary, token);
    if (summaryHits > 0) score += 6 * Math.min(summaryHits, 3);

    const contentHits = countOccurrences(content, token);
    if (contentHits > 0) score += 2 * Math.min(contentHits, 5);

    if (context.includes(token)) score += 1;
  }

  const phrase = String(options.phrase ?? '').trim().toLowerCase();
  if (phrase.length > 1) {
    if (summary.includes(phrase)) score += 20;
    else if (content.includes(phrase)) score += 12;
    else if (tagsText.includes(phrase)) score += 16;
  }

  if (score > 0) score += Math.max(0, Math.min(3, entry.importance ?? 1)) * 2;
  return score;
}

/**
 * 检索记忆，返回带 score 的完整原始记录。
 * @param {Array<object>} entries
 * @param {{query?:string,id?:string,tags?:string|string[],limit?:number}} options
 */
export function searchMemories(entries, options = {}) {
  const limit = Math.max(1, Math.min(50, Number.parseInt(String(options.limit ?? 10), 10) || 10));
  const exactId = String(options.id ?? '').trim();
  if (exactId) {
    const found = entries.find((entry) => entry.id === exactId);
    return found ? [{ ...found, score: 100000 }] : [];
  }

  const tags = normalizeTags(options.tags);
  const query = String(options.query ?? '').trim();
  if (!query && tags.length === 0) return [];

  const filtered = tags.length === 0
    ? entries
    : entries.filter((entry) => tags.every((tag) => includesTag(entry.tags ?? [], tag)));

  const queryTokens = meaningfulQueryTokens(tokenize(query), query);
  const scored = [];
  for (const entry of filtered) {
    let score = 0;
    if (queryTokens.length > 0) {
      score = scoreEntry(entry, queryTokens, { phrase: query });
      if (score === 0) continue;
    } else {
      score = Math.max(1, Math.min(3, entry.importance ?? 1));
    }
    scored.push({ ...entry, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return scored.slice(0, limit);
}
