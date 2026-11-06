/**
 * 记忆索引、上下文预算和新会话注入快照。
 * 快照只由文件内容和固定配置生成，不含生成时间、随机数或进程内状态。
 * @module dsh-memory-feiyu/injection
 */
import { DEFAULT_CONFIG, resolveContextBudget } from './config.js';
import { compareEntriesAsc, contentFingerprint, renderEntry } from './store.js';
import { estimateTokens, byteLength, fitTextToBudget, oneLine, sha256 } from './text.js';
import { displayTime } from './feiyu.js';

export const MEMORY_SOURCE_KIND = 'feiyu-memory';
export const INDEX_HEADER = '## 短期记忆索引';

export const INDEX_RULES = [
  '## 索引使用规则',
  '',
  '1. 长期记忆是 AI 综合出的主人认知；短期记忆索引只是事实目录，不是全文。',
  '2. 涉及具体事件、时间、原话、背景和细节时，必须调用 `memory_search` 读取短期记忆原文。',
  '3. 引用记忆时保留原始记忆 ID（`mem-xxxxxxxx`），不得改写或截断。',
  '4. 密码、令牌、密钥等秘密信息不进入记忆。',
  '5. 固定人设来自 `AGENTS.md` / `大肥鱼人设.md`，不属于聊天记忆，不参与摘要压缩。',
  '6. 记忆与当前对话冲突时，以主人最新指示和当前事实为准。',
].join('\n');

function sanitizeFrame(text) {
  return String(text ?? '').replaceAll('</system-reminder>', '&lt;/system-reminder&gt;');
}

/** 单条索引行。ID 永远完整输出，只有概述可能被压成一行。 */
export function formatIndexLine(entry) {
  const tags = entry.tags && entry.tags.length > 0 ? entry.tags.join(', ') : '无标签';
  const summary = oneLine(entry.summary, 80) || '（无概述）';
  return `- ${entry.id} · ${displayTime(entry.createdAt)} · ${tags} · ${sanitizeFrame(summary)}`;
}

function fits(text, maxBytes, maxTokens) {
  return byteLength(text) <= maxBytes && estimateTokens(text) <= maxTokens;
}

/**
 * 渲染活动记忆索引。超出预算时按完整行截断，并显示省略数量。
 * @param {Array<object>} entries
 * @param {{maxBytes?:number,maxTokens?:number}} options
 */
export function renderIndex(entries, options = {}) {
  const maxBytes = Math.max(0, options.maxBytes ?? 40960);
  const maxTokens = Math.max(0, options.maxTokens ?? 12000);
  const sorted = [...entries].sort(compareEntriesAsc);
  if (maxBytes === 0 || maxTokens === 0) {
    return {
      text: `${INDEX_HEADER}\n（索引预算为 0，未注入条目）`,
      total: sorted.length,
      shown: 0,
      omitted: sorted.length,
      bytes: byteLength(`${INDEX_HEADER}\n（索引预算为 0，未注入条目）`),
      tokens: 0,
    };
  }
  if (sorted.length === 0) {
    const text = `${INDEX_HEADER}\n（暂无活动记忆）`;
    return { text, total: 0, shown: 0, omitted: 0, bytes: byteLength(text), tokens: estimateTokens(text) };
  }

  const lines = sorted.map(formatIndexLine);
  const all = `${INDEX_HEADER}\n${lines.join('\n')}`;
  if (fits(all, maxBytes, maxTokens)) {
    return {
      text: all,
      total: sorted.length,
      shown: sorted.length,
      omitted: 0,
      bytes: byteLength(all),
      tokens: estimateTokens(all),
    };
  }

  const withOmitted = (shown) => {
    const omitted = sorted.length - shown;
    const body = lines.slice(0, shown).join('\n');
    const footer = omitted > 0 ? `（省略 ${omitted} 条记忆，使用 memory_search 检索）` : '';
    const text = [INDEX_HEADER, body, footer].filter((part) => part !== '').join('\n');
    return { text, omitted, shown };
  };

  let low = 0;
  let high = sorted.length;
  let best = withOmitted(0);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = withOmitted(mid);
    if (fits(candidate.text, maxBytes, maxTokens)) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return {
    text: best.text,
    total: sorted.length,
    shown: best.shown,
    omitted: best.omitted,
    bytes: byteLength(best.text),
    tokens: estimateTokens(best.text),
  };
}

function introText(config) {
  return [
    '<system-reminder>',
    '## 长期记忆快照（大肥鱼工作区）',
    '',
    `本快照由 dsh-memory-feiyu 提供，只在 \`${config.privateWorkspace ?? ''}\` 工作区生效。记忆未变化时不会重复注入；记忆更新后会追加新的稳定快照。`,
    '**本消息是截至当前的最新完整快照。同一来源的更早消息都是历史快照，可能包含已被删除或已被更正的旧内容；如与最新快照冲突，以本消息为准。**',
    '长会话中完整快照可能被精简更新替代；涉及具体事实时仍应调用 `memory_search` 读取短期记忆原文。',
    '固定人设不在此快照中，详见 `AGENTS.md` 与 `大肥鱼人设.md`。',
  ].join('\n');
}

/**
 * 生成新会话第一轮使用的记忆快照。
 * 预算优先级：全局摘要（保留 2000B）→ 工作区摘要 → 索引。
 * @param {{
 *   globalSummary?: string,
 *   workspaceSummary?: string,
 *   entries?: Array<object>,
 *   contextWindow?: number,
 *   config?: Record<string, unknown>
 * }} input
 */
export function buildSnapshot(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
  const budget = resolveContextBudget(input.contextWindow, config);
  const totalBytes = Math.max(0, budget.bytes);
  const totalTokens = Math.max(0, budget.tokens);
  const globalSummary = sanitizeFrame(String(input.globalSummary ?? '').trim());
  const workspaceSummary = sanitizeFrame(String(input.workspaceSummary ?? '').trim());
  const entries = Array.isArray(input.entries) ? input.entries : [];

  // 摘要总预算不超过 maxBytes；为索引和规则预留至少 1200 字节。
  const summaryCap = Math.max(0, Math.min(config.maxBytes, totalBytes - Math.min(1200, totalBytes)));
  const globalSectionBudget = Math.min(config.globalMaxBytes, summaryCap);
  const globalText = globalSummary
    ? fitTextToBudget(globalSummary, {
      maxBytes: Math.max(0, globalSectionBudget - 32),
      maxTokens: Math.max(1, totalTokens),
      suffix: '\n（全局摘要因预算截断）',
    })
    : '';
  const globalSection = `## 全局摘要\n${globalText || '（暂无全局摘要）'}`;

  const workspaceBudget = Math.max(0, Math.min(config.scopeMaxBytes, summaryCap - byteLength(globalSection) - 4));
  const workspaceText = workspaceSummary
    ? fitTextToBudget(workspaceSummary, {
      maxBytes: Math.max(0, workspaceBudget - 32),
      maxTokens: Math.max(1, totalTokens),
      suffix: '\n（长期记忆因预算截断）',
    })
    : '';
  const workspaceSection = `## 长期记忆\n${workspaceText || '（暂无长期记忆）'}`;

  const head = `${introText(config)}\n\n${globalSection}\n\n${workspaceSection}\n\n`;
  const tail = `\n\n${INDEX_RULES}\n</system-reminder>`;

  const fixedTokens = estimateTokens(head) + estimateTokens(tail);
  let indexBudgetBytes = Math.max(0, Math.min(config.injectIndex ? config.indexMaxBytes : 0, totalBytes - byteLength(head) - byteLength(tail)));
  let indexBudgetTokens = Math.max(0, Math.min(config.injectIndex ? config.indexMaxTokens : 0, totalTokens - fixedTokens));
  let index = renderIndex(config.injectIndex ? entries : [], {
    maxBytes: indexBudgetBytes,
    maxTokens: indexBudgetTokens,
  });
  let text = `${head}${index.text}${tail}`;

  // 双预算兜底：索引已经按预算渲染；若固定文案或估算误差导致整体超出，继续收缩索引。
  let guard = 0;
  while ((byteLength(text) > totalBytes || estimateTokens(text) > totalTokens) && indexBudgetBytes > 0 && guard < 100) {
    guard += 1;
    indexBudgetBytes = Math.max(0, indexBudgetBytes - Math.max(256, Math.floor(indexBudgetBytes / 8)));
    indexBudgetTokens = Math.max(0, indexBudgetTokens - 64);
    index = renderIndex(entries, { maxBytes: indexBudgetBytes, maxTokens: indexBudgetTokens });
    text = `${head}${index.text}${tail}`;
  }

  return {
    text,
    hash: sha256(text),
    contextBudget: budget,
    totalBytes: byteLength(text),
    totalTokens: estimateTokens(text),
    summaries: {
      globalBytes: byteLength(globalText),
      workspaceBytes: byteLength(workspaceText),
      totalBytes: byteLength(globalText) + byteLength(workspaceText),
      maxBytes: config.maxBytes,
      scopeMaxBytes: config.scopeMaxBytes,
      globalMaxBytes: config.globalMaxBytes,
    },
    index: {
      total: index.total,
      shown: index.shown,
      omitted: index.omitted,
      bytes: index.bytes,
      tokens: index.tokens,
    },
    config,
  };
}

/** 单条短期记忆的轻量同步指纹。 */
export function entrySyncState(entry) {
  return `${entry.updatedAt || entry.createdAt || ''}:${contentFingerprint(entry.content).slice(0, 16)}`;
}

/** 当前全部活动短期条目的同步指纹表。 */
export function entriesSyncState(entries) {
  const state = {};
  for (const entry of entries ?? []) state[entry.id] = entrySyncState(entry);
  return state;
}

/** 从最近的记忆消息中取同步状态；旧版本没有同步状态时返回 null。 */
export function lastMemorySync(messages) {
  let found = null;
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue;
    if (message?.source?.kind !== MEMORY_SOURCE_KIND) continue;
    const text = messageText(message);
    if (!text) continue;
    found = { message, text, sync: message.source?.sync ?? null, form: message.source?.form ?? 'snapshot' };
  }
  return found;
}

/** 从完整快照的短期索引中回退解析 ID -> 索引行（兼容没有 sync 元数据的旧消息）。 */
export function extractIndexEntries(text) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((line) => line.trim() === INDEX_HEADER);
  if (start < 0) return null;
  const result = new Map();
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s/.test(line)) break;
    const match = /^- (mem-[0-9a-f]{8})\s*·/.exec(line);
    if (match) result.set(match[1], line);
  }
  return result;
}

/**
 * 增量同步：最新长期记忆 + 只列出自上次同步后新增/修改/删除的短期条目。
 * 无法在容量内可靠表达时返回 tooLarge，由调用方改用完整快照。
 */
export function buildMemoryUpdate(input = {}) {
  const maxBytes = Math.max(512, input.maxBytes ?? 12000);
  const maxTokens = Math.max(128, input.maxTokens ?? 4000);
  const summary = sanitizeFrame(String(input.summary ?? '').trim());
  const changed = Array.isArray(input.changedEntries) ? input.changedEntries : [];
  const deleted = Array.isArray(input.deletedEntries) ? input.deletedEntries : [];
  const header = [
    '<system-reminder>',
    '## 长期记忆增量同步',
    '',
    '本消息是记忆的增量更新，不是完整快照。**本消息列出的短期记忆新版本覆盖更早版本；列出的删除条目立即失效。**',
    '未列出的旧短期条目仍然有效；完整细节可按主题调用 `memory_search`。',
  ].join('\n');
  const footer = '\n</system-reminder>';
  const summaryText = summary || '（暂无长期记忆）';
  const summarySection = `\n\n## 当前长期记忆（最新）\n${summaryText}`;
  const changedLines = [];
  for (const entry of changed) {
    const block = renderEntry(entry);
    changedLines.push(block);
  }
  const deletedLines = deleted.map((entry) => `- ${entry.id}（已删除，旧版本作废）· ${oneLine(entry.summary ?? '', 100)}`);
  const body = [
    header,
    summarySection,
    '',
    '## 新增 / 修改的短期记忆（新版本优先）',
    changedLines.length > 0 ? changedLines.join('\n\n') : '（无）',
    '',
    '## 已删除的短期记忆（旧内容作废）',
    deletedLines.length > 0 ? deletedLines.join('\n') : '（无）',
    footer,
  ].join('\n');
  if (!fits(body, maxBytes, maxTokens)) {
    return {
      tooLarge: true,
      text: body,
      totalBytes: byteLength(body),
      totalTokens: estimateTokens(body),
      changed: changed.length,
      deleted: deleted.length,
    };
  }
  return {
    tooLarge: false,
    form: 'update',
    text: body,
    hash: sha256(body),
    totalBytes: byteLength(body),
    totalTokens: estimateTokens(body),
    changed: changed.length,
    deleted: deleted.length,
  };
}

/**
 * 达到完整快照上限后的有界更新：最新长期记忆 + 最近短期条目。
 * 1.3.0 的同步规划仍保留该函数用于兼容测试；主路径使用 buildMemoryUpdate。
 */
export function buildMemoryDigest(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
  const maxBytes = Math.max(256, input.maxBytes ?? config.digestMaxBytes ?? 6000);
  const maxTokens = Math.max(64, input.maxTokens ?? config.digestMaxTokens ?? 1800);
  const summaryMaxBytes = Math.max(200, input.summaryMaxBytes ?? config.digestSummaryMaxBytes ?? 5000);
  const recentEntries = Math.max(1, input.recentEntries ?? config.digestRecentEntries ?? 24);
  const summary = sanitizeFrame(String(input.summary ?? '').trim());
  const entries = [...(Array.isArray(input.entries) ? input.entries : [])]
    .sort((a, b) => {
      const left = String(b.updatedAt || b.createdAt || '');
      const right = String(a.updatedAt || a.createdAt || '');
      return left < right ? -1 : left > right ? 1 : (a.id < b.id ? -1 : 1);
    })
    .slice(0, recentEntries);

  const header = [
    '<system-reminder>',
    '## 长期记忆更新（精简）',
    '',
    `本消息是 \`${config.privateWorkspace ?? ''}\` 工作区的记忆精简更新，不是完整快照，也不是完整短期索引。`,
    '**本消息是截至当前的最新精简状态。更早的完整快照仍是历史基线；如与旧快照冲突，以本消息为准。**',
    '完整短期索引与原文请按主题调用 `memory_search`；需要完整材料时可调用 `memory_curate`。',
  ].join('\n');
  const footerBase = '\n</system-reminder>';
  const summaryHeading = '\n\n## 长期记忆\n';
  const reserved = byteLength(header) + byteLength(footerBase) + byteLength(summaryHeading) + 220;
  const summaryText = summary
    ? fitTextToBudget(summary, {
      maxBytes: Math.max(200, Math.min(summaryMaxBytes, maxBytes - reserved)),
      maxTokens: Math.max(1, Math.floor(maxTokens * 0.75)),
      suffix: '\n（长期记忆因精简预算截断）',
    })
    : '（暂无长期记忆）';

  const lines = [];
  let omitted = 0;
  let text = `${header}${summaryHeading}${summaryText}\n\n## 最近短期记忆\n`;
  for (let index = 0; index < entries.length; index += 1) {
    const line = formatIndexLine(entries[index]);
    const candidate = `${text}${[...lines, line].join('\n')}${footerBase}`;
    if (!fits(candidate, maxBytes, maxTokens)) {
      omitted += 1;
      continue;
    }
    lines.push(line);
  }
  if (lines.length === 0) lines.push('（没有可展示的近期短期记忆）');
  if (omitted > 0) lines.push(`（另有 ${omitted} 条近期条目未展示）`);
  if (entries.length < (input.entries?.length ?? 0)) {
    lines.push(`（短期记忆共 ${input.entries.length} 条，仅显示最近 ${entries.length} 条）`);
  }
  text = `${text}${lines.join('\n')}${footerBase}`;
  return {
    form: 'digest',
    text,
    hash: sha256(text),
    totalBytes: byteLength(text),
    totalTokens: estimateTokens(text),
    summaryBytes: byteLength(summaryText),
    recentEntries: entries.length,
  };
}

function messageText(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

/** 只统计完整快照；旧版没有 form 的消息按完整快照处理。 */
export function countFullSnapshots(messages) {
  let count = 0;
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue;
    if (message?.source?.kind !== MEMORY_SOURCE_KIND) continue;
    if (message?.source?.form === 'digest') continue;
    if (messageText(message).length > 0) count += 1;
  }
  return count;
}

/** 精简更新的会话级用量，用于频率和上下文预算限制。 */
export function digestUsage(messages) {
  let count = 0;
  let bytes = 0;
  let tokens = 0;
  let lastTurn = 0;
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue;
    if (message?.source?.kind !== MEMORY_SOURCE_KIND) continue;
    if (message?.source?.form !== 'digest') continue;
    const text = messageText(message);
    count += 1;
    bytes += byteLength(text);
    tokens += estimateTokens(text);
    const turn = Number(message?.source?.turn);
    if (Number.isInteger(turn)) lastTurn = Math.max(lastTurn, turn);
  }
  return { count, bytes, tokens, lastTurn };
}

/** 判断消息数组里是否已经存在完全相同的记忆快照。 */
export function hasSnapshotMessage(messages, snapshotText) {
  const expected = String(snapshotText ?? '');
  if (!expected) return false;
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue;
    if (message?.source?.kind !== MEMORY_SOURCE_KIND) continue;
    const parts = Array.isArray(message.content) ? message.content : [];
    const text = parts
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    if (text === expected) return true;
  }
  return false;
}

/** 统计会话中已有的记忆快照数量，用于限制长会话累积。 */
export function countSnapshotMessages(messages) {
  let count = 0;
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue;
    if (message?.source?.kind !== MEMORY_SOURCE_KIND) continue;
    const parts = Array.isArray(message.content) ? message.content : [];
    const hasText = parts.some((part) => part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0);
    if (hasText) count += 1;
  }
  return count;
}

/** 判断是否还需要注入快照。内容不变时返回 false，避免重复追加。 */
export function shouldInjectSnapshot(messages, snapshotText) {
  return !hasSnapshotMessage(messages, snapshotText);
}

/** 找出会话中最后一条记忆快照的文本。 */
export function lastSnapshotText(messages) {
  let found = '';
  for (const message of messages ?? []) {
    if (message?.role !== 'user' || message?.source?.kind !== MEMORY_SOURCE_KIND) continue;
    const parts = Array.isArray(message.content) ? message.content : [];
    const text = parts
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    if (text) found = text;
  }
  return found;
}
