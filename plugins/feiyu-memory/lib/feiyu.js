/**
 * 记忆整理、合并和策展。
 * - 自动摘要：把活动记忆的概述汇编成可读的长期摘要
 * - 策展预算：摘要 25% / 原始条目 50% / 对话 25%
 * - 原始条目按完整块取舍，绝不从中间切断
 * @module dsh-memory-feiyu/feiyu
 */
import { byteLength, estimateTokens, fitTextToBudget, oneLine } from './text.js';
import { compareEntriesAsc, renderEntry } from './store.js';

/** 默认策展分段比例。 */
export const CURATION_SPLIT = Object.freeze({
  summary: 0.25,
  raw: 0.5,
  conversation: 0.25,
});

/** 把 ISO 时间显示为 `YYYY-MM-DD HH:mm`。 */
export function displayTime(iso) {
  const value = String(iso ?? '');
  if (value.length >= 16) return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
  return value;
}

/**
 * 计算策展分段预算。原始条目和对话各自有独立下限。
 * @param {number} maxBytes
 * @returns {{summary:number,raw:number,conversation:number,total:number}}
 */
export function planCurationBudget(maxBytes) {
  const total = Math.max(0, Number(maxBytes) || 0);
  const summary = Math.floor(total * CURATION_SPLIT.summary);
  const raw = Math.floor(total * CURATION_SPLIT.raw);
  return { summary, raw, conversation: Math.max(0, total - summary - raw), total };
}

/**
 * 计算策展 token 分段预算；与字节预算使用同一比例。
 * @param {number} maxTokens
 */
export function planCurationTokenBudget(maxTokens) {
  const total = Math.max(0, Number(maxTokens) || 0);
  const summary = Math.floor(total * CURATION_SPLIT.summary);
  const raw = Math.floor(total * CURATION_SPLIT.raw);
  return { summary, raw, conversation: Math.max(0, total - summary - raw), total };
}

/**
 * 生成自动汇编摘要：按第一个标签分组，组内按时间稳定排序。
 * 如果摘要为空，说明还没有记忆。
 * @param {Array<object>} entries
 * @param {{maxBytes?:number,maxTokens?:number}} options
 */
export function buildAutoSummary(entries, options = {}) {
  const maxBytes = options.maxBytes ?? 12000;
  const maxTokens = options.maxTokens ?? Number.POSITIVE_INFINITY;
  if (!entries || entries.length === 0) return '';

  const groups = new Map();
  for (const entry of entries) {
    const tag = entry.tags?.[0] || '未分类';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(entry);
  }
  const groupNames = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const header = [
    '# 大肥鱼工作区长期记忆摘要（自动汇编）',
    '',
    '> 本摘要由活动原始记忆的概述汇编；完整事实与细节请用 memory_search 读取原始记录。',
  ].join('\n');
  const lines = [];
  for (const name of groupNames) {
    lines.push('', `## ${name}`);
    const items = groups.get(name).slice().sort(compareEntriesAsc);
    for (const entry of items) {
      lines.push(`- ${displayTime(entry.createdAt)} · ${entry.id} · ${oneLine(entry.summary, 80)}`);
    }
  }

  let text = `${header}\n${lines.join('\n')}`.trimEnd();
  if (byteLength(text) <= maxBytes && estimateTokens(text) <= maxTokens) return text;

  const kept = [];
  let omitted = 0;
  for (const line of lines) {
    const candidate = `${header}\n${[...kept, line].join('\n')}\n（其余记忆省略，请用 memory_search 检索）`;
    if (byteLength(candidate) > maxBytes || estimateTokens(candidate) > maxTokens) {
      omitted += 1;
    } else {
      kept.push(line);
    }
  }
  text = `${header}\n${kept.join('\n')}`.trimEnd();
  if (omitted > 0) text += `\n\n（省略 ${omitted} 行概述，完整记忆请用 memory_search 检索）`;
  return fitTextToBudget(text, { maxBytes, maxTokens, suffix: '\n（摘要因预算截断）' });
}

/**
 * 选取用于策展的原始条目。按重要度、时间、ID 稳定排序，只放完整块。
 * @param {Array<object>} entries
 * @param {{maxBytes?:number,maxTokens?:number,entriesShown?:number}} options
 */
export function curateEntries(entries, options = {}) {
  const maxBytes = options.maxBytes ?? 32000;
  const maxTokens = options.maxTokens ?? Number.POSITIVE_INFINITY;
  const entriesShown = Math.max(1, options.entriesShown ?? 80);
  const sorted = [...entries].sort((a, b) => {
    const importanceDiff = (b.importance ?? 1) - (a.importance ?? 1);
    if (importanceDiff !== 0) return importanceDiff;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const kept = [];
  const blocks = [];
  let omitted = 0;
  for (const entry of sorted) {
    if (kept.length >= entriesShown) {
      omitted += 1;
      continue;
    }
    const block = renderEntry(entry);
    const candidate = [...blocks, block].join('\n\n');
    if (byteLength(candidate) > maxBytes || estimateTokens(candidate) > maxTokens) {
      omitted += 1;
      continue;
    }
    blocks.push(block);
    kept.push(entry);
  }
  let text = blocks.join('\n\n');
  if (omitted > 0) text += `${text ? '\n\n' : ''}（另有 ${omitted} 条记忆未展示，请缩小检索范围）`;
  return {
    entries: kept,
    text,
    bytes: byteLength(text),
    tokens: estimateTokens(text),
    omitted,
  };
}

/**
 * 按 25% / 50% / 25% 组装策展上下文。
 * 摘要用不完的预算回填原始条目；原始条目用不完的预算回填摘要。
 * 对话永远不能挤占原始条目预算。
 * @param {{summary?:string,entries?:Array<object>,conversation?:string,maxBytes?:number,maxTokens?:number,entriesShown?:number}} input
 */
export function composeCurationContext(input = {}) {
  const maxBytes = input.maxBytes ?? 64000;
  const maxTokens = input.maxTokens ?? 2000;
  const budget = planCurationBudget(maxBytes);
  const tokenBudget = planCurationTokenBudget(maxTokens);
  const summaryText = fitTextToBudget(String(input.summary ?? '').trim(), {
    maxBytes: budget.summary,
    maxTokens: tokenBudget.summary,
    suffix: '\n（摘要因预算截断）',
  });
  const summaryBytes = byteLength(summaryText);

  // 摘要省下的预算回填给原始条目。
  const rawBudget = budget.raw + Math.max(0, budget.summary - summaryBytes);
  const rawTokenBudget = tokenBudget.raw + Math.max(0, tokenBudget.summary - estimateTokens(summaryText));
  const raw = curateEntries(input.entries ?? [], {
    maxBytes: rawBudget,
    maxTokens: rawTokenBudget,
    entriesShown: input.entriesShown ?? 80,
  });

  // 原始条目不足时，剩下的字节/token 空间回填摘要；对话固定 25% 上限。
  const rawUnused = Math.max(0, rawBudget - raw.bytes);
  const rawTokenUnused = Math.max(0, rawTokenBudget - raw.tokens);
  const summaryFinalBudget = budget.summary + rawUnused;
  const summaryFinalTokenBudget = tokenBudget.summary + rawTokenUnused;
  const summaryFinal = summaryText
    ? fitTextToBudget(summaryText, {
      maxBytes: summaryFinalBudget,
      maxTokens: summaryFinalTokenBudget,
      suffix: '\n（摘要因预算截断）',
    })
    : summaryText;

  const conversationText = fitTextToBudget(String(input.conversation ?? '').trim(), {
    maxBytes: budget.conversation,
    maxTokens: tokenBudget.conversation,
    suffix: '\n（对话因预算截断）',
  });

  const parts = [
    '## 长期记忆',
    summaryFinal || '（暂无长期记忆）',
    '',
    '## 短期记忆条目',
    raw.text || '（暂无短期条目）',
    '',
    '## 对话',
    conversationText || '（暂无对话）',
  ];
  return {
    text: parts.join('\n'),
    budget,
    summary: { budget: summaryFinalBudget, bytes: byteLength(summaryFinal), text: summaryFinal },
    raw: { budget: rawBudget, bytes: raw.bytes, entries: raw.entries, omitted: raw.omitted, text: raw.text },
    conversation: { budget: budget.conversation, bytes: byteLength(conversationText), text: conversationText },
    totalBytes: byteLength(parts.join('\n')),
  };
}

/**
 * 合并多组记忆，按 ID 去重，保留更新时间更晚的一条。
 * 不删除任何传入数组。
 * @param {...Array<object>} lists
 */
export function mergeEntries(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const entry of list ?? []) {
      const existing = merged.get(entry.id);
      if (!existing || String(entry.createdAt) > String(existing.createdAt)) merged.set(entry.id, entry);
    }
  }
  return [...merged.values()].sort(compareEntriesAsc);
}
