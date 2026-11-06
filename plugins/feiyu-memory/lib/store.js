/**
 * 原始记忆存储、摘要版本、归档和日志。
 * 纯 Node 实现，不依赖 DSH，便于测试与跨重启恢复。
 *
 * 可靠性约定：
 * - 单条坏记录不会拖垮整个库：读取时逐块解析，坏块隔离并写诊断；有坏块时拒绝
 *   会重写原文件的写操作，绝不静默覆盖原始数据。
 * - state.json 损坏不会静默回默认：先隔离坏文件，再从 .bak / 墓碑日志 / 历史目录恢复。
 * - 墓碑以 append-only `tombstones.jsonl` 为准，不再按固定 100 条丢弃。
 * - 多文件操作采用“先写安全侧，再写索引/状态”的顺序，并在启动时对账。
 * @module dsh-memory-feiyu/store
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { byteLength, normalizeTags, oneLine } from './text.js';
import { searchMemories } from './search.js';
import {
  forgottenFingerprint,
  lockChangedBlocks,
  lockSummaries,
  parseLockBlocks,
  removeBlock,
  removeParagraph,
  removedLeafBlocks,
  scrubSummaryForDeleted,
  sha256 as summarySha256,
  unlockBlock,
  validateLongTermSummary,
  validateLockedBlocks,
} from './summary.js';

export const RAW_HEADER = '<!-- feiyu-raw v1 · 由 dsh-memory-feiyu 管理 -->';
export const SUMMARY_HEADER = '<!-- feiyu-summary v1 · 由 dsh-memory-feiyu 管理 -->';
export const ARCHIVE_HEADER = '<!-- feiyu-archive v1 · 由 dsh-memory-feiyu 管理，历史记录不删除 -->';
export const ENTRY_ID_RE = /^mem-[0-9a-f]{8}$/;
const ENTRY_HEADING_RE = /^## (mem-[0-9a-f]{8})\s*$/;
const ANY_HEADING_RE = /^##\s+(.*)$/;
const SUMMARY_VERSION_RE = /^(\d{4,})\.md$/;

const DEFAULT_STATE = Object.freeze({
  version: 2,
  summaryVersion: 0,
  summaryMode: 'auto',
  summaryHash: '',
  totalAdded: 0,
  revisionSeq: 0,
  // 兼容旧版；新版以 tombstones.jsonl 为准，这里只是快照。
  tombstones: [],
  // 用户明确从长期记忆中删除的内容；自动合成不得重新写入。
  longTermForgotten: [],
});

/** 墓碑不再按固定条数丢弃；旧 state 中的 tombstones 全量读取。 */

/** 归一化正文后计算指纹；只用于比对，不落盘正文。 */
export function contentFingerprint(content) {
  const normalized = String(content ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** 秘密信息检测失败。错误信息不包含被检测到的内容。 */
export class SecretDetectedError extends Error {
  constructor() {
    super('记忆内容疑似包含密码、令牌或密钥，已拒绝写入');
    this.name = 'SecretDetectedError';
    this.code = 'SECRET_DETECTED';
  }
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=：]\s*['"]?[^\s'"]{6,}/i,
  /(?:密码|口令|密钥|令牌|秘钥)\s*(?:是|为|[:：=])\s*[^\s，。；,;]{4,}/,
];

/**
 * 检测并拒绝秘密信息。宁可误拒，也不让秘密进入长期记忆。
 * @param {string} text
 * @throws {SecretDetectedError}
 */
export function assertNoSecrets(text) {
  const value = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) throw new SecretDetectedError();
  }
}

/** 从正文提取一句话概述。 */
export function deriveSummary(content) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = /^(.{1,100}?[。！？!?])/.exec(text);
  return oneLine(match ? match[1] : text, 80);
}

/** 固定 +08:00 的 ISO 时间，保证跨进程稳定。 */
export function formatIsoWithOffset(date, offsetMinutes = 480) {
  const value = date instanceof Date ? date : new Date(date);
  const shifted = new Date(value.getTime() + offsetMinutes * 60_000);
  const iso = shifted.toISOString().slice(0, 19);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${iso}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/** 渲染单条原始记忆块。正文每行缩进两个空格，避免与下一个条目冲突。 */
export function renderEntry(entry) {
  const meta = [
    `## ${entry.id}`,
    `- 创建: ${entry.createdAt}`,
    `- 标签: ${(entry.tags ?? []).join(', ')}`,
    `- 来源: ${entry.source ?? ''}`,
    `- 上下文: ${entry.context ?? ''}`,
    `- 概述: ${oneLine(entry.summary ?? '', 120)}`,
    `- 重要度: ${entry.importance ?? 1}`,
  ];
  if (entry.updatedAt && entry.updatedAt !== entry.createdAt) meta.push(`- 更新: ${entry.updatedAt}`);
  if (entry.sourceType) meta.push(`- 来源类型: ${oneLine(entry.sourceType, 40)}`);
  if (entry.curatorOp) meta.push(`- 策展操作: ${oneLine(entry.curatorOp, 40)}`);
  if (entry.mergedFrom?.length) meta.push(`- 合并自: ${entry.mergedFrom.join(', ')}`);
  if (entry.trace) meta.push(`- 溯源: ${oneLine(entry.trace, 240)}`);
  if (entry.quote) meta.push(`- 引文: ${oneLine(entry.quote, 400)}`);
  if (entry.quoteHash) meta.push(`- 引文哈希: ${entry.quoteHash}`);
  if (Array.isArray(entry.evidence) && entry.evidence.length > 0) {
    meta.push(`- 证据: ${JSON.stringify(entry.evidence)}`);
  }
  if (entry.status === 'deleted') {
    meta.push('- 状态: deleted', `- 删除于: ${entry.deletedAt ?? ''}`, `- 删除原因: ${oneLine(entry.deleteReason ?? '', 120)}`);
  }
  meta.push('- 正文:');
  const content = String(entry.content ?? '').replace(/\r\n?/g, '\n');
  for (const line of content.split('\n')) meta.push(`  ${line}`);
  return meta.join('\n');
}

function emptyEntry(id) {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    tags: [],
    source: '',
    context: '',
    summary: '',
    importance: 1,
    content: '',
    status: 'active',
    deletedAt: '',
    deleteReason: '',
    trace: '',
    quote: '',
    quoteHash: '',
    sourceType: '',
    curatorOp: '',
    mergedFrom: [],
    evidence: [],
  };
}

function parseEvidence(raw) {
  if (!raw) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('证据字段不是合法 JSON');
  }
  if (!Array.isArray(value)) throw new Error('证据字段必须是数组');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('证据项必须是对象');
    const sessionId = oneLine(String(item.sessionId ?? item.session ?? ''), 120);
    const turn = Number.parseInt(String(item.turn ?? ''), 10);
    const seqStart = Number.parseInt(String(item.seqStart ?? item.seq ?? ''), 10);
    const seqEnd = Number.parseInt(String(item.seqEnd ?? item.seq ?? ''), 10);
    const quote = oneLine(String(item.quote ?? ''), 400);
    const quoteHash = String(item.quoteHash ?? (quote ? sha256(quote) : ''));
    if (!sessionId) throw new Error('证据缺少 sessionId');
    if (!Number.isInteger(turn) || turn < 1) throw new Error('证据 turn 非法');
    if (!Number.isInteger(seqStart) || seqStart < 0) throw new Error('证据 seqStart 非法');
    if (!Number.isInteger(seqEnd) || seqEnd < seqStart) throw new Error('证据 seqEnd 非法');
    if (!quote) throw new Error('证据缺少引文');
    return { sessionId, turn, seqStart, seqEnd, quote, quoteHash };
  });
}

function parseEntryBlock(lines, id) {
  const entry = emptyEntry(id);
  let bodyLines = null;
  for (const line of lines) {
    if (bodyLines !== null && line.startsWith('  ')) {
      bodyLines.push(line.slice(2));
      continue;
    }
    if (line === '') {
      if (bodyLines !== null && bodyLines.length > 0) bodyLines.push('');
      continue;
    }
    const meta = /^- ([^:：]+)[:：]\s?(.*)$/.exec(line);
    if (!meta) continue;
    const key = meta[1].trim();
    const value = meta[2];
    switch (key) {
      case '创建': entry.createdAt = value.trim(); break;
      case '更新': entry.updatedAt = value.trim(); break;
      case '标签': entry.tags = normalizeTags(value); break;
      case '来源': entry.source = value.trim(); break;
      case '上下文': entry.context = value.trim(); break;
      case '概述': entry.summary = value.trim(); break;
      case '重要度': {
        const n = Number.parseInt(value, 10);
        entry.importance = Number.isInteger(n) ? Math.max(0, Math.min(3, n)) : 1;
        break;
      }
      case '正文': bodyLines = []; break;
      case '状态': entry.status = value.trim().toLowerCase() === 'deleted' ? 'deleted' : 'active'; break;
      case '删除于': entry.deletedAt = value.trim(); break;
      case '删除原因': entry.deleteReason = value.trim(); break;
      case '溯源': entry.trace = value.trim(); break;
      case '引文': entry.quote = value.trim(); break;
      case '引文哈希': entry.quoteHash = value.trim(); break;
      case '来源类型': entry.sourceType = value.trim(); break;
      case '策展操作': entry.curatorOp = value.trim(); break;
      case '合并自': entry.mergedFrom = normalizeTags(value); break;
      case '证据': entry.evidence = parseEvidence(value.trim()); break;
      default: break;
    }
  }
  if (!entry.createdAt) throw new Error(`记忆 ${id} 缺少创建时间`);
  if (bodyLines === null) throw new Error(`记忆 ${id} 缺少正文`);
  entry.content = bodyLines.join('\n').replace(/\s+$/u, '');
  if (!entry.content) throw new Error(`记忆 ${id} 正文为空`);
  entry.importance = Number.isInteger(entry.importance) ? entry.importance : 1;
  if (!entry.updatedAt) entry.updatedAt = entry.createdAt;
  return entry;
}

/**
 * 逐块解析，坏块进入 errors，不影响其它块。
 * @param {string} text
 * @returns {{entries: Array<object>, errors: Array<{id:string,reason:string,index:number}>}}
 */
export function parseEntriesDetailed(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = ANY_HEADING_RE.exec(line);
    if (heading) {
      if (current) current.end = index;
      const id = ENTRY_HEADING_RE.exec(line)?.[1] ?? '';
      current = { id, start: index, end: lines.length, lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  const entries = [];
  const errors = [];
  const seen = new Set();
  for (const block of blocks) {
    if (!block.id) {
      errors.push({ id: '', reason: '记忆标题不是合法的 mem-xxxxxxxx', index: block.start + 1 });
      continue;
    }
    if (seen.has(block.id)) {
      errors.push({ id: block.id, reason: '记忆 ID 重复', index: block.start + 1 });
      continue;
    }
    try {
      const entry = parseEntryBlock(block.lines, block.id);
      seen.add(block.id);
      entries.push(entry);
    } catch (error) {
      errors.push({ id: block.id, reason: String(error?.message ?? error), index: block.start + 1 });
    }
  }
  return { entries, errors };
}

/** 严格解析：遇到坏块直接报错，供需要完整性的调用方使用。 */
export function parseEntries(text) {
  const { entries, errors } = parseEntriesDetailed(text);
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(`${first.reason}（第 ${first.index} 行${first.id ? `，${first.id}` : ''}）`);
  }
  return entries;
}

/** 按创建时间升序、ID 升序稳定排序。 */
export function compareEntriesAsc(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rawDocument(entries) {
  const blocks = entries.map(renderEntry).join('\n\n');
  return `${RAW_HEADER}\n${blocks ? `\n${blocks}\n` : ''}`;
}

function archiveDocument(entries) {
  const blocks = entries.map(renderEntry).join('\n\n');
  return `${ARCHIVE_HEADER}\n${blocks ? `\n${blocks}\n` : ''}`;
}

const isActiveEntry = (entry) => entry.status !== 'deleted';
const isDeletedEntry = (entry) => entry.status === 'deleted';

function summaryDocument(text) {
  const body = String(text ?? '').trim();
  return `${SUMMARY_HEADER}\n${body ? `\n${body}\n` : ''}`;
}

function stripHeader(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !line.startsWith('<!-- feiyu-summary v1'))
    .join('\n')
    .trim();
}

function parseJsonLines(text) {
  const out = [];
  const errors = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      errors.push(line);
    }
  }
  return { records: out, errors };
}

/**
 * 基于文件的记忆库。
 */
export class MemoryStore {
  /**
   * @param {{
   *   memoryDir: string,
   *   globalMemoryDir?: string,
   *   maxActiveMemories?: number,
   *   rawArchiveMaxBytes?: number,
   *   keepSummaryVersions?: number,
   *   maxContentBytes?: number,
   *   utcOffsetMinutes?: number,
   *   now?: () => Date,
   *   idFactory?: () => string,
   *   logger?: {warn?: Function, info?: Function},
   * }} options
   */
  constructor(options) {
    if (!options?.memoryDir) throw new TypeError('MemoryStore: memoryDir 必填');
    this.memoryDir = path.resolve(options.memoryDir);
    this.globalMemoryDir = options.globalMemoryDir ? path.resolve(options.globalMemoryDir) : '';
    this.maxActiveMemories = options.maxActiveMemories ?? 200;
    this.rawArchiveMaxBytes = options.rawArchiveMaxBytes ?? 300000;
    this.keepSummaryVersions = options.keepSummaryVersions ?? 30;
    this.maxContentBytes = options.maxContentBytes ?? 36000;
    this.utcOffsetMinutes = options.utcOffsetMinutes ?? 480;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `mem-${randomBytes(4).toString('hex')}`);
    this.logger = options.logger;

    this.rawFile = path.join(this.memoryDir, 'raw_memories.md');
    this.summaryFile = path.join(this.memoryDir, 'memory_summary.md');
    this.stateFile = path.join(this.memoryDir, 'state.json');
    this.stateBackupFile = path.join(this.memoryDir, 'state.json.bak');
    this.journalFile = path.join(this.memoryDir, 'journal.jsonl');
    this.archiveDir = path.join(this.memoryDir, 'archive');
    this.archiveFile = path.join(this.archiveDir, 'raw_memories.md');
    this.historyDir = path.join(this.memoryDir, 'summary_history');
    this.summaryIndexFile = path.join(this.historyDir, 'index.json');
    this.revisionsFile = path.join(this.memoryDir, 'revisions.jsonl');
    this.tombstonesFile = path.join(this.memoryDir, 'tombstones.jsonl');
    this.corruptDir = path.join(this.memoryDir, 'corrupt');
    this.diagnosticsFile = path.join(this.memoryDir, 'parse-diagnostics.json');
    this.globalSummaryFile = this.globalMemoryDir ? path.join(this.globalMemoryDir, 'memory_summary.md') : '';

    this._queue = Promise.resolve();
    this._tempCounter = 0;
    this._initialized = false;
    this._state = null;
    this._tombstones = new Map();
    this.parseErrors = { raw: [], archive: [] };
    this.stateRecovery = null;
    this._lastParseIssueHash = '';
    this._lastParseIssue = null;
  }

  /** 初始化空目录与空文件。可重复调用。 */
  async init() {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });
    await fs.mkdir(this.historyDir, { recursive: true });
    await this._ensureFile(this.rawFile, `${RAW_HEADER}\n`);
    await this._ensureFile(this.archiveFile, `${ARCHIVE_HEADER}\n`);
    await this._ensureFile(this.summaryFile, `${SUMMARY_HEADER}\n`);
    await this._ensureFile(this.journalFile, '');
    await this._ensureFile(this.revisionsFile, '');
    await this._ensureFile(this.tombstonesFile, '');
    if (this.globalSummaryFile) {
      await fs.mkdir(this.globalMemoryDir, { recursive: true });
      await this._ensureFile(this.globalSummaryFile, `${SUMMARY_HEADER}\n`);
    }
    this._state = await this._readState();
    await this._loadTombstones();
    await this._reconcile();
    await this._repairDuplicates();
    this.summaryIndexState = await this.summaryIndexReport().catch((error) => ({
      ok: false,
      error: String(error?.message ?? error),
      files: [],
      entries: {},
      missing: [],
      extra: [],
      mismatched: [],
    }));
    if (!this.summaryIndexState.ok) {
      this.logger?.warn?.('[dsh-memory-feiyu] summary_history 索引与版本文件不一致；编辑/回滚/新增长期记忆写入已暂停，请先运行 repair-summary-index');
    }
    this._initialized = true;
    return this;
  }

  async _ensureFile(file, fallback) {
    try {
      const stat = await fs.stat(file);
      if (stat.isFile()) return;
      await fs.writeFile(file, fallback, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await fs.writeFile(file, fallback, 'utf8');
    }
  }

  _exclusive(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _atomicWrite(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${++this._tempCounter}.tmp`);
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tmp, file);
    } catch {
      await fs.copyFile(tmp, file);
      await fs.rm(tmp, { force: true });
    }
  }

  async _readState() {
    let text = '';
    try {
      text = await fs.readFile(this.stateFile, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return { ...DEFAULT_STATE, tombstones: [] };
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('state.json 不是对象');
      return {
        ...DEFAULT_STATE,
        ...parsed,
        version: 2,
        tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
      };
    } catch (error) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const corruptFile = path.join(this.memoryDir, `state.corrupt-${stamp}.json`);
      try {
        await fs.copyFile(this.stateFile, corruptFile);
      } catch {
        // 保留失败不阻塞恢复。
      }
      let fallback = null;
      let source = 'defaults';
      try {
        const backup = JSON.parse(await fs.readFile(this.stateBackupFile, 'utf8'));
        if (backup && typeof backup === 'object' && !Array.isArray(backup)) {
          fallback = backup;
          source = 'state.json.bak';
        }
      } catch {
        // 没有可用备份时走磁盘对账。
      }
      this.stateRecovery = {
        at: new Date().toISOString(),
        reason: String(error?.message ?? error),
        corruptFile,
        source,
      };
      this.logger?.warn?.(`[dsh-memory-feiyu] state.json 损坏，已隔离到 ${corruptFile}，从 ${source} 恢复`);
      return {
        ...DEFAULT_STATE,
        ...(fallback ?? {}),
        summaryMode: fallback?.summaryMode === 'auto' || fallback?.summaryMode === 'manual' ? fallback.summaryMode : 'manual',
        tombstones: Array.isArray(fallback?.tombstones) ? fallback.tombstones : [],
      };
    }
  }

  async _writeState(patch = {}) {
    this._state = { ...(this._state ?? DEFAULT_STATE), ...patch, version: 2 };
    const text = `${JSON.stringify(this._state, null, 2)}\n`;
    await this._atomicWrite(this.stateFile, text);
    try {
      await fs.writeFile(this.stateBackupFile, text, 'utf8');
    } catch {
      // 备份写失败不阻塞主状态。
    }
  }

  async _appendTombstone(entry, op = 'delete') {
    const record = op === 'restore'
      ? { op, id: entry.id, at: formatIsoWithOffset(this.now(), this.utcOffsetMinutes) }
      : {
        op,
        id: entry.id,
        hash: contentFingerprint(entry.content),
        at: entry.deletedAt || formatIsoWithOffset(this.now(), this.utcOffsetMinutes),
      };
    await fs.appendFile(this.tombstonesFile, `${JSON.stringify(record)}\n`, 'utf8');
    if (op === 'restore') this._tombstones.delete(entry.id);
    else this._tombstones.set(entry.id, record);
    await this._writeState({ tombstones: [...this._tombstones.values()] });
  }

  async _removeTombstone(id) {
    await fs.appendFile(this.tombstonesFile, `${JSON.stringify({ op: 'restore', id, at: formatIsoWithOffset(this.now(), this.utcOffsetMinutes) })}\n`, 'utf8');
    this._tombstones.delete(id);
    await this._writeState({ tombstones: [...this._tombstones.values()] });
  }

  async _loadTombstones() {
    this._tombstones = new Map();
    try {
      const text = await fs.readFile(this.tombstonesFile, 'utf8');
      for (const record of parseJsonLines(text).records) {
        if (!record || typeof record.id !== 'string') continue;
        if (record.op === 'restore') this._tombstones.delete(record.id);
        else if (record.op === 'delete' || record.op === 'tombstone') {
          this._tombstones.set(record.id, {
            id: record.id,
            hash: String(record.hash ?? ''),
            at: String(record.at ?? ''),
          });
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    // 兼容旧版：state.tombstones 里可能有尚未落到新日志的记录。
    for (const item of Array.isArray(this._state?.tombstones) ? this._state.tombstones : []) {
      if (!item?.id || this._tombstones.has(item.id)) continue;
      this._tombstones.set(item.id, { id: item.id, hash: String(item.hash ?? ''), at: String(item.at ?? '') });
    }
  }

  async _reconcile() {
    const changed = [];
    const raw = await this.listRaw();
    const archived = await this.listArchived();
    const deleted = [...raw, ...archived].filter(isDeletedEntry);
    for (const entry of deleted) {
      if (!this._tombstones.has(entry.id)) {
        this._tombstones.set(entry.id, {
          id: entry.id,
          hash: contentFingerprint(entry.content),
          at: entry.deletedAt || '',
        });
        changed.push(`tombstone:${entry.id}`);
      }
    }
    const activeIds = new Set([...raw, ...archived].filter(isActiveEntry).map((entry) => entry.id));
    for (const id of [...this._tombstones.keys()]) {
      if (activeIds.has(id)) this._tombstones.delete(id);
    }

    const versions = await this.listSummaryVersions();
    const maxVersion = versions.reduce((max, name) => {
      const match = SUMMARY_VERSION_RE.exec(name);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const summaryVersion = Math.max(Number(this._state?.summaryVersion) || 0, maxVersion);
    let revisionSeq = Number(this._state?.revisionSeq) || 0;
    for (const record of parseJsonLines(await this._readText(this.revisionsFile)).records) {
      if (Number.isInteger(record?.seq)) revisionSeq = Math.max(revisionSeq, record.seq);
      const match = /^rev-(\d+)$/.exec(String(record?.rev ?? ''));
      if (match) revisionSeq = Math.max(revisionSeq, Number(match[1]));
    }
    const patch = {};
    if (summaryVersion !== this._state?.summaryVersion) patch.summaryVersion = summaryVersion;
    if (revisionSeq !== this._state?.revisionSeq) patch.revisionSeq = revisionSeq;
    if (this._state?.summaryMode !== 'auto' && this._state?.summaryMode !== 'manual') patch.summaryMode = 'manual';
    if (this.stateRecovery) patch.tombstones = [...this._tombstones.values()];
    if (changed.length > 0) patch.tombstones = [...this._tombstones.values()];
    if (Object.keys(patch).length > 0) await this._writeState(patch);
  }

  /**
   * 修复「同一条记忆同时出现在 raw 和 archive」的残留。
   * 以 raw 为准；有坏块时不改写，避免把坏数据覆盖掉。
   */
  async _repairDuplicates() {
    if (this.parseErrors.raw.length > 0 || this.parseErrors.archive.length > 0) return;
    try {
      const raw = await this.listRaw();
      const rawIds = new Set(raw.map((entry) => entry.id));
      if (rawIds.size === 0) return;
      const archived = await this.listArchived();
      const duplicated = archived.filter((entry) => rawIds.has(entry.id));
      if (duplicated.length === 0) return;
      await this._atomicWrite(this.archiveFile, archiveDocument(archived.filter((entry) => !rawIds.has(entry.id))));
      for (const entry of duplicated) await this.journal({ op: 'repair-duplicate', id: entry.id });
    } catch {
      // 修复失败不阻塞启动。
    }
  }

  async _readText(file) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
  }

  /** 追加 journal；不记录正文，避免秘密二次落盘。 */
  async journal(event) {
    const record = { ts: new Date().toISOString(), ...event };
    await fs.appendFile(this.journalFile, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async _readParsed(file, kind) {
    const text = await this._readText(file);
    const result = parseEntriesDetailed(text);
    this.parseErrors[kind] = result.errors;
    if (result.errors.length > 0) await this._recordParseIssue(kind, file, text, result.errors);
    return result.entries;
  }

  async _recordParseIssue(kind, file, text, errors) {
    const hash = sha256(text);
    if (this._lastParseIssueHash === hash && this._lastParseIssue === kind) return;
    this._lastParseIssueHash = hash;
    this._lastParseIssue = kind;
    try {
      await fs.mkdir(this.corruptDir, { recursive: true });
      const quarantine = path.join(this.corruptDir, `${kind}-${hash.slice(0, 16)}.md`);
      try {
        await fs.access(quarantine);
      } catch {
        await fs.writeFile(quarantine, text, 'utf8');
      }
      let diagnostics = {};
      try {
        diagnostics = JSON.parse(await fs.readFile(this.diagnosticsFile, 'utf8'));
      } catch {
        diagnostics = {};
      }
      diagnostics.version = 1;
      diagnostics.updatedAt = new Date().toISOString();
      diagnostics.files = diagnostics.files ?? {};
      diagnostics.files[kind] = {
        file: path.basename(file),
        hash,
        quarantine: path.basename(quarantine),
        errors: errors.map((item) => ({ id: item.id, reason: item.reason, line: item.index })),
      };
      await this._atomicWrite(this.diagnosticsFile, `${JSON.stringify(diagnostics, null, 2)}\n`);
      await this.journal({ op: 'parse-error', file: kind, count: errors.length, hash: hash.slice(0, 16) });
      this.logger?.warn?.(`[dsh-memory-feiyu] ${kind} 有 ${errors.length} 条损坏记录，已隔离；写操作会拒绝以避免覆盖`);
    } catch {
      // 诊断写失败不应让读取失败。
    }
  }

  _assertWritable() {
    const total = this.parseErrors.raw.length + this.parseErrors.archive.length;
    if (total > 0) {
      const error = new Error(`记忆文件有 ${total} 条损坏记录，已拒绝覆盖原文件；请先修复或移走损坏块。诊断见 parse-diagnostics.json`);
      error.code = 'MEMORY_CORRUPT';
      error.parseErrors = this.parseErrors;
      throw error;
    }
  }

  /** 读取 raw 文件中的全部条目（含软删除）。 */
  async listRaw() {
    return this._readParsed(this.rawFile, 'raw');
  }

  /** 读取活动记忆；软删除的条目不会出现在这里。 */
  async listActive() {
    return (await this.listRaw()).filter(isActiveEntry);
  }

  /** 读取已软删除的条目，供设置页查看和恢复。 */
  async listDeleted() {
    const raw = (await this.listRaw()).filter(isDeletedEntry);
    const archived = (await this.listArchived()).filter(isDeletedEntry);
    return [...raw, ...archived];
  }

  /** 读取归档记忆。 */
  async listArchived() {
    return this._readParsed(this.archiveFile, 'archive');
  }

  /** 读取全部记忆；默认含归档、不含软删除。 */
  async listAll(includeArchived = true, includeDeleted = false) {
    const raw = await this.listRaw();
    const entries = includeDeleted ? raw : raw.filter(isActiveEntry);
    if (!includeArchived) return entries;
    const archived = await this.listArchived();
    return [...entries, ...archived.filter((entry) => includeDeleted || isActiveEntry(entry))];
  }

  /** 按 ID 读取完整原始记录；软删除的条目也能读到，供恢复使用。 */
  async get(id, includeArchived = true) {
    const needle = String(id ?? '').trim();
    if (!needle) return undefined;
    const all = await this.listAll(includeArchived, true);
    return all.find((entry) => entry.id === needle);
  }

  /** 检索原始记忆，结果包含完整记录和 ID。软删除条目默认不参与检索。 */
  async search(query, options = {}) {
    const entries = await this.listAll(options.includeArchived !== false, options.includeDeleted === true);
    return searchMemories(entries, { ...options, query });
  }

  /** 当前墓碑列表（不含正文）。 */
  tombstones() {
    return [...this._tombstones.values()];
  }

  /** 兼容旧接口。 */
  _tombstonesList() {
    return this.tombstones();
  }

  _findTombstoneByHash(hash) {
    for (const item of this._tombstones.values()) {
      if (item.hash === hash) return item;
    }
    return undefined;
  }

  _deletedFingerprints(entries) {
    const map = new Map();
    for (const entry of entries) {
      if (isDeletedEntry(entry)) map.set(contentFingerprint(entry.content), entry);
    }
    return map;
  }

  _assertEvidence(evidence) {
    if (evidence === undefined) return [];
    if (!Array.isArray(evidence)) throw new TypeError('evidence 必须是数组');
    return evidence.map((item) => {
      if (!item || typeof item !== 'object') throw new TypeError('evidence 项必须是对象');
      const sessionId = oneLine(String(item.sessionId ?? item.session ?? ''), 120);
      const turn = Number.parseInt(String(item.turn ?? ''), 10);
      const seqStart = Number.parseInt(String(item.seqStart ?? item.seq ?? ''), 10);
      const seqEnd = Number.parseInt(String(item.seqEnd ?? item.seq ?? ''), 10);
      const quote = oneLine(String(item.quote ?? ''), 400);
      if (!sessionId || !Number.isInteger(turn) || turn < 1 || !Number.isInteger(seqStart) || !Number.isInteger(seqEnd) || seqEnd < seqStart || !quote) {
        throw new TypeError('evidence 字段不完整');
      }
      assertNoSecrets(quote);
      return { sessionId, turn, seqStart, seqEnd, quote, quoteHash: sha256(quote) };
    });
  }

  /**
   * 新增一条原始记忆。
   * @param {{content:string, tags?:string|string[], summary?:string, source?:string, context?:string, importance?:number, createdAt?:string, trace?:string, quote?:string, evidence?:Array, sourceType?:string, curatorOp?:string, dedupe?:boolean}} input
   */
  async add(input) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      const content = String(input?.content ?? '').trim();
      if (!content) throw new TypeError('记忆正文不能为空');
      if (byteLength(content) > this.maxContentBytes) {
        throw new Error(`记忆正文超过 ${this.maxContentBytes} 字节上限`);
      }
      const summary = oneLine(input.summary ? String(input.summary) : deriveSummary(content), 120);
      const tags = normalizeTags(input.tags);
      const source = oneLine(input.source ?? 'conversation', 120);
      const context = oneLine(input.context ?? '', 200);
      const trace = oneLine(String(input.trace ?? ''), 240);
      const quote = oneLine(String(input.quote ?? ''), 400);
      const evidence = this._assertEvidence(input.evidence);
      assertNoSecrets([content, summary, tags.join(','), source, context, trace, quote].join('\n'));
      const fingerprint = contentFingerprint(content);
      const blocked = this._findTombstoneByHash(fingerprint);
      const existing = await this.listAll(true, true);
      const deletedMatch = existing.find((entry) => isDeletedEntry(entry) && contentFingerprint(entry.content) === fingerprint);
      if (blocked || deletedMatch) {
        const blockedId = blocked?.id ?? deletedMatch?.id ?? '';
        const error = new Error(`这条事实已被主人删除（${blockedId}）；如需重新启用，请用 memory_restore("${blockedId}")`);
        error.code = 'TOMBSTONED';
        error.memoryId = blockedId;
        throw error;
      }
      if (input.dedupe) {
        const duplicate = existing.find((entry) => isActiveEntry(entry) && contentFingerprint(entry.content) === fingerprint);
        if (duplicate) {
          const error = new Error(`相同正文的记忆已存在（${duplicate.id}），未重复创建`);
          error.code = 'DUPLICATE_MEMORY';
          error.memoryId = duplicate.id;
          throw error;
        }
      }

      const ids = new Set(existing.map((entry) => entry.id));
      let id = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = this.idFactory();
        if (!ENTRY_ID_RE.test(candidate)) throw new Error('idFactory 必须生成 mem-xxxxxxxx 格式的 ID');
        if (!ids.has(candidate)) { id = candidate; break; }
      }
      if (!id) throw new Error('无法生成唯一记忆 ID');

      const createdAt = input.createdAt ? String(input.createdAt) : formatIsoWithOffset(this.now(), this.utcOffsetMinutes);
      const quoteHash = quote ? sha256(quote) : '';
      const entry = {
        id,
        createdAt,
        updatedAt: createdAt,
        tags,
        source,
        context,
        summary,
        importance: Math.max(0, Math.min(3, Number.parseInt(String(input.importance ?? 1), 10) || 0)),
        content,
        status: 'active',
        deletedAt: '',
        deleteReason: '',
        trace,
        quote,
        quoteHash,
        sourceType: oneLine(String(input.sourceType ?? 'manual'), 40),
        curatorOp: oneLine(String(input.curatorOp ?? ''), 40),
        mergedFrom: [],
        evidence,
      };

      const currentText = await this._readText(this.rawFile);
      const base = currentText.trimEnd();
      const next = `${base || RAW_HEADER}\n\n${renderEntry(entry)}\n`;
      await this._atomicWrite(this.rawFile, next);
      await this._writeState({ totalAdded: (this._state?.totalAdded ?? 0) + 1 });
      await this.journal({ op: 'add', id, tagCount: tags.length, bytes: byteLength(content), sourceType: entry.sourceType });
      await this._enforceLimits();
      return entry;
    });
  }

  /**
   * 活动条数或活动文件超限时，把最旧的 active 条目移入 archive。
   * 软删除条目仍保留在 raw，不计入 active 容量。
   */
  async _enforceLimits() {
    this._assertWritable();
    let entries = await this.listRaw();
    let active = entries.filter(isActiveEntry);
    const overflow = () => active.length > this.maxActiveMemories || byteLength(rawDocument(entries)) > this.rawArchiveMaxBytes;
    if (!overflow()) return { archived: 0 };

    active.sort(compareEntriesAsc);
    const archived = [];
    while (active.length > 0 && overflow()) {
      const oldest = active.shift();
      const index = entries.findIndex((entry) => entry.id === oldest.id);
      if (index >= 0) entries.splice(index, 1);
      archived.push(oldest);
    }
    if (archived.length === 0) return { archived: 0 };

    const archiveText = await this._readText(this.archiveFile);
    const archiveBase = archiveText.trimEnd() || ARCHIVE_HEADER;
    const archiveNext = `${archiveBase}\n\n${archived.map(renderEntry).join('\n\n')}\n`;
    await this._atomicWrite(this.archiveFile, archiveNext);
    await this._atomicWrite(this.rawFile, rawDocument(entries));
    for (const entry of archived) await this.journal({ op: 'archive', id: entry.id });
    return { archived: archived.length };
  }

  /**
   * 校验一条记忆的引文指纹，判断引文是否被改写。
   * @returns {'verified'|'missing-quote'|'missing-hash'|'mismatch'}
   */
  static verifyQuote(entry) {
    if (!entry?.quote) return 'missing-quote';
    if (!entry?.quoteHash) return 'missing-hash';
    const actual = sha256(String(entry.quote));
    return actual === entry.quoteHash ? 'verified' : 'mismatch';
  }

  async _nextRevisionSeq() {
    const next = (Number(this._state?.revisionSeq) || 0) + 1;
    await this._writeState({ revisionSeq: next });
    return next;
  }

  /** 追加一条修改前快照；使用稳定 rev 标识，不再依赖数组序号。 */
  async _appendRevision(record) {
    const seq = await this._nextRevisionSeq();
    const rev = `rev-${String(seq).padStart(6, '0')}`;
    const payload = { ...record, rev, seq };
    await fs.appendFile(this.revisionsFile, `${JSON.stringify(payload)}\n`, 'utf8');
    const text = await this._readText(this.revisionsFile);
    const lines = text.split('\n').filter(Boolean);
    if (lines.length > 500) {
      await this._atomicWrite(this.revisionsFile, `${lines.slice(-500).join('\n')}\n`);
    }
    return payload;
  }

  /**
   * 读取某条记忆的修改历史，返回修改前快照。
   * @param {string} id
   */
  async revisions(id) {
    const needle = String(id ?? '').trim();
    const text = await this._readText(this.revisionsFile);
    const list = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (record?.id === needle && record?.previous) list.push(record);
      } catch {
        // 损坏的行跳过，不影响其它记录。
      }
    }
    return list.map((record, index) => ({
      ...record,
      rev: record.rev || `legacy-${String(index + 1).padStart(6, '0')}`,
    }));
  }

  /**
   * 修改一条活动记忆的正文、概述、标签或溯源；修改前自动留快照。
   * @param {string} id
   * @param {{content?:string, summary?:string, tags?:string|string[], trace?:string, quote?:string, evidence?:Array, sourceType?:string, curatorOp?:string, mergedFrom?:Array}} patch
   * @param {string} [reason]
   */
  async update(id, patch = {}, reason = '') {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      const needle = String(id ?? '').trim();
      if (!ENTRY_ID_RE.test(needle)) throw new TypeError('记忆 ID 必须是 mem-xxxxxxxx 格式');

      const rawEntries = await this.listRaw();
      const index = rawEntries.findIndex((entry) => entry.id === needle);
      if (index < 0) {
        const inArchive = (await this.listArchived()).some((entry) => entry.id === needle);
        throw new Error(inArchive ? `记忆 ${needle} 在归档区，暂不支持编辑` : `没有找到记忆 ${needle}`);
      }
      const current = rawEntries[index];
      if (current.status === 'deleted') throw new Error(`记忆 ${needle} 已被删除，请先 memory_restore 再编辑`);

      const next = { ...current };
      const changed = [];

      if (patch.content !== undefined) {
        const content = String(patch.content ?? '').trim();
        if (!content) throw new TypeError('正文不能为空');
        if (byteLength(content) > this.maxContentBytes) throw new Error(`记忆正文超过 ${this.maxContentBytes} 字节上限`);
        assertNoSecrets(content);
        if (content !== current.content) {
          const fingerprint = contentFingerprint(content);
          const blocked = this._findTombstoneByHash(fingerprint);
          const deleted = (await this.listAll(true, true)).find((entry) => isDeletedEntry(entry) && contentFingerprint(entry.content) === fingerprint);
          if (blocked || deleted) {
            const blockedId = blocked?.id ?? deleted?.id ?? '';
            const error = new Error(`这条事实已被删除（${blockedId}），不能把正文改成它`);
            error.code = 'TOMBSTONED';
            error.memoryId = blockedId;
            throw error;
          }
          next.content = content;
          changed.push('content');
        }
      }
      if (patch.summary !== undefined) {
        const summary = oneLine(String(patch.summary ?? ''), 120);
        assertNoSecrets(summary);
        if (summary !== current.summary) { next.summary = summary; changed.push('summary'); }
      }
      if (patch.tags !== undefined) {
        const tags = normalizeTags(patch.tags);
        assertNoSecrets(tags.join(','));
        if (tags.join('\u0000') !== current.tags.join('\u0000')) { next.tags = tags; changed.push('tags'); }
      }
      if (patch.trace !== undefined) {
        const trace = oneLine(String(patch.trace ?? ''), 240);
        assertNoSecrets(trace);
        if (trace !== (current.trace ?? '')) { next.trace = trace; changed.push('trace'); }
      }
      if (patch.quote !== undefined) {
        const quote = oneLine(String(patch.quote ?? ''), 400);
        if (quote) assertNoSecrets(quote);
        if (quote !== (current.quote ?? '')) {
          next.quote = quote;
          next.quoteHash = quote ? sha256(quote) : '';
          changed.push('quote');
        }
      }
      if (patch.evidence !== undefined) {
        const evidence = this._assertEvidence(patch.evidence);
        if (JSON.stringify(evidence) !== JSON.stringify(current.evidence ?? [])) {
          next.evidence = evidence;
          changed.push('evidence');
        }
      }
      if (patch.sourceType !== undefined) {
        const value = oneLine(String(patch.sourceType), 40);
        assertNoSecrets(value);
        if (value !== (current.sourceType ?? '')) { next.sourceType = value; changed.push('sourceType'); }
      }
      if (patch.curatorOp !== undefined) {
        const value = oneLine(String(patch.curatorOp), 40);
        if (value !== (current.curatorOp ?? '')) { next.curatorOp = value; changed.push('curatorOp'); }
      }
      if (patch.mergedFrom !== undefined) {
        const value = normalizeTags(patch.mergedFrom);
        if (value.join('\u0000') !== (current.mergedFrom ?? []).join('\u0000')) {
          next.mergedFrom = value;
          changed.push('mergedFrom');
        }
      }

      if (changed.length === 0) return { changed: false, entry: current, fields: [] };

      await this._appendRevision({
        ts: formatIsoWithOffset(this.now(), this.utcOffsetMinutes),
        id: needle,
        reason: oneLine(String(reason ?? ''), 120),
        changed,
        previous: current,
      });
      next.updatedAt = formatIsoWithOffset(this.now(), this.utcOffsetMinutes);
      rawEntries[index] = next;
      await this._atomicWrite(this.rawFile, rawDocument(rawEntries));
      await this.journal({ op: 'update', id: needle, fields: changed });
      return { changed: true, entry: next, fields: changed };
    });
  }

  /**
   * 把一条记忆回退到某次修改之前的快照。
   * @param {string} id
   * @param {number|string} [version] 稳定 rev（rev-000001）或该记忆历史里的序号（从 1 开始）
   */
  async revert(id, version) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      const needle = String(id ?? '').trim();
      if (!ENTRY_ID_RE.test(needle)) throw new TypeError('记忆 ID 必须是 mem-xxxxxxxx 格式');
      const list = await this.revisions(needle);
      if (list.length === 0) throw new Error(`记忆 ${needle} 没有修改历史`);

      let pick = list[list.length - 1];
      let versionLabel = `latest(${list.length})`;
      if (version !== undefined && version !== null && String(version).trim() !== '') {
        const rawVersion = String(version).trim();
        const byRev = list.find((record) => record.rev === rawVersion);
        if (byRev) {
          pick = byRev;
          versionLabel = byRev.rev;
        } else {
          const n = Number.parseInt(rawVersion, 10);
          if (!Number.isInteger(n) || n < 1 || n > list.length) {
            throw new Error(`版本必须是 rev-xxxxxx 或 1～${list.length} 之间的序号`);
          }
          pick = list[n - 1];
          versionLabel = String(n);
        }
      }

      const rawEntries = await this.listRaw();
      const index = rawEntries.findIndex((entry) => entry.id === needle);
      if (index < 0) throw new Error(`没有找到记忆 ${needle}`);
      const current = rawEntries[index];
      if (current.status === 'deleted') throw new Error(`记忆 ${needle} 已被删除，请先 memory_restore`);

      const targetContent = String(pick.previous.content ?? '');
      const fingerprint = contentFingerprint(targetContent);
      const blocked = this._findTombstoneByHash(fingerprint);
      const deleted = (await this.listAll(true, true)).find((entry) => isDeletedEntry(entry) && contentFingerprint(entry.content) === fingerprint);
      if (blocked || deleted) {
        const blockedId = blocked?.id ?? deleted?.id ?? '';
        const error = new Error(`回退目标包含已删除事实（${blockedId}），已拒绝；如确需恢复，请先 memory_restore`);
        error.code = 'TOMBSTONED';
        error.memoryId = blockedId;
        throw error;
      }

      const restored = {
        ...current,
        content: targetContent,
        summary: pick.previous.summary,
        tags: pick.previous.tags ?? [],
        trace: pick.previous.trace ?? '',
        quote: pick.previous.quote ?? '',
        quoteHash: pick.previous.quoteHash ?? '',
        evidence: pick.previous.evidence ?? [],
        updatedAt: formatIsoWithOffset(this.now(), this.utcOffsetMinutes),
      };

      await this._appendRevision({
        ts: formatIsoWithOffset(this.now(), this.utcOffsetMinutes),
        id: needle,
        reason: `revert to ${versionLabel}`,
        changed: ['revert'],
        previous: current,
      });
      rawEntries[index] = restored;
      await this._atomicWrite(this.rawFile, rawDocument(rawEntries));
      await this.journal({ op: 'revert', id: needle, version: versionLabel });
      return { changed: true, entry: restored, version: versionLabel };
    });
  }

  /**
   * 软删除一条记忆：保留正文与出处，只标记状态，并写入墓碑。
   * 重复删除也会补写缺失的墓碑（失败重试可修复）。
   */
  async forget(id, reason = '') {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      const needle = String(id ?? '').trim();
      if (!ENTRY_ID_RE.test(needle)) throw new TypeError('记忆 ID 必须是 mem-xxxxxxxx 格式');
      const cleanReason = oneLine(String(reason ?? ''), 120);
      assertNoSecrets(cleanReason);
      const stamp = () => formatIsoWithOffset(this.now(), this.utcOffsetMinutes);

      const rawEntries = await this.listRaw();
      const index = rawEntries.findIndex((entry) => entry.id === needle);
      if (index >= 0) {
        const entry = rawEntries[index];
        if (entry.status === 'deleted') {
          const repaired = !this._tombstones.has(entry.id);
          if (repaired) {
            await this._appendTombstone(entry);
            await this.journal({ op: 'repair-tombstone', id: entry.id });
          }
          return { changed: false, alreadyDeleted: true, repaired, entry };
        }
        entry.status = 'deleted';
        entry.deletedAt = stamp();
        entry.deleteReason = cleanReason;
        await this._atomicWrite(this.rawFile, rawDocument(rawEntries));
        await this._appendTombstone(entry);
        await this.journal({ op: 'delete', id: needle, reason: cleanReason, bytes: byteLength(entry.content) });
        return { changed: true, entry };
      }

      const archivedEntries = await this.listArchived();
      const archivedIndex = archivedEntries.findIndex((entry) => entry.id === needle);
      if (archivedIndex < 0) throw new Error(`没有找到记忆 ${needle}`);
      const archived = archivedEntries[archivedIndex];
      if (archived.status === 'deleted') {
        const repaired = !this._tombstones.has(archived.id);
        if (repaired) {
          await this._appendTombstone(archived);
          await this.journal({ op: 'repair-tombstone', id: archived.id });
        }
        return { changed: false, alreadyDeleted: true, repaired, entry: archived };
      }
      archived.status = 'deleted';
      archived.deletedAt = stamp();
      archived.deleteReason = cleanReason;
      await this._atomicWrite(this.archiveFile, archiveDocument(archivedEntries));
      await this._appendTombstone(archived);
      await this.journal({ op: 'delete', id: needle, reason: cleanReason, bytes: byteLength(archived.content) });
      return { changed: true, entry: archived };
    });
  }

  /**
   * 恢复一条软删除的记忆。重复恢复会清理残留墓碑。
   */
  async restore(id) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      const needle = String(id ?? '').trim();
      if (!ENTRY_ID_RE.test(needle)) throw new TypeError('记忆 ID 必须是 mem-xxxxxxxx 格式');

      const rawEntries = await this.listRaw();
      const index = rawEntries.findIndex((entry) => entry.id === needle);
      if (index >= 0) {
        const entry = rawEntries[index];
        if (entry.status !== 'deleted') {
          const repaired = this._tombstones.has(needle);
          if (repaired) {
            await this._removeTombstone(needle);
            await this.journal({ op: 'repair-restore', id: needle });
          }
          return { changed: false, alreadyActive: true, repaired, entry };
        }
        entry.status = 'active';
        entry.deletedAt = '';
        entry.deleteReason = '';
        await this._atomicWrite(this.rawFile, rawDocument(rawEntries));
        await this._removeTombstone(needle);
        await this.journal({ op: 'restore', id: needle });
        return { changed: true, entry };
      }

      const archivedEntries = await this.listArchived();
      const archivedIndex = archivedEntries.findIndex((entry) => entry.id === needle);
      if (archivedIndex < 0) throw new Error(`没有找到记忆 ${needle}`);
      const archived = archivedEntries[archivedIndex];
      if (archived.status !== 'deleted') {
        const repaired = this._tombstones.has(needle);
        if (repaired) {
          await this._removeTombstone(needle);
          await this.journal({ op: 'repair-restore', id: needle });
        }
        return { changed: false, alreadyActive: true, repaired, entry: archived };
      }

      const revived = { ...archived, status: 'active', deletedAt: '', deleteReason: '', updatedAt: formatIsoWithOffset(this.now(), this.utcOffsetMinutes) };
      const rawText = await this._readText(this.rawFile);
      const rawBase = rawText.trimEnd() || RAW_HEADER;
      await this._atomicWrite(this.rawFile, `${rawBase}\n\n${renderEntry(revived)}\n`);
      await this._atomicWrite(this.archiveFile, archiveDocument(archivedEntries.filter((entry) => entry.id !== needle)));
      await this._removeTombstone(needle);
      await this.journal({ op: 'restore', id: needle, from: 'archive' });
      return { changed: true, entry: revived };
    });
  }

  async _assertSummaryAllowed(body) {
    const ids = new Set([...String(body).matchAll(/\bmem-[0-9a-f]{8}\b/g)].map((match) => match[0]));
    const conflicts = new Set();
    for (const id of ids) {
      const entry = await this.get(id, true);
      if (!entry || entry.status === 'deleted') conflicts.add(id);
    }
    // 旧摘要可能没有写 ID，只保留了概述；用较长的概述做保守冲突检测，宁可拒绝也不让已删事实回流。
    for (const entry of await this.listDeleted()) {
      const phrase = oneLine(entry.summary ?? '', 80);
      if (phrase.length >= 8 && String(body).includes(phrase)) conflicts.add(entry.id);
    }
    if (conflicts.size > 0) {
      const list = [...conflicts];
      const error = new Error(`摘要引用了已删除或不存在的记忆：${list.join(', ')}；已拒绝写入，避免已删事实回到活动摘要`);
      error.code = 'SUMMARY_REFERENCES_DELETED';
      error.memoryIds = list;
      throw error;
    }
  }

  /** 只读检查 summary_history/index.json 与版本文件是否一致。 */
  async summaryIndexReport() {
    const files = await this.listSummaryVersions();
    const index = await this._readSummaryIndex();
    const fileVersions = new Set(files.map((name) => Number(SUMMARY_VERSION_RE.exec(name)[1])));
    const entryVersions = new Set(Object.keys(index.entries ?? {}).map(Number).filter(Number.isInteger));
    const missing = [...fileVersions].filter((version) => !entryVersions.has(version)).sort((a, b) => a - b);
    const extra = [...entryVersions].filter((version) => !fileVersions.has(version)).sort((a, b) => a - b);
    const mismatched = [];
    for (const version of [...fileVersions].filter((value) => entryVersions.has(value))) {
      const name = `${String(version).padStart(4, '0')}.md`;
      const entry = index.entries[String(version)];
      try {
        const body = stripHeader(await fs.readFile(path.join(this.historyDir, name), 'utf8'));
        const hash = sha256(body);
        if (entry?.hash !== hash || Number(entry?.bytes) !== byteLength(body)) {
          mismatched.push({ version, file: name, expectedHash: entry?.hash ?? '', actualHash: hash });
        }
      } catch (error) {
        mismatched.push({ version, file: name, reason: String(error?.message ?? error) });
      }
    }
    return {
      ok: missing.length === 0 && extra.length === 0 && mismatched.length === 0,
      files,
      entries: index.entries ?? {},
      maxVersion: Math.max(Number(index.maxVersion) || 0, ...fileVersions, 0),
      missing,
      extra,
      mismatched,
    };
  }

  /**
   * 安全修复 summary_history 索引：只补元数据，不删除/改写任何版本文件。
   * 写入前先备份旧 index.json，无法解析的版本文件会让整个修复中止。
   * @param {{apply?:boolean}} options
   */
  async repairSummaryIndex(options = {}) {
    const apply = options.apply === true;
    const report = await this.summaryIndexReport();
    if (apply && !this._initialized) await this.init();
    if (!apply) return { ...report, applied: false };

    const currentIndex = await this._readSummaryIndex();
    const next = { version: 1, maxVersion: 0, entries: {} };
    const errors = [];
    for (const name of report.files) {
      const version = Number(SUMMARY_VERSION_RE.exec(name)[1]);
      let body;
      try {
        body = stripHeader(await fs.readFile(path.join(this.historyDir, name), 'utf8'));
      } catch (error) {
        errors.push({ version, file: name, reason: String(error?.message ?? error) });
        continue;
      }
      const existing = currentIndex.entries?.[String(version)] ?? {};
      const stat = await fs.stat(path.join(this.historyDir, name));
      next.entries[String(version)] = {
        version,
        file: name,
        hash: sha256(body),
        bytes: byteLength(body),
        createdAt: existing.createdAt || formatIsoWithOffset(stat.mtime, this.utcOffsetMinutes),
        mode: existing.mode || 'unknown',
        reason: existing.reason || 'index-repair',
        protected: existing.protected === true,
        ...(existing.source ? { source: existing.source } : {}),
        ...(existing.locksHash ? { locksHash: existing.locksHash } : {}),
        ...(existing.recovered === true || report.missing.includes(version) ? { recovered: true } : {}),
      };
      next.maxVersion = Math.max(next.maxVersion, version);
    }
    if (errors.length > 0) {
      const error = new Error(`summary_history 索引修复中止：${errors.length} 个版本文件无法读取`);
      error.code = 'SUMMARY_INDEX_REPAIR_FAILED';
      error.details = errors;
      throw error;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await fs.copyFile(this.summaryIndexFile, path.join(this.historyDir, `index.backup-${stamp}.json`));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const failure = new Error(`summary_history 索引修复中止：旧索引备份失败（${String(error?.message ?? error)}）`);
        failure.code = 'SUMMARY_INDEX_BACKUP_FAILED';
        throw failure;
      }
    }
    await this._writeSummaryIndex(next);
    await this._writeState({ summaryVersion: Math.max(Number(this._state?.summaryVersion) || 0, next.maxVersion) });
    await this.journal({
      op: 'summary-index-repair',
      versions: Object.keys(next.entries).length,
      missing: report.missing.length,
      extra: report.extra.length,
      mismatched: report.mismatched.length,
    });
    this.summaryIndexState = { ...(await this.summaryIndexReport()), applied: true };
    return { ...this.summaryIndexState, applied: true, repairedVersions: report.missing.length + report.extra.length + report.mismatched.length };
  }

  async _assertSummaryIndexReady() {
    const report = await this.summaryIndexReport();
    this.summaryIndexState = report;
    if (!report.ok) {
      const error = new Error('summary_history 索引与版本文件不一致；已暂停长期记忆写入。请先运行 repair-summary-index 并确认结果');
      error.code = 'SUMMARY_INDEX_MISMATCH';
      error.report = report;
      throw error;
    }
  }

  /** 当前长期文档的哈希、锁定块和遗忘清单。 */
  async summaryMeta() {
    const text = await this.readSummary();
    const parsed = parseLockBlocks(text);
    return {
      text,
      hash: sha256(text),
      bytes: byteLength(text),
      mode: this._state?.summaryMode ?? 'auto',
      summaryVersion: Number(this._state?.summaryVersion) || 0,
      locks: lockSummaries(text),
      lockErrors: parsed.errors,
      forgotten: Array.isArray(this._state?.longTermForgotten) ? this._state.longTermForgotten : [],
    };
  }

  /** 用户明确从长期记忆删除的内容清单。 */
  longTermForgotten() {
    return [...(Array.isArray(this._state?.longTermForgotten) ? this._state.longTermForgotten : [])];
  }

  async _addLongTermForgotten(items, reason) {
    const current = this.longTermForgotten();
    const known = new Set(current.map((item) => item.hash));
    const now = formatIsoWithOffset(this.now(), this.utcOffsetMinutes);
    for (const item of items) {
      const text = String(item?.content ?? item?.text ?? '').trim();
      if (!text) continue;
      const hash = forgottenFingerprint(text);
      if (known.has(hash)) continue;
      known.add(hash);
      current.push({ hash, text, at: now, reason: String(reason ?? 'user-delete').slice(0, 120) });
    }
    await this._writeState({ longTermForgotten: current.slice(-500) });
    await this.journal({ op: 'long-term-forgotten', count: current.length, reason: String(reason ?? 'user-delete').slice(0, 120) });
    return this.longTermForgotten();
  }

  async _removeLongTermForgotten(hashes) {
    const remove = new Set(hashes ?? []);
    if (remove.size === 0) return this.longTermForgotten();
    const next = this.longTermForgotten().filter((item) => !remove.has(item.hash));
    await this._writeState({ longTermForgotten: next });
    await this.journal({ op: 'long-term-forgotten-remove', count: remove.size });
    return next;
  }

  /**
   * 用户编辑长期记忆；默认把变更段落自动锁定，并做版本 CAS。
   * @param {{text:string,expectedHash?:string,protectChanged?:boolean,reason?:string}} input
   */
  async updateLongTerm(input) {
    const current = await this.readSummary();
    const expected = input?.expectedHash ? String(input.expectedHash) : '';
    if (expected && expected !== sha256(current)) {
      const error = new Error('长期记忆已被其他写入更新，请重新加载后再保存');
      error.code = 'SUMMARY_CONFLICT';
      error.currentHash = sha256(current);
      throw error;
    }
    let next = String(input?.text ?? '').replace(/\r\n?/g, '\n').trim();
    const active = await this.listActive();
    validateLongTermSummary(next, {
      currentText: current,
      allowNewLocks: true,
      allowEmpty: true,
      maxBytes: this.maxContentBytes,
      memories: active,
    });
    if (input?.protectChanged !== false) next = lockChangedBlocks(current, next);
    validateLongTermSummary(next, {
      currentText: current,
      allowNewLocks: true,
      allowEmpty: true,
      maxBytes: this.maxContentBytes,
      memories: active,
    });
    const removed = removedLeafBlocks(current, next);
    if (removed.length > 0) {
      await this._addLongTermForgotten(
        removed.map((content) => ({ content })),
        input?.reason || 'user-edit-removed',
      );
    }
    const result = await this.writeSummary(next, {
      mode: this._state?.summaryMode === 'manual' ? 'manual' : 'auto',
      expectedHash: sha256(current),
      reason: input?.reason || 'user-edit',
      source: 'user',
    });
    return { ...result, text: next, hash: sha256(next) };
  }

  /** 解锁一个长期块，保留内容，让 AI 下次可以演化它。 */
  async unlockLongTermBlock(id, reason = 'user-unlock') {
    const current = await this.readSummary();
    const next = unlockBlock(current, id);
    const result = await this.writeSummary(next, {
      mode: this._state?.summaryMode === 'manual' ? 'manual' : 'auto',
      expectedHash: sha256(current),
      reason,
      source: 'user',
    });
    return { ...result, text: next, hash: sha256(next), lockId: id };
  }

  /**
   * 删除一个长期块，并把内容写入遗忘清单，防止自动合成复活。
   * 支持锁定块 id，或按段落全文精确删除。
   */
  async forgetLongTermBlock(input = {}) {
    const current = await this.readSummary();
    let removed;
    let next;
    if (input.id) {
      const parsed = removeBlock(current, String(input.id));
      next = parsed.text;
      removed = parsed.content;
    } else {
      const parsed = removeParagraph(current, String(input.text ?? ''));
      next = parsed.text;
      removed = parsed.content;
    }
    validateLongTermSummary(next, {
      allowNewLocks: true,
      allowEmpty: true,
      maxBytes: this.maxContentBytes,
      memories: await this.listActive(),
    });
    // 先记遗忘，再删文档：即使写文档失败，也不会让 AI 重新引入这条内容。
    await this._addLongTermForgotten([{ content: removed }], input.reason || 'user-forget-long-term');
    const result = await this.writeSummary(next, {
      mode: this._state?.summaryMode === 'manual' ? 'manual' : 'auto',
      expectedHash: sha256(current),
      reason: input.reason || 'user-forget-long-term',
      source: 'user',
    });
    return { ...result, text: next, hash: sha256(next), removed };
  }

  /**
   * 短期删除后的长期清洗：移除仅由被删条目支持的 claim，并把 removed claim 加入遗忘清单。
   * 如果长期目录无法写入（例如索引损坏），仍由注入过滤层兜底。
   */
  async scrubLongTermForDeleted(entries = []) {
    const current = await this.readSummary();
    if (!current) return { changed: false, removedLines: 0 };
    const deletedIds = (entries ?? []).map((entry) => entry.id).filter(Boolean);
    const scrubbed = scrubSummaryForDeleted(current, deletedIds, entries);
    if (scrubbed.text === current || scrubbed.removedLines === 0) {
      return { changed: false, removedLines: 0, text: current };
    }
    // 先记遗忘，再删文档；即使写文档失败，注入过滤层也不会再展示这些 claim。
    await this._addLongTermForgotten(
      scrubbed.removedContents.map((content) => ({ content })),
      'short-term-deleted',
    );
    const result = await this.writeSummary(scrubbed.text, {
      mode: this._state?.summaryMode === 'manual' ? 'manual' : 'auto',
      expectedHash: sha256(current),
      reason: 'short-term-deleted',
      source: 'system',
    });
    return { ...result, changed: result.changed, removedLines: scrubbed.removedLines, text: scrubbed.text };
  }

  async _readSummaryIndex() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.summaryIndexFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') return parsed;
    } catch {
      // 没有索引时从文件名推导。
    }
    return { version: 1, maxVersion: 0, entries: {} };
  }

  async _writeSummaryIndex(index) {
    await this._atomicWrite(this.summaryIndexFile, `${JSON.stringify(index, null, 2)}\n`);
  }

  async _archiveSummary(current, meta = {}) {
    const body = stripHeader(current);
    if (!body) return null;
    const hash = sha256(body);
    const index = await this._readSummaryIndex();
    for (const entry of Object.values(index.entries)) {
      if (entry?.hash === hash) return { skipped: true, version: entry.version };
    }
    const files = await this.listSummaryVersions();
    let maxVersion = Math.max(Number(this._state?.summaryVersion) || 0, Number(index.maxVersion) || 0);
    for (const name of files) {
      const match = SUMMARY_VERSION_RE.exec(name);
      if (match) maxVersion = Math.max(maxVersion, Number(match[1]));
    }
    let version = maxVersion + 1;
    let file = path.join(this.historyDir, `${String(version).padStart(4, '0')}.md`);
    while (true) {
      try {
        await fs.access(file);
        version += 1;
        file = path.join(this.historyDir, `${String(version).padStart(4, '0')}.md`);
      } catch {
        break;
      }
    }
    await this._atomicWrite(file, summaryDocument(body));
    index.version = 1;
    index.maxVersion = version;
    index.entries[String(version)] = {
      version,
      file: path.basename(file),
      hash,
      bytes: byteLength(body),
      createdAt: formatIsoWithOffset(this.now(), this.utcOffsetMinutes),
      mode: meta.mode ?? this._state?.summaryMode ?? 'auto',
      reason: meta.reason ?? '',
      protected: meta.protected === true,
      ...(meta.source ? { source: String(meta.source).slice(0, 40) } : {}),
      ...(meta.locksHash ? { locksHash: String(meta.locksHash) } : {}),
      ...(meta.sourceHash ? { sourceHash: String(meta.sourceHash) } : {}),
    };
    await this._pruneSummaryVersions(index);
    await this._writeSummaryIndex(index);
    await this._writeState({ summaryVersion: version });
    return { version, file, hash, bytes: byteLength(body) };
  }

  async _pruneSummaryVersions(index) {
    const versions = Object.keys(index.entries)
      .map((key) => ({ key, ...index.entries[key] }))
      .filter((item) => Number.isInteger(Number(item.version)))
      .sort((a, b) => Number(a.version) - Number(b.version));
    if (versions.length <= this.keepSummaryVersions) return;
    const removable = versions.filter((item) => !item.protected).slice(0, Math.max(0, versions.length - this.keepSummaryVersions));
    for (const item of removable) {
      try {
        await fs.rm(path.join(this.historyDir, item.file || `${String(item.version).padStart(4, '0')}.md`), { force: true });
      } catch {
        // 删除旧版本失败不阻塞新版本写入。
      }
      delete index.entries[String(item.version)];
    }
  }

  /**
   * 写入工作区摘要。相同正文不重复归档；manual/rollback 版本受保护。
   * @param {string} text
   * @param {{mode?:'auto'|'manual', archive?:boolean, protected?:boolean, reason?:string}} options
   */
  async writeSummary(text, options = {}) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      await this._assertSummaryIndexReady();
      const body = stripHeader(String(text ?? '')).replace(/\r\n?/g, '\n').trim();
      if (body) {
        assertNoSecrets(body);
        const parsedLocks = parseLockBlocks(body);
        if (parsedLocks.errors.length > 0) {
          const error = new Error(`长期记忆锁定块格式错误：${parsedLocks.errors[0].reason}`);
          error.code = 'SUMMARY_LOCK_INVALID';
          throw error;
        }
        await this._assertSummaryAllowed(body);
      }
      const mode = options.mode === 'manual' ? 'manual' : 'auto';
      const current = await this.readSummary();
      const currentHash = sha256(current);
      if (options.expectedHash !== undefined && String(options.expectedHash) !== currentHash) {
        const error = new Error('长期记忆已被其他写入更新，请重新加载后再保存');
        error.code = 'SUMMARY_CONFLICT';
        error.currentHash = currentHash;
        throw error;
      }
      if (body === current) {
        if (this._state?.summaryMode !== mode) {
          await this._writeState({ summaryMode: mode });
          await this.journal({ op: 'summary-mode', mode });
          return { changed: true, modeChanged: true, mode, bytes: byteLength(body), hash: currentHash };
        }
        return { changed: false, mode, bytes: byteLength(body), hash: currentHash };
      }
      const locks = parseLockBlocks(body).blocks;
      const locksHash = summarySha256(JSON.stringify(locks.map((block) => [block.id, block.content])));
      const previousLocks = parseLockBlocks(current).blocks;
      const previousLocksHash = summarySha256(JSON.stringify(previousLocks.map((block) => [block.id, block.content])));
      if (current && options.archive !== false) {
        await this._archiveSummary(current, {
          mode: this._state?.summaryMode,
          reason: options.reason ?? 'before-write',
          protected: options.protected ?? this._state?.summaryMode === 'manual',
          source: options.source,
          locksHash: previousLocksHash,
          sourceHash: options.sourceHash,
        });
      }
      await this._atomicWrite(this.summaryFile, summaryDocument(body));
      await this._writeState({ summaryMode: mode, summaryHash: sha256(body) });
      await this.journal({
        op: 'summary',
        mode,
        bytes: byteLength(body),
        reason: options.reason ?? '',
        source: options.source ?? '',
        locks: locks.length,
      });
      return {
        changed: true,
        mode,
        bytes: byteLength(body),
        hash: sha256(body),
        locks: locks.length,
        locksHash,
      };
    });
  }

  /**
   * 把摘要回滚到 summary_history 中的某个版本。
   * 目标摘要若引用已删除记忆则拒绝，避免已删事实回到活动摘要。
   */
  async rollbackSummary(version) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      this._assertWritable();
      await this._assertSummaryIndexReady();
      const raw = String(version ?? '').trim().replace(/\.md$/i, '');
      if (!/^\d+$/.test(raw)) throw new TypeError('摘要版本号必须是数字');
      const name = `${String(Number(raw)).padStart(4, '0')}.md`;
      const file = path.join(this.historyDir, name);
      let text;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') throw new Error(`摘要版本 ${name} 不存在`);
        throw error;
      }
      const body = stripHeader(text);
      await this._assertSummaryAllowed(body);
      const hash = sha256(body);
      const current = await this.readSummary();
      if (current === body) {
        if (this._state?.summaryMode !== 'manual') await this._writeState({ summaryMode: 'manual' });
        return { changed: false, version: name, hash, mode: 'manual' };
      }

      if (current) {
        await this._archiveSummary(current, { mode: this._state?.summaryMode, reason: 'before-rollback', protected: true });
      }
      await this._atomicWrite(this.summaryFile, summaryDocument(body));
      await this._writeState({ summaryMode: 'manual', summaryHash: hash });
      await this.journal({ op: 'rollback', version: name, bytes: byteLength(body), hash });
      return { changed: true, version: name, bytes: byteLength(body), hash, mode: 'manual' };
    });
  }

  /** 读取工作区摘要正文。 */
  async readSummary() {
    return stripHeader(await this._readText(this.summaryFile));
  }

  /** 显式切换摘要模式；manual → auto 的回程入口。 */
  async setSummaryMode(mode) {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      if (mode !== 'auto' && mode !== 'manual') throw new TypeError('摘要模式只能是 auto 或 manual');
      const changed = (this._state?.summaryMode ?? 'auto') !== mode;
      if (changed) {
        await this._writeState({ summaryMode: mode });
        await this.journal({ op: 'summary-mode', mode });
      }
      return { changed, mode };
    });
  }

  /** 读取全局摘要正文；未配置全局目录时返回空字符串。 */
  async readGlobalSummary() {
    if (!this.globalSummaryFile) return '';
    return stripHeader(await this._readText(this.globalSummaryFile));
  }

  /** summary_history 中的版本文件名，按版本排序。 */
  async listSummaryVersions() {
    let files = [];
    try {
      files = await fs.readdir(this.historyDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return files.filter((name) => SUMMARY_VERSION_RE.test(name)).sort((a, b) => Number(SUMMARY_VERSION_RE.exec(a)[1]) - Number(SUMMARY_VERSION_RE.exec(b)[1]));
  }

  /** 摘要版本元数据，供设置页显示。 */
  async listSummaryVersionInfo() {
    const index = await this._readSummaryIndex();
    return (await this.listSummaryVersions()).map((name) => {
      const version = Number(SUMMARY_VERSION_RE.exec(name)[1]);
      const meta = index.entries[String(version)] ?? {};
      return {
        version,
        name,
        hash: meta.hash ?? '',
        bytes: meta.bytes ?? 0,
        createdAt: meta.createdAt ?? '',
        mode: meta.mode ?? '',
        reason: meta.reason ?? '',
        protected: meta.protected === true,
      };
    });
  }

  /** 记忆库统计，用于状态工具和报告。 */
  async stats() {
    const rawEntries = await this.listRaw();
    const active = rawEntries.filter(isActiveEntry);
    const deleted = await this.listDeleted();
    const archived = await this.listArchived();
    const summary = await this.readSummary();
    const locks = parseLockBlocks(summary);
    return {
      activeCount: active.length,
      archivedCount: archived.length,
      archivedActiveCount: archived.filter(isActiveEntry).length,
      archivedDeletedCount: archived.filter(isDeletedEntry).length,
      deletedCount: deleted.length,
      tombstoneCount: this._tombstones.size,
      maxActiveMemories: this.maxActiveMemories,
      rawBytes: byteLength(rawDocument(active)),
      rawTotalBytes: byteLength(rawDocument(rawEntries)),
      rawArchiveMaxBytes: this.rawArchiveMaxBytes,
      archiveBytes: byteLength(await this._readText(this.archiveFile)),
      summaryBytes: byteLength(summary),
      summaryHash: sha256(summary),
      summaryMode: this._state?.summaryMode ?? 'auto',
      summaryVersions: (await this.listSummaryVersions()).length,
      longTermLocks: locks.blocks.length,
      longTermLockErrors: locks.errors.length,
      longTermForgotten: Array.isArray(this._state?.longTermForgotten) ? this._state.longTermForgotten.length : 0,
      summaryIndexOk: this.summaryIndexState?.ok !== false,
      summaryIndexMissing: this.summaryIndexState?.missing?.length ?? 0,
      summaryIndexExtra: this.summaryIndexState?.extra?.length ?? 0,
      summaryIndexMismatched: this.summaryIndexState?.mismatched?.length ?? 0,
      parseErrors: this.parseErrors.raw.length + this.parseErrors.archive.length,
      parseErrorDetails: [...this.parseErrors.raw, ...this.parseErrors.archive].map((item) => ({ id: item.id, reason: item.reason, line: item.index })),
      stateRecovered: this.stateRecovery !== null,
      stateRecovery: this.stateRecovery,
    };
  }

  /** 读取 journal 最近的若干条事件，供设置页展示。 */
  async recentEvents(limit = 3) {
    const text = await this._readText(this.journalFile);
    return text
      .split('\n')
      .filter(Boolean)
      .slice(-Math.max(1, limit))
      .map((line) => {
        try {
          const event = JSON.parse(line);
          return { op: event.op ?? '', id: event.id ?? '', ts: event.ts ?? '' };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }

  /** 等待所有排队写入落盘。 */
  async close() {
    await this._queue.catch(() => {});
  }
}
