/**
 * 长期记忆文档的结构化辅助：锁定块、引用、删除清洗和校验。
 *
 * 长期记忆仍然是 Markdown，本模块不引入数据库；所有元数据都保存在文档或
 * summary_history/index.json / state.json 中，便于沿用现有备份与回滚。
 * @module dsh-memory-feiyu/summary
 */
import { createHash, randomBytes } from 'node:crypto';
import { byteLength, estimateTokens } from './text.js';

export const LOCK_START = 'feiyu-lock:start';
export const LOCK_END = 'feiyu-lock:end';
export const LOCK_ID_RE = /^lk-[0-9a-f]{8}$/;

const START_RE = /<!--\s*feiyu-lock:start\s+id="([^"]+)"\s*-->/g;
const END_RE = /<!--\s*feiyu-lock:end\s*-->/g;

/** 稳定 sha256。 */
export function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/** 锁定块的稳定 hash：只用于比较，不替代原文。 */
export function normalizedText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').trim();
}

export function newLockId() {
  return `lk-${randomBytes(4).toString('hex')}`;
}

/**
 * 解析锁定块。标记必须成对、不能嵌套、id 不能重复。
 * @param {string} text
 * @returns {{blocks:Array<{id:string,content:string,start:number,end:number,raw:string}>,errors:Array<{reason:string,index:number}>}}
 */
export function parseLockBlocks(text) {
  const source = String(text ?? '');
  const starts = [];
  let match;
  START_RE.lastIndex = 0;
  while ((match = START_RE.exec(source)) !== null) {
    starts.push({ id: match[1], index: match.index, after: match.index + match[0].length });
  }
  const ends = [];
  END_RE.lastIndex = 0;
  while ((match = END_RE.exec(source)) !== null) {
    ends.push({ index: match.index, after: match.index + match[0].length });
  }

  const errors = [];
  const blocks = [];
  let cursor = 0;
  const used = new Set();
  const usedEnds = new Set();
  for (const start of starts) {
    if (start.index < cursor) {
      errors.push({ reason: `锁定块 ${start.id} 嵌套或顺序错误`, index: start.index });
      continue;
    }
    const end = ends.find((candidate) => candidate.index >= start.after && !usedEnds.has(candidate.index));
    if (!end) {
      errors.push({ reason: `锁定块 ${start.id} 缺少结束标记`, index: start.index });
      break;
    }
    if (!LOCK_ID_RE.test(start.id)) {
      errors.push({ reason: `锁定块 id 非法: ${start.id}`, index: start.index });
    }
    if (used.has(start.id)) {
      errors.push({ reason: `锁定块 id 重复: ${start.id}`, index: start.index });
    }
    used.add(start.id);
    usedEnds.add(end.index);
    const content = source.slice(start.after, end.index);
    blocks.push({
      id: start.id,
      content: content.trim(),
      start: start.index,
      end: end.after,
      raw: source.slice(start.index, end.after),
    });
    cursor = end.after;
  }
  const strayEnd = ends.find((candidate) => !usedEnds.has(candidate.index));
  if (strayEnd) errors.push({ reason: '存在没有起始标记的 feiyu-lock:end', index: strayEnd.index });
  return { blocks, errors };
}

/** 把一段内容包成锁定块。 */
export function renderLockBlock(id, content) {
  if (!LOCK_ID_RE.test(id)) throw new TypeError(`非法锁定块 id: ${id}`);
  return `<!-- ${LOCK_START} id="${id}" -->\n${String(content ?? '').trim()}\n<!-- ${LOCK_END} -->`;
}

/** 校验旧文档中的锁定块在新文档中逐字保留。 */
export function validateLockedBlocks(oldText, newText, options = {}) {
  const oldParsed = parseLockBlocks(oldText);
  const newParsed = parseLockBlocks(newText);
  if (newParsed.errors.length > 0) {
    const error = new Error(`新长期记忆锁定块格式错误：${newParsed.errors[0].reason}`);
    error.code = 'SUMMARY_LOCK_INVALID';
    throw error;
  }
  const newById = new Map(newParsed.blocks.map((block) => [block.id, block]));
  for (const block of oldParsed.blocks) {
    const next = newById.get(block.id);
    if (!next) {
      const error = new Error(`锁定块 ${block.id} 被删除或改写；请保留锁定内容，或先由用户解锁`);
      error.code = 'SUMMARY_LOCK_MISSING';
      error.lockId = block.id;
      throw error;
    }
    if (normalizedText(next.content) !== normalizedText(block.content)) {
      const error = new Error(`锁定块 ${block.id} 内容被改写；锁定内容必须逐字保留`);
      error.code = 'SUMMARY_LOCK_CHANGED';
      error.lockId = block.id;
      throw error;
    }
  }
  if (options.allowNewLocks === false) {
    const oldIds = new Set(oldParsed.blocks.map((block) => block.id));
    const added = newParsed.blocks.filter((block) => !oldIds.has(block.id));
    if (added.length > 0) {
      const error = new Error(`自动合成不得新增锁定块：${added.map((block) => block.id).join(', ')}`);
      error.code = 'SUMMARY_LOCK_ADDED';
      throw error;
    }
  }
  return { oldBlocks: oldParsed.blocks, newBlocks: newParsed.blocks };
}

/** 去掉锁定标记但保留内容，用于差异比较。 */
export function stripLockMarkers(text) {
  return String(text ?? '')
    .replace(START_RE, '')
    .replace(END_RE, '');
}

function splitParagraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isHeading(block) {
  return /^#{1,6}\s/.test(block);
}

/**
 * 用户编辑后，把新增/修改的叶子段落自动包成锁定块。
 * 已经含锁定标记的文本原样返回（交给用户显式控制）。
 */
/** 找出旧文档中被用户删掉的非标题段落（用于“删除后不得复活”）。 */
export function removedLeafBlocks(oldText, newText) {
  const oldBlocks = splitParagraphs(stripLockMarkers(oldText))
    .map((block) => splitHeadingAndContent(block).content)
    .filter(Boolean);
  const next = new Set(
    splitParagraphs(stripLockMarkers(newText))
      .map((block) => splitHeadingAndContent(block).content)
      .filter(Boolean)
      .map(normalizedText),
  );
  return oldBlocks.filter((block) => !next.has(normalizedText(block)));
}

function splitHeadingAndContent(block) {
  const lines = String(block).split('\n');
  const headings = [];
  while (lines.length > 0 && isHeading(lines[0])) headings.push(lines.shift());
  return { headings, content: lines.join('\n').trim() };
}

export function lockChangedBlocks(oldText, newText) {
  const next = String(newText ?? '').replace(/\r\n?/g, '\n').trim();
  if (/feiyu-lock:start/.test(next)) return next;
  const oldContent = new Set(
    splitParagraphs(stripLockMarkers(oldText))
      .map((block) => splitHeadingAndContent(block).content)
      .filter(Boolean)
      .map(normalizedText),
  );
  const blocks = splitParagraphs(next);
  const out = [];
  for (const block of blocks) {
    const { headings, content } = splitHeadingAndContent(block);
    if (!content) {
      out.push(block);
      continue;
    }
    if (oldContent.has(normalizedText(content))) {
      out.push(block);
      continue;
    }
    out.push([...headings, renderLockBlock(newLockId(), content)].join('\n'));
  }
  return out.join('\n\n');
}

/** 解锁一个块：只移除标记，保留内容。 */
export function unlockBlock(text, id) {
  const source = String(text ?? '');
  const parsed = parseLockBlocks(source);
  if (parsed.errors.length > 0) {
    const error = new Error(`长期记忆锁定块格式错误：${parsed.errors[0].reason}`);
    error.code = 'SUMMARY_LOCK_INVALID';
    throw error;
  }
  const block = parsed.blocks.find((item) => item.id === id);
  if (!block) {
    const error = new Error(`没有找到锁定块 ${id}`);
    error.code = 'SUMMARY_LOCK_NOT_FOUND';
    throw error;
  }
  return `${source.slice(0, block.start)}${normalizedText(block.content)}${source.slice(block.end)}`
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 删除一个块（连同标记）；返回新文本和被删内容。 */
export function removeBlock(text, id) {
  const source = String(text ?? '');
  const parsed = parseLockBlocks(source);
  if (parsed.errors.length > 0) {
    const error = new Error(`长期记忆锁定块格式错误：${parsed.errors[0].reason}`);
    error.code = 'SUMMARY_LOCK_INVALID';
    throw error;
  }
  const block = parsed.blocks.find((item) => item.id === id);
  if (!block) {
    const error = new Error(`没有找到锁定块 ${id}`);
    error.code = 'SUMMARY_LOCK_NOT_FOUND';
    throw error;
  }
  return {
    text: `${source.slice(0, block.start)}${source.slice(block.end)}`.replace(/\n{3,}/g, '\n\n').trim(),
    content: block.content,
  };
}

/** 删除一段未锁定的内容（按规范化文本精确匹配一个段落）。 */
export function removeParagraph(text, target) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const needle = normalizedText(target);
  if (!needle) {
    const error = new Error('要删除的长期记忆内容为空');
    error.code = 'SUMMARY_BLOCK_EMPTY';
    throw error;
  }
  const blocks = splitParagraphs(source);
  const index = blocks.findIndex((block) => normalizedText(block) === needle);
  if (index >= 0) {
    const removed = blocks[index];
    blocks.splice(index, 1);
    return { text: blocks.join('\n\n').trim(), content: removed };
  }
  // 允许删除标题下的单行 claim（splitParagraphs 会把标题和 bullet 放在同一段）。
  const lines = source.split('\n');
  const lineIndex = lines.findIndex((line) => normalizedText(line) === needle);
  if (lineIndex < 0) {
    const error = new Error('没有找到要删除的长期记忆段落');
    error.code = 'SUMMARY_BLOCK_NOT_FOUND';
    throw error;
  }
  const removed = lines[lineIndex];
  lines.splice(lineIndex, 1);
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), content: removed };
}

/** 从一行中解析引用到的短期 ID。 */
export function citationsInLine(line) {
  const ids = [];
  for (const match of String(line ?? '').matchAll(/\[([^\]]*\bmem-[0-9a-f]{8}\b[^\]]*)\]/g)) {
    for (const id of match[1].matchAll(/\bmem-[0-9a-f]{8}\b/g)) ids.push(id[0]);
  }
  return [...new Set(ids)];
}

/** 全文引用到的短期 ID。 */
export function citationsInSummary(text) {
  const ids = new Set();
  for (const line of String(text ?? '').split('\n')) {
    for (const id of citationsInLine(line)) ids.add(id);
  }
  return [...ids];
}

function removeDeletedCitationsFromLine(line, deletedIds) {
  const value = String(line);
  let sawCitation = false;
  let remaining = 0;
  let next = value.replace(/\bmem-[0-9a-f]{8}\b/g, (id) => {
    sawCitation = true;
    if (deletedIds.has(id)) return '';
    remaining += 1;
    return id;
  });
  next = next
    .replace(/\[\s*\]/g, '')
    .replace(/\s+([，。；、,.;])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trimEnd();
  return { line: next, sawCitation, remaining };
}

function pruneEmptyLockBlocks(text) {
  let source = String(text ?? '');
  let changed = true;
  while (changed) {
    changed = false;
    const parsed = parseLockBlocks(source);
    for (const block of parsed.blocks) {
      if (normalizedText(block.content) === '') {
        source = `${source.slice(0, block.start)}${source.slice(block.end)}`;
        changed = true;
        break;
      }
    }
  }
  return source;
}

/**
 * 删除短期记忆后清洗长期摘要：
 * - 只删除被删 ID 的引用；
 * - 一条 claim 的所有引用都被删除时，整行删除；
 * - 锁定块内容被清空时，整个块删除；
 * - 旧摘要没有引用时，用删除条目的概述做保守匹配（兼容 1.2.0）。
 *
 * @param {string} text
 * @param {string[]} deletedIds
 * @param {Array<{summary?:string}>} deletedEntries
 */
export function scrubSummaryForDeleted(text, deletedIds, deletedEntries = []) {
  const ids = new Set((deletedIds ?? []).filter((id) => /^mem-[0-9a-f]{8}$/.test(String(id))));
  const phrases = (deletedEntries ?? [])
    .map((entry) => normalizedText(entry?.summary))
    .filter((phrase) => phrase.length >= 8);
  if (ids.size === 0 && phrases.length === 0) return { text: String(text ?? ''), removedLines: 0, removedContents: [] };

  const removedContents = [];
  const kept = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) {
      kept.push(line);
      continue;
    }
    const result = removeDeletedCitationsFromLine(line, ids);
    if (result.sawCitation) {
      if (result.remaining === 0) {
        removedContents.push(line.trim());
        continue;
      }
      kept.push(result.line);
      continue;
    }
    if (phrases.some((phrase) => normalizedText(line).includes(phrase))) {
      removedContents.push(line.trim());
      continue;
    }
    kept.push(line);
  }
  let output = pruneEmptyLockBlocks(kept.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  return { text: output, removedLines: removedContents.length, removedContents };
}

/** 长期记忆的“已遗忘”指纹。 */
export function forgottenFingerprint(text) {
  return sha256(normalizedText(text));
}

/**
 * 校验 AI 生成的长期摘要。抛出的错误都带稳定 code。
 * @param {string} text
 * @param {{maxBytes?:number,maxTokens?:number,currentText?:string,memories?:Array<{id:string}>,forgotten?:Array<{text:string,hash?:string}>,allowNewLocks?:boolean,allowEmpty?:boolean}} options
 */
export function validateLongTermSummary(text, options = {}) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!body && options.allowEmpty !== true) {
    const error = new Error('长期记忆为空；拒绝用空文档覆盖');
    error.code = 'SUMMARY_EMPTY';
    throw error;
  }
  if (options.maxBytes !== undefined && byteLength(body) > options.maxBytes) {
    const error = new Error(`长期记忆超过 ${options.maxBytes} 字节预算`);
    error.code = 'SUMMARY_TOO_LARGE';
    throw error;
  }
  if (options.maxTokens !== undefined && estimateTokens(body) > options.maxTokens) {
    const error = new Error(`长期记忆超过 ${options.maxTokens} token 预算`);
    error.code = 'SUMMARY_TOO_LARGE';
    throw error;
  }
  const parsed = parseLockBlocks(body);
  if (parsed.errors.length > 0) {
    const error = new Error(`长期记忆锁定块格式错误：${parsed.errors[0].reason}`);
    error.code = 'SUMMARY_LOCK_INVALID';
    throw error;
  }
  if (options.currentText !== undefined) {
    validateLockedBlocks(options.currentText, body, { allowNewLocks: options.allowNewLocks === true });
  }
  const activeIds = new Set((options.memories ?? []).map((entry) => entry.id));
  const badIds = citationsInSummary(body).filter((id) => !activeIds.has(id));
  if (badIds.length > 0) {
    const error = new Error(`长期记忆引用了不存在的活动短期记忆：${badIds.join(', ')}`);
    error.code = 'SUMMARY_BAD_CITATION';
    error.memoryIds = badIds;
    throw error;
  }
  const normalizedBody = normalizedText(body);
  for (const item of options.forgotten ?? []) {
    const textValue = normalizedText(item?.text);
    if (!textValue) continue;
    if (normalizedBody.includes(textValue) || (item.hash && sha256(textValue) === item.hash)) {
      const error = new Error(`长期记忆重新引入了用户已删除的内容：${textValue.slice(0, 60)}`);
      error.code = 'SUMMARY_FORGOTTEN_REINTRODUCED';
      throw error;
    }
  }
  return { text: body, locks: parsed.blocks };
}

/** 返回文档中的锁定块摘要，供设置页展示。 */
export function lockSummaries(text) {
  return parseLockBlocks(text).blocks.map((block) => ({
    id: block.id,
    content: block.content,
    bytes: byteLength(block.content),
  }));
}
