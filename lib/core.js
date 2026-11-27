/**
 * 浮动核心记忆（v2.0）。
 *
 * 最多 coreMaxItems 条动态综合记忆，由 Dreaming 根据短期记忆中重复、相关、高频的
 * 内容自主总结/合并/更新。它不是长期记忆的副本：写入与注入都会与长期记忆做重合度
 * 检查，重复条目被拒绝或跳过。每条都保留来源短期记忆 ID，可追溯到原始事实。
 *
 * 存储：单文件 Markdown（floating_core.md），元数据放在 HTML 注释标记里，
 * 与现有 raw_memories.md 的可读、可 diff、可整体备份风格一致。
 * @module dsh-memory-feiyu/core
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { byteLength, estimateTokens, fitTextToBudget, oneLine } from './text.js';
import { assertNoSecrets } from './store.js';

export const CORE_HEADER = '<!-- feiyu-core v1 · 由 dsh-memory-feiyu Dreaming 维护 -->';
export const CORE_ID_RE = /^fc-[0-9a-f]{8}$/;
const START_RE = /^<!--\s*feiyu-core:start\s+([^>]*)-->\s*$/;
const END_RE = /^<!--\s*feiyu-core:end\s*-->\s*$/;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/** 规范化正文：比较用，不落盘。 */
export function normalizedCoreText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** 核心条目指纹：标题 + 正文。 */
export function coreFingerprint(title, body) {
  return sha256(`${normalizedCoreText(title)}\n${normalizedCoreText(body)}`);
}

/** 新建一条空条目。 */
export function emptyCoreItem(id = `fc-${randomBytes(4).toString('hex')}`) {
  return { id, title: '', body: '', sources: [], createdAt: '', updatedAt: '', pinned: false };
}

function parseAttrs(line) {
  const attrs = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(line)) !== null) attrs[match[1]] = match[2];
  return attrs;
}

/**
 * 解析浮动核心文件。坏块进入 errors，不影响其它条目。
 * @param {string} text
 */
export function parseCore(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  const errors = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const start = START_RE.exec(line);
    if (start) {
      if (current) {
        errors.push({ id: current.id, reason: '上一条浮动核心记忆缺少结束标记', line: index + 1 });
      }
      const attrs = parseAttrs(start[1]);
      const id = String(attrs.id ?? '');
      if (!CORE_ID_RE.test(id)) {
        errors.push({ id, reason: '浮动核心 ID 非法', line: index + 1 });
        current = { id: '', header: attrs, body: [] };
        continue;
      }
      current = {
        id,
        header: attrs,
        body: [],
        startLine: index,
      };
      continue;
    }
    if (END_RE.test(line)) {
      if (!current || !CORE_ID_RE.test(current.id)) {
        errors.push({ id: current?.id ?? '', reason: '浮动核心结束标记没有对应起始标记', line: index + 1 });
        current = null;
        continue;
      }
      const bodyLines = [...current.body];
      let title = '';
      if (bodyLines.length > 0 && /^#{1,6}\s/.test(bodyLines[0])) {
        title = bodyLines.shift().replace(/^#{1,6}\s*/, '').trim();
      }
      const body = bodyLines.join('\n').replace(/\s+$/u, '');
      if (!title && !body) {
        errors.push({ id: current.id, reason: '浮动核心条目为空', line: index + 1 });
        current = null;
        continue;
      }
      items.push({
        id: current.id,
        title,
        body,
        sources: String(current.header.sources ?? '').split(/[,，\s]+/).filter((value) => /^mem-[0-9a-f]{8}$/.test(value)),
        createdAt: String(current.header.created ?? ''),
        updatedAt: String(current.header.updated ?? ''),
        pinned: String(current.header.pinned ?? '') === '1',
      });
      current = null;
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) errors.push({ id: current.id ?? '', reason: '浮动核心条目没有结束标记', line: lines.length });
  return { items, errors };
}

/** 渲染整份浮动核心文件。 */
export function renderCore(items) {
  const blocks = (items ?? []).map((item) => {
    const sources = (item.sources ?? []).join(',');
    const attrs = [
      `id="${item.id}"`,
      `sources="${sources}"`,
      `created="${item.createdAt ?? ''}"`,
      `updated="${item.updatedAt ?? ''}"`,
      `pinned="${item.pinned ? '1' : '0'}"`,
    ].join(' ');
    const title = oneLine(item.title ?? '', 60);
    const body = String(item.body ?? '').replace(/\r\n?/g, '\n').trim();
    return [
      `<!-- feiyu-core:start ${attrs} -->`,
      title ? `### ${title}` : '',
      body,
      '<!-- feiyu-core:end -->',
    ].filter((part) => part !== '').join('\n');
  });
  return `${CORE_HEADER}\n${blocks.length > 0 ? `\n${blocks.join('\n\n')}\n` : ''}`;
}

/** 去掉标题行与列表符号，用于重合度比较。 */
function plainLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^[#>\-*\s]+/, '').replace(/<!--.*?-->/g, '').trim())
    .filter(Boolean);
}

function bigrams(text) {
  const chars = Array.from(String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
  const out = new Set();
  for (let index = 0; index + 1 < chars.length; index += 1) out.add(chars[index] + chars[index + 1]);
  return out;
}

/** 两个文本的 bigram Jaccard 相似度。 */
export function bigramOverlap(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * 与长期记忆的重合检测。
 * @param {string} title
 * @param {string} body
 * @param {string} longTermText
 * @param {{threshold?:number}} [options]
 */
export function overlapsLongTerm(title, body, longTermText, options = {}) {
  const threshold = Math.max(0, Math.min(0.95, Number(options.threshold) || 0.6));
  const source = String(longTermText ?? '').trim();
  if (!source) return { overlap: false, score: 0, matched: '' };
  const normalized = normalizedCoreText(`${title}\n${body}`);
  if (normalized && source.includes(normalized)) return { overlap: true, score: 1, matched: '逐字包含' };
  const paragraphs = plainLines(source).map((line) => line.replace(/\[mem-[0-9a-f]{8}\]/g, '').trim()).filter(Boolean);
  let best = { overlap: false, score: 0, matched: '' };
  for (const paragraph of paragraphs) {
    const score = bigramOverlap(normalized, paragraph);
    if (score > best.score) best = { overlap: score >= threshold, score: Math.round(score * 1000) / 1000, matched: paragraph.slice(0, 60) };
    if (best.overlap) break;
  }
  return best;
}

/** 核心集合的状态指纹：数量 + 每条 id/内容指纹/固定状态。用于计划-提交之间的 CAS。 */
export function stateFingerprint(items) {
  const list = (items ?? [])
    .map((item) => `${item.id}|${coreFingerprint(item.title, item.body)}|${item.pinned === true ? 1 : 0}`)
    .sort();
  return sha256(list.join('\n'));
}

const OPERATIONAL_RE = /(命令|脚本|路径|端口|日志|报错|排障|安装|配置|部署|接口|插件|版本号?|坐标|截图|参数|缓存命中率|路由|web_search|API|token|环境变量|执行策略|代理|bash|powershell|curl|npm|pnpm|git |HTTP [0-9])/gi;
const DURABLE_RE = /(约定|边界|偏好|喜欢|讨厌|习惯|目标|关系|重要|决定|原则|底线|雷区|以后|记住|在意|希望|不想|不要|珍惜|承诺|答应)/g;

/**
 * 浮动核心质量闸门：拒绝"运维流水账/低价值技术排障"占据核心位置。
 * 规则：
 * - 只有运维特征、没有任何"对人的稳定认知"特征 → 拒绝；
 * - 运维特征 ≥2 而稳定认知特征 <2 → 拒绝（容忍一句"以后"式的顺带表述）。
 * @returns {{acceptable:boolean, operational:number, durable:number, reason:string}}
 */
export function classifyCoreItem(title, body) {
  const text = `${title ?? ''}\n${body ?? ''}`;
  const operational = (text.match(OPERATIONAL_RE) ?? []).length;
  const durable = (text.match(DURABLE_RE) ?? []).length;
  if (operational > 0 && (durable === 0 || (operational >= 2 && durable < 2))) {
    return {
      acceptable: false,
      operational,
      durable,
      reason: `更像运维/排障记录（运维特征 ${operational} 处、稳定认知特征 ${durable} 处），不适合放进浮动核心`,
    };
  }
  return { acceptable: true, operational, durable, reason: '' };
}

/**
 * 校验一组浮动核心条目（新增/更新后的完整集合）。
 * 抛出带 code 的错误，调用方整批拒绝，绝不部分落盘。
 * @param {Array<object>} items
 * @param {{
 *   maxItems?:number, itemMaxBytes?:number, activeIds?:Set<string>|Array<string>,
 *   archivedIds?:Set<string>|Array<string>, deletedIds?:Set<string>|Array<string>,
 *   longTermText?:string, overlapThreshold?:number, tombstones?:Array<{hash:string}>,
 *   minSources?:number, allowUnknownSources?:boolean, qualityGate?:boolean,
 * }} options
 */
export function validateCoreItems(items, options = {}) {
  const maxItems = Math.max(1, Number(options.maxItems) || 10);
  const itemMaxBytes = Math.max(120, Number(options.itemMaxBytes) || 600);
  const minSources = Math.max(1, Number(options.minSources) || 2);
  const activeIds = options.activeIds instanceof Set ? options.activeIds : new Set(options.activeIds ?? []);
  const archivedIds = options.archivedIds instanceof Set ? options.archivedIds : new Set(options.archivedIds ?? []);
  const deletedIds = options.deletedIds instanceof Set ? options.deletedIds : new Set(options.deletedIds ?? []);
  const knownSources = new Set([...activeIds, ...archivedIds]);
  const tombstones = new Set((options.tombstones ?? []).map((item) => String(item?.hash ?? '')));
  const list = Array.isArray(items) ? items : [];
  if (list.length > maxItems) {
    const error = new Error(`浮动核心最多 ${maxItems} 条，当前 ${list.length} 条`);
    error.code = 'CORE_TOO_MANY';
    throw error;
  }
  const seenIds = new Set();
  const seenFingerprints = new Map();
  const normalized = [];
  for (const raw of list) {
    const id = String(raw?.id ?? '');
    if (!CORE_ID_RE.test(id)) {
      const error = new Error(`浮动核心 ID 非法: ${id || '(空)'}`);
      error.code = 'CORE_BAD_ID';
      throw error;
    }
    if (seenIds.has(id)) {
      const error = new Error(`浮动核心 ID 重复: ${id}`);
      error.code = 'CORE_DUPLICATE_ID';
      throw error;
    }
    seenIds.add(id);
    const title = oneLine(String(raw?.title ?? ''), 60);
    const body = normalizedCoreText(raw?.body);
    if (!title && !body) {
      const error = new Error(`浮动核心 ${id} 内容为空`);
      error.code = 'CORE_EMPTY';
      throw error;
    }
    if (byteLength(body) > itemMaxBytes) {
      const error = new Error(`浮动核心 ${id} 正文超过 ${itemMaxBytes} 字节`);
      error.code = 'CORE_TOO_LARGE';
      throw error;
    }
    assertNoSecrets(`${title}\n${body}`);
    const sources = [...new Set((raw?.sources ?? []).map((value) => String(value)).filter((value) => /^mem-[0-9a-f]{8}$/.test(value)))];
    if (sources.length < Math.min(minSources, 1)) {
      const error = new Error(`浮动核心 ${id} 缺少来源短期记忆`);
      error.code = 'CORE_NO_SOURCES';
      throw error;
    }
    // 来源生命周期：活动记忆与合法历史归档记忆都可以作为来源；已删除/不存在的一律拒绝。
    const deletedSources = sources.filter((source) => deletedIds.has(source));
    if (deletedSources.length > 0) {
      const error = new Error(`浮动核心 ${id} 引用了已删除的短期记忆：${deletedSources.join(', ')}`);
      error.code = 'CORE_DELETED_SOURCE';
      throw error;
    }
    const unknown = sources.filter((source) => !knownSources.has(source));
    if (unknown.length > 0 && options.allowUnknownSources !== true) {
      const error = new Error(`浮动核心 ${id} 引用了不存在的短期记忆：${unknown.join(', ')}`);
      error.code = 'CORE_BAD_SOURCE';
      throw error;
    }
    if (options.qualityGate === true) {
      const quality = classifyCoreItem(title, body);
      if (!quality.acceptable) {
        const error = new Error(`浮动核心 ${id} ${quality.reason}`);
        error.code = 'CORE_LOW_QUALITY';
        throw error;
      }
    }
    const fingerprint = coreFingerprint(title, body);
    if (tombstones.has(fingerprint)) {
      const error = new Error(`浮动核心 ${id} 与用户删除过的内容相同，不能重新写入`);
      error.code = 'CORE_TOMBSTONED';
      throw error;
    }
    const duplicate = seenFingerprints.get(fingerprint);
    if (duplicate) {
      const error = new Error(`浮动核心 ${id} 与 ${duplicate} 内容重复`);
      error.code = 'CORE_DUPLICATE';
      throw error;
    }
    seenFingerprints.set(fingerprint, id);
    if (options.longTermText) {
      const overlap = overlapsLongTerm(title, body, options.longTermText, { threshold: options.overlapThreshold });
      if (overlap.overlap) {
        const error = new Error(`浮动核心 ${id} 与长期记忆重复（重合度 ${Math.round(overlap.score * 100)}%）：${overlap.matched}`);
        error.code = 'CORE_OVERLAPS_LONG_TERM';
        throw error;
      }
    }
    normalized.push({
      id,
      title,
      body,
      sources,
      createdAt: String(raw?.createdAt ?? ''),
      updatedAt: String(raw?.updatedAt ?? ''),
      pinned: raw?.pinned === true,
      fingerprint,
    });
  }
  return normalized;
}

/**
 * 选择要注入的浮动核心条目：跳过与长期记忆重复的，按预算整条裁剪。
 * @param {Array<object>} items
 * @param {{maxBytes?:number, maxTokens?:number, longTermText?:string, overlapThreshold?:number}} options
 */
export function selectCoreForInjection(items, options = {}) {
  const maxBytes = Math.max(0, Number(options.maxBytes) || 0);
  const maxTokens = Math.max(0, Number(options.maxTokens) || Number.POSITIVE_INFINITY);
  const list = Array.isArray(items) ? items : [];
  const kept = [];
  const skipped = [];
  for (const item of list) {
    const overlap = options.longTermText
      ? overlapsLongTerm(item.title, item.body, options.longTermText, { threshold: options.overlapThreshold })
      : { overlap: false };
    if (overlap.overlap) {
      skipped.push({ id: item.id, reason: 'overlaps-long-term' });
      continue;
    }
    kept.push(item);
  }
  if (kept.length === 0) {
    return { text: '', items: [], skipped, total: list.length };
  }
  const lines = [];
  let bytes = 0;
  let tokens = 0;
  const included = [];
  for (const item of kept) {
    const sources = (item.sources ?? []).slice(0, 4).map((id) => id.replace('mem-', '')).join(',');
    const body = oneLine(item.body, 160);
    const line = `- [${item.id}] ${item.title || '（无标题）'}：${body}（来源 ${sources || '—'}）`;
    const lineBytes = byteLength(`${line}\n`);
    const lineTokens = estimateTokens(line);
    if (bytes + lineBytes > maxBytes || tokens + lineTokens > maxTokens) {
      skipped.push({ id: item.id, reason: 'budget' });
      continue;
    }
    lines.push(line);
    bytes += lineBytes;
    tokens += lineTokens;
    included.push(item.id);
  }
  return {
    text: lines.join('\n'),
    items: included,
    skipped,
    total: list.length,
  };
}

/** 历史记录里保存的条目快照。 */
function itemSnapshot(item) {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    sources: [...(item.sources ?? [])],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pinned: item.pinned === true,
  };
}

/**
 * 浮动核心记忆存储。
 */
export class FloatingCore {
  /**
   * @param {{
   *   memoryDir: string,
   *   now?: () => Date,
   *   logger?: {warn?: Function},
   *   maxItems?: number,
   *   itemMaxBytes?: number,
   *   minSources?: number,
   *   overlapThreshold?: number,
   *   utcOffsetMinutes?: number,
   * }} options
   */
  constructor(options) {
    if (!options?.memoryDir) throw new TypeError('FloatingCore: memoryDir 必填');
    this.memoryDir = path.resolve(options.memoryDir);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
    this.maxItems = Math.max(1, Number(options.maxItems) || 10);
    this.itemMaxBytes = Math.max(120, Number(options.itemMaxBytes) || 600);
    this.minSources = Math.max(1, Number(options.minSources) || 2);
    this.overlapThreshold = Number(options.overlapThreshold) || 0.6;
    this.utcOffsetMinutes = options.utcOffsetMinutes ?? 480;
    this.coreFile = path.join(this.memoryDir, 'floating_core.md');
    this.historyFile = path.join(this.memoryDir, 'core_history.jsonl');
    this.tombstoneFile = path.join(this.memoryDir, 'core_tombstones.json');
    this._queue = Promise.resolve();
    this._initialized = false;
    this.items = [];
    this.errors = [];
    this.tombstones = [];
    this.historySeq = 0;
  }

  async init() {
    await fs.mkdir(this.memoryDir, { recursive: true });
    try {
      await fs.access(this.coreFile);
    } catch {
      await fs.writeFile(this.coreFile, `${CORE_HEADER}\n`, 'utf8');
    }
    try {
      await fs.access(this.historyFile);
    } catch {
      await fs.writeFile(this.historyFile, '', 'utf8');
    }
    this.tombstones = await this._readTombstones();
    await this.reload();
    this._initialized = true;
    return this;
  }

  async reload() {
    const text = await this._readText(this.coreFile);
    const parsed = parseCore(text);
    this.items = parsed.items;
    this.errors = parsed.errors;
    this.historySeq = await this._readHistorySeq();
    return { items: this.items, errors: this.errors };
  }

  async _readText(file) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
  }

  async _readTombstones() {
    try {
      const parsed = JSON.parse(await this._readText(this.tombstoneFile));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.hash === 'string').slice(-200);
    } catch {
      return [];
    }
  }

  async _readHistorySeq() {
    const text = await this._readText(this.historyFile);
    let max = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (Number.isInteger(record?.seq)) max = Math.max(max, record.seq);
      } catch {
        // 坏行忽略。
      }
    }
    return max;
  }

  _exclusive(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _atomicWrite(file, text) {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, text, 'utf8');
    try {
      await fs.rename(tmp, file);
    } catch {
      await fs.copyFile(tmp, file);
      await fs.rm(tmp, { force: true });
    }
  }

  async _appendHistory(record) {
    this.historySeq += 1;
    const payload = { seq: this.historySeq, ts: new Date(this.now()).toISOString(), ...record };
    await fs.appendFile(this.historyFile, `${JSON.stringify(payload)}\n`, 'utf8');
    const text = await this._readText(this.historyFile);
    const lines = text.split('\n').filter(Boolean);
    if (lines.length > 400) {
      await this._atomicWrite(this.historyFile, `${lines.slice(-400).join('\n')}\n`);
    }
    return payload;
  }

  async _writeTombstones(items) {
    const text = `${JSON.stringify(items, null, 2)}\n`;
    await this._atomicWrite(this.tombstoneFile, text);
    this.tombstones = items;
  }

  /** 当前条目（只读副本）。 */
  list() {
    return this.items.map((item) => ({ ...item, sources: [...item.sources] }));
  }

  get(id) {
    return this.items.find((item) => item.id === id);
  }

  /** 与长期记忆/来源约束一致地校验整份集合。 */
  validate(items, options = {}) {
    return validateCoreItems(items, {
      maxItems: this.maxItems,
      itemMaxBytes: this.itemMaxBytes,
      minSources: this.minSources,
      overlapThreshold: this.overlapThreshold,
      tombstones: this.tombstones,
      ...options,
    });
  }

  /** 当前核心集合的状态指纹（计划-提交 CAS 用）。 */
  stateFingerprint() {
    return stateFingerprint(this.items);
  }

  /**
   * 短期记忆被删除后，清洗浮动核心里的来源引用。
   *
   * 规则：删掉已删除/已不存在的来源；如果一条核心因此没有任何来源，就整条移除（并写历史）。
   * 这样"来源必须是活动或合法归档记忆"这条不变量在删除发生时就被维护，
   * 而不是等到下一次写入才整批失败。
   */
  async scrubSources(removedIds, options = {}) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const goneIds = new Set((removedIds ?? []).map(String));
      const activeIds = new Set(options.activeIds ?? []);
      const archivedIds = new Set(options.archivedIds ?? []);
      const known = new Set([...activeIds, ...archivedIds]);
      if (goneIds.size === 0 && known.size === 0) return { changed: false, updated: [], removed: [] };
      const isGone = (source) => goneIds.has(source) || (known.size > 0 && !known.has(source));
      const updated = [];
      const removed = [];
      const next = [];
      for (const item of this.items) {
        const kept = (item.sources ?? []).filter((source) => !isGone(source));
        if (kept.length === (item.sources ?? []).length) {
          next.push(item);
          continue;
        }
        if (kept.length === 0) {
          removed.push(item.id);
          continue;
        }
        updated.push(item.id);
        next.push({ ...item, sources: kept });
      }
      if (updated.length === 0 && removed.length === 0) return { changed: false, updated: [], removed: [] };
      const result = await this._replaceUnlocked(next, {
        ...options,
        // 只做"减少引用"：剩余来源都已按 known/gone 过滤，不需要再拿来源名单校验。
        allowUnknownSources: true,
        preservePinned: false,
        actor: 'system',
        reason: `sources-removed:${[...goneIds].join(',')}`.slice(0, 200),
      });
      return { changed: result.changed, updated, removed, items: this.list() };
    });
  }

  /**
   * 用一组新条目替换整份浮动核心（Dreaming 与 UI 都走这里）。
   * @param {Array<object>} items
   * @param {{reason?:string, activeIds?:string[], longTermText?:string, actor?:string, allowUnknownSources?:boolean}} options
   */
  async replace(items, options = {}) {
    return this._exclusive(() => this._replaceUnlocked(items, options));
  }

  async _replaceUnlocked(items, options = {}) {
    if (!this._initialized) await this.init();
    // 计划-提交原子性：调用方给出 expectState 时，先把磁盘上的最新核心读回来，
    // 再比较状态指纹。用户/Dreaming/设置页在这之间改过核心，就整次放弃。
    if (options.expectState) {
      await this.reload();
      const actual = stateFingerprint(this.items);
      if (actual !== String(options.expectState)) {
        const error = new Error('浮动核心在计划生成后已被修改，本次不落盘');
        error.code = 'CORE_CONFLICT';
        error.expectedState = String(options.expectState);
        error.actualState = actual;
        throw error;
      }
    }
    const validated = this.validate(items, options);
    const stamp = new Date(this.now()).toISOString();
    const previousById = new Map(this.items.map((item) => [item.id, item]));
    const preservePinned = options.preservePinned !== false;
    const next = validated.map((item) => {
      const previous = previousById.get(item.id);
      return {
        id: item.id,
        title: item.title,
        body: item.body,
        sources: item.sources,
        pinned: previous ? (preservePinned && previous.pinned ? true : item.pinned) : item.pinned,
        createdAt: item.createdAt || previous?.createdAt || stamp,
        updatedAt: stamp,
      };
    });
    // 用户固定的条目不允许被自动流程悄悄删掉（显式删除/解锁不受此限）。
    if (preservePinned) {
      for (const previous of this.items) {
        if (!previous.pinned) continue;
        if (next.some((item) => item.id === previous.id)) continue;
        next.push({ ...previous });
      }
    }
    const before = new Map(this.items.map((item) => [item.id, item]));
    const after = new Map(next.map((item) => [item.id, item]));
    const ops = [];
    for (const item of next) {
      const previous = before.get(item.id);
      if (!previous) {
        ops.push({ op: 'add', id: item.id });
        continue;
      }
      const contentChanged = coreFingerprint(previous.title, previous.body) !== coreFingerprint(item.title, item.body);
      const sourcesChanged = (previous.sources ?? []).join(',') !== (item.sources ?? []).join(',');
      if (contentChanged || sourcesChanged) ops.push({ op: 'update', id: item.id });
      if (previous.pinned !== item.pinned) ops.push({ op: item.pinned ? 'pin' : 'unpin', id: item.id });
    }
    for (const previous of this.items) {
      if (!after.has(previous.id)) ops.push({ op: 'remove', id: previous.id });
    }
    if (ops.length === 0) return { changed: false, ops: [], items: this.list() };
    await this._atomicWrite(this.coreFile, renderCore(next));
    for (const op of ops) {
      await this._appendHistory({
        op: op.op,
        id: op.id,
        previous: before.get(op.id) ? itemSnapshot(before.get(op.id)) : null,
        next: after.get(op.id) ? itemSnapshot(after.get(op.id)) : null,
        actor: String(options.actor ?? 'dreaming').slice(0, 40),
        reason: String(options.reason ?? '').slice(0, 200),
      });
    }
    this.items = next;
    this.errors = [];
    return { changed: true, ops, items: this.list() };
  }

  /** 新增一条；超出上限时拒绝，不静默淘汰。 */
  async add(input, options = {}) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const stamp = new Date(this.now()).toISOString();
      const item = {
        id: CORE_ID_RE.test(String(input?.id ?? '')) ? input.id : `fc-${randomBytes(4).toString('hex')}`,
        title: oneLine(String(input?.title ?? ''), 60),
        body: normalizedCoreText(input?.body),
        sources: [...new Set((input?.sources ?? []).map(String))],
        createdAt: stamp,
        updatedAt: stamp,
        pinned: input?.pinned === true,
      };
      const result = await this._replaceUnlocked([...this.items, item], options);
      return { ...result, item };
    });
  }

  /** 修改一条；pinned 条目只有显式 pinned=false 才会解锁。 */
  async update(id, patch = {}, options = {}) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const target = this.items.find((item) => item.id === id);
      if (!target) {
        const error = new Error(`没有找到浮动核心 ${id}`);
        error.code = 'CORE_NOT_FOUND';
        throw error;
      }
      const next = this.items.map((item) => (item.id === id
        ? {
          ...item,
          title: patch.title !== undefined ? oneLine(String(patch.title), 60) : item.title,
          body: patch.body !== undefined ? normalizedCoreText(patch.body) : item.body,
          sources: patch.sources !== undefined ? [...new Set(patch.sources.map(String))] : item.sources,
          pinned: patch.pinned !== undefined ? patch.pinned === true : item.pinned,
        }
        : item));
      // 显式传入 pinned 视为用户的直接操作，不受“自动流程不得改固定条目”的限制。
      const replaceOptions = patch.pinned !== undefined ? { ...options, preservePinned: false } : options;
      return this._replaceUnlocked(next, replaceOptions);
    });
  }

  /** 删除一条；写入 tombstone 指纹，Dreaming 不得复活。 */
  async remove(id, reason = 'user-delete', options = {}) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const target = this.items.find((item) => item.id === id);
      if (!target) {
        const error = new Error(`没有找到浮动核心 ${id}`);
        error.code = 'CORE_NOT_FOUND';
        throw error;
      }
      const tombstones = [...this.tombstones, {
        hash: coreFingerprint(target.title, target.body),
        title: oneLine(target.title, 60),
        at: new Date(this.now()).toISOString(),
        reason: String(reason ?? '').slice(0, 120),
      }].slice(-200);
      // 先记墓碑再删内容：即使写文件失败，也不会让被删内容复活。
      await this._writeTombstones(tombstones);
      const result = await this._replaceUnlocked(this.items.filter((item) => item.id !== id), {
        ...options,
        preservePinned: false,
        reason,
      });
      return { ...result, removed: itemSnapshot(target), tombstones: tombstones.length };
    });
  }

  async setPinned(id, pinned, options = {}) {
    return this.update(id, { pinned }, {
      ...options,
      preservePinned: false,
      reason: options.reason ?? (pinned ? 'user-pin' : 'user-unpin'),
    });
  }

  /** 某条浮动核心的变更历史。 */
  async history(id) {
    const text = await this._readText(this.historyFile);
    const records = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!id || record?.id === id) records.push(record);
      } catch {
        // 忽略坏行。
      }
    }
    return records.map((record) => ({
      ...record,
      title: oneLine(record?.next?.title ?? record?.previous?.title ?? '', 60),
    }));
  }

  /** 把某条浮动核心恢复到某次变更之前。 */
  async restoreFromHistory(id, seq, options = {}) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const records = await this.history(id);
      const record = records.find((item) => Number(item.seq) === Number(seq));
      if (!record) {
        const error = new Error(`没有找到浮动核心 ${id} 的历史记录 ${seq}`);
        error.code = 'CORE_HISTORY_NOT_FOUND';
        throw error;
      }
      const snapshot = record.previous;
      const next = this.items.filter((item) => item.id !== id);
      if (snapshot) {
        next.push({
          id,
          title: snapshot.title,
          body: snapshot.body,
          sources: snapshot.sources ?? [],
          createdAt: snapshot.createdAt,
          updatedAt: new Date(this.now()).toISOString(),
          pinned: snapshot.pinned === true,
        });
      }
      return this._replaceUnlocked(next, { ...options, reason: options.reason ?? `restore:${seq}` });
    });
  }

  stats() {
    const bytes = this.items.reduce((sum, item) => sum + byteLength(item.body) + byteLength(item.title), 0);
    return {
      count: this.items.length,
      maxItems: this.maxItems,
      bytes,
      itemMaxBytes: this.itemMaxBytes,
      pinned: this.items.filter((item) => item.pinned).length,
      sources: this.items.reduce((sum, item) => sum + item.sources.length, 0),
      tombstones: this.tombstones.length,
      errors: this.errors.length,
      historySeq: this.historySeq,
    };
  }

  async close() {
    await this._queue.catch(() => {});
    this._initialized = false;
  }
}

export { fitTextToBudget };
