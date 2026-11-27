/**
 * 短期记忆的有效命中统计（v2.0）。
 *
 * 设计目标：
 * - 只统计“真的被用到”的引用：自动注入、普通搜索结果、整理扫描、测试都不计入。
 * - 同一会话同一轮对同一条记忆只计一次；单条记忆每天有计数上限，避免自我强化。
 * - 写入走 append-only WAL（崩溃安全、命中不重写大文件），超阈值折叠成快照。
 *
 * 本模块是纯 Node 实现，不依赖 DSH。
 * @module dsh-memory-feiyu/usage
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SNAPSHOT_VERSION = 1;
const ENTRY_ID_RE = /^mem-[0-9a-f]{8}$/;
const HIT_REASONS = ['assistant', 'user', 'both', 'legacy'];

function isoAt(date) {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString();
}

/** 以 +08:00 计算「今天」，用于每日上限。 */
function dayKey(date, offsetMinutes = 480) {
  const value = date instanceof Date ? date : new Date(date);
  const shifted = new Date(value.getTime() + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function emptyState() {
  return { version: SNAPSHOT_VERSION, updatedAt: '', walOffset: 0, lastSeq: 0, entries: {} };
}

function normalizeRecord(id, raw) {
  const hits = Number(raw?.hits) || 0;
  const reasons = {};
  for (const key of HIT_REASONS) reasons[key] = Number(raw?.reasons?.[key]) || 0;
  return {
    id,
    hits: hits > 0 ? Math.floor(hits) : 0,
    firstHitAt: String(raw?.firstHitAt ?? ''),
    lastHitAt: String(raw?.lastHitAt ?? ''),
    lastSession: String(raw?.lastSession ?? ''),
    lastTurn: Number(raw?.lastTurn) || 0,
    contentUpdatedAt: String(raw?.contentUpdatedAt ?? ''),
    archivedAt: String(raw?.archivedAt ?? ''),
    day: String(raw?.day ?? ''),
    dayCount: Number(raw?.dayCount) || 0,
    reasons,
  };
}

/**
 * 命中与活跃度存储。
 */
export class UsageStore {
  /**
   * @param {{
   *   memoryDir: string,
   *   now?: () => Date,
   *   logger?: {warn?: Function},
   *   dailyHitCap?: number,
   *   compactAfterLines?: number,
   *   utcOffsetMinutes?: number,
   * }} options
   */
  constructor(options) {
    if (!options?.memoryDir) throw new TypeError('UsageStore: memoryDir 必填');
    this.memoryDir = path.resolve(options.memoryDir);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
    this.dailyHitCap = Math.max(1, Number(options.dailyHitCap) || 5);
    this.compactAfterLines = Math.max(200, Number(options.compactAfterLines) || 2000);
    this.utcOffsetMinutes = options.utcOffsetMinutes ?? 480;
    this.snapshotFile = path.join(this.memoryDir, 'usage.json');
    this.walFile = path.join(this.memoryDir, 'usage.jsonl');
    this.state = emptyState();
    this._seen = [];
    this._seenSet = new Set();
    this._walBytes = 0;
    this._walLines = 0;
    this._seq = 0;
    this._queue = Promise.resolve();
    this._initialized = false;
    this.compactions = 0;
    this.recovered = false;
    this._lastWriteError = null;
  }

  async init() {
    await fs.mkdir(this.memoryDir, { recursive: true });
    this.state = await this._readSnapshot();
    this._seq = Number(this.state.lastSeq) || 0;
    const wal = await this._readText(this.walFile);
    this._walBytes = Buffer.byteLength(wal, 'utf8');
    if (this._walBytes > 0) {
      // WAL 里的每条记录带单调序号：快照已经包含的（seq ≤ lastSeq）不会被重放。
      const lines = wal.split('\n').filter(Boolean);
      this._walLines = lines.length;
      this._replay(wal);
      this.recovered = true;
    }
    this._initialized = true;
    return this;
  }

  async _readSnapshot() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.snapshotFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('usage.json 不是对象');
      const entries = {};
      for (const [id, record] of Object.entries(parsed.entries ?? {})) {
        if (!ENTRY_ID_RE.test(id)) continue;
        entries[id] = normalizeRecord(id, record);
      }
      return { version: SNAPSHOT_VERSION, updatedAt: String(parsed.updatedAt ?? ''), walOffset: Number(parsed.walOffset) || 0, lastSeq: Number(parsed.lastSeq) || 0, entries };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger?.warn?.(`[dsh-memory-feiyu] usage.json 损坏，已重建命中统计（不影响记忆正文）: ${String(error?.message ?? error)}`);
      }
      return emptyState();
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

  _replay(text) {
    for (const line of String(text ?? '').split('\n')) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const seq = Number(record?.q);
      if (Number.isInteger(seq) && seq > 0) {
        if (seq <= this._seq) continue;
        this._seq = seq;
      }
      this._apply(record, { replay: true });
    }
  }

  _apply(record, options = {}) {
    const id = String(record?.id ?? '');
    if (!ENTRY_ID_RE.test(id)) return;
    const at = String(record?.at ?? '') || isoAt(this.now());
    const current = this.state.entries[id] ?? normalizeRecord(id, {});
    if (record.op === 'hit') {
      const sessionId = String(record.s ?? '');
      const turn = Number(record.n) || 0;
      const key = `${sessionId}|${turn}|${id}`;
      if (options.replay !== true && this._seenSet.has(key)) return;
      if (sessionId || turn > 0) {
        if (!this._seenSet.has(key)) {
          this._seenSet.add(key);
          this._seen.push(key);
          while (this._seen.length > 4000) {
            const dropped = this._seen.shift();
            this._seenSet.delete(dropped);
          }
        }
      }
      const day = dayKey(new Date(at), this.utcOffsetMinutes);
      if (current.day !== day) {
        current.day = day;
        current.dayCount = 0;
      }
      current.hits += 1;
      current.dayCount += 1;
      current.lastHitAt = at;
      const reasonKey = HIT_REASONS.includes(String(record?.r ?? '')) ? String(record.r) : 'legacy';
      current.reasons = { ...(current.reasons ?? {}), [reasonKey]: (current.reasons?.[reasonKey] ?? 0) + 1 };
      if (!current.firstHitAt) current.firstHitAt = at;
      if (sessionId) current.lastSession = sessionId;
      if (turn) current.lastTurn = turn;
      this.state.entries[id] = current;
      return;
    }
    if (record.op === 'update') {
      current.contentUpdatedAt = at;
      this.state.entries[id] = current;
      return;
    }
    if (record.op === 'archive') {
      current.archivedAt = at;
      this.state.entries[id] = current;
      return;
    }
    if (record.op === 'restore') {
      current.archivedAt = '';
      this.state.entries[id] = current;
    }
  }

  _exclusive(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _append(record) {
    this._seq += 1;
    const line = `${JSON.stringify({ ...record, q: this._seq })}\n`;
    try {
      await fs.appendFile(this.walFile, line, 'utf8');
      this._walBytes += Buffer.byteLength(line, 'utf8');
      this._walLines += 1;
    } catch (error) {
      this._lastWriteError = String(error?.message ?? error);
      this.logger?.warn?.(`[dsh-memory-feiyu] 命中统计写入失败（不阻塞记忆读写）: ${this._lastWriteError}`);
    }
  }

  async _maybeCompact() {
    if (this._walLines < this.compactAfterLines) return;
    const content = await this._readText(this.walFile);
    const size = Buffer.byteLength(content, 'utf8');
    await this._writeSnapshot(size);
    await fs.writeFile(this.walFile, '', 'utf8');
    this._walBytes = 0;
    this._walLines = 0;
    this.compactions += 1;
  }

  async _writeSnapshot(walOffset) {
    const payload = {
      version: SNAPSHOT_VERSION,
      updatedAt: new Date(this.now()).toISOString(),
      walOffset,
      lastSeq: this._seq,
      entries: this.state.entries,
    };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const file = this.snapshotFile;
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
    this.state.walOffset = walOffset;
    this.state.lastSeq = this._seq;
    this.state.updatedAt = payload.updatedAt;
  }

  /**
   * 记录一次有效命中。
   * @returns {Promise<{counted:boolean, reason?:string, hits?:number}>}
   */
  async recordHit(id, { sessionId = '', turn = 0, at = null, reason = 'assistant' } = {}) {
    if (!ENTRY_ID_RE.test(String(id ?? ''))) return { counted: false, reason: 'bad-id' };
    const reasonKey = HIT_REASONS.includes(String(reason)) ? String(reason) : 'legacy';
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const stamp = at ? isoAt(at) : isoAt(this.now());
      const current = this.state.entries[id] ?? normalizeRecord(id, {});
      const day = dayKey(new Date(stamp), this.utcOffsetMinutes);
      const dayCount = current.day === day ? current.dayCount : 0;
      if (dayCount >= this.dailyHitCap) return { counted: false, reason: 'daily-cap', hits: current.hits };
      const key = `${sessionId}|${Number(turn) || 0}|${id}`;
      if ((sessionId || turn) && this._seenSet.has(key)) return { counted: false, reason: 'duplicate', hits: current.hits };
      this._apply({ op: 'hit', id, at: stamp, s: sessionId, n: Number(turn) || 0, r: reasonKey });
      await this._append({ op: 'hit', id, at: stamp, s: sessionId, n: Number(turn) || 0, r: reasonKey });
      await this._maybeCompact();
      return { counted: true, hits: this.state.entries[id].hits };
    });
  }

  /** 记录一次“实质性内容更新”（正文或概述真的变了）。 */
  async recordContentUpdate(id, at = null) {
    if (!ENTRY_ID_RE.test(String(id ?? ''))) return { recorded: false };
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const stamp = at ? isoAt(at) : isoAt(this.now());
      this._apply({ op: 'update', id, at: stamp });
      await this._append({ op: 'update', id, at: stamp });
      await this._maybeCompact();
      return { recorded: true };
    });
  }

  async noteArchive(id, at = null) {
    if (!ENTRY_ID_RE.test(String(id ?? ''))) return { recorded: false };
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const stamp = at ? isoAt(at) : isoAt(this.now());
      this._apply({ op: 'archive', id, at: stamp });
      await this._append({ op: 'archive', id, at: stamp });
      return { recorded: true };
    });
  }

  async noteRestore(id, at = null) {
    if (!ENTRY_ID_RE.test(String(id ?? ''))) return { recorded: false };
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const stamp = at ? isoAt(at) : isoAt(this.now());
      this._apply({ op: 'restore', id, at: stamp });
      await this._append({ op: 'restore', id, at: stamp });
      return { recorded: true };
    });
  }

  get(id) {
    return this.state.entries[String(id ?? '')];
  }

  all() {
    return this.state.entries;
  }

  /** 最近一次有效活动时间（命中或实质更新），用于活跃度排序。 */
  lastActivityAt(id, entry) {
    const record = this.get(id);
    const values = [
      Date.parse(record?.lastHitAt ?? '') || 0,
      Date.parse(record?.contentUpdatedAt ?? '') || 0,
      Date.parse(entry?.updatedAt ?? '') || 0,
      Date.parse(entry?.createdAt ?? '') || 0,
    ];
    const max = Math.max(...values);
    return max > 0 ? new Date(max).toISOString() : '';
  }

  stats() {
    const entries = Object.values(this.state.entries);
    const today = dayKey(new Date(this.now()), this.utcOffsetMinutes);
    let totalHits = 0;
    let todayHits = 0;
    let lastHitAt = '';
    let activeToday = 0;
    const reasons = { assistant: 0, user: 0, both: 0, legacy: 0 };
    for (const record of entries) {
      totalHits += record.hits;
      if (record.day === today) {
        todayHits += record.dayCount;
        if (record.dayCount > 0) activeToday += 1;
      }
      if (record.lastHitAt && record.lastHitAt > lastHitAt) lastHitAt = record.lastHitAt;
      for (const key of HIT_REASONS) reasons[key] += Number(record.reasons?.[key]) || 0;
    }
    return {
      tracked: entries.length,
      totalHits,
      todayHits,
      activeToday,
      lastHitAt,
      reasons,
      dailyHitCap: this.dailyHitCap,
      compactions: this.compactions,
      walBytes: this._walBytes,
      recovered: this.recovered,
      lastWriteError: this._lastWriteError,
    };
  }

  /** 强制把当前状态折叠成快照（测试与运维用）。 */
  async flush() {
    return this._exclusive(async () => {
      if (!this._initialized) await this.init();
      const content = await this._readText(this.walFile);
      const size = Buffer.byteLength(content, 'utf8');
      await this._writeSnapshot(size);
      return { entries: Object.keys(this.state.entries).length, walBytes: size, lastSeq: this._seq };
    });
  }

  async close() {
    await this._queue.catch(() => {});
    this._initialized = false;
  }
}

export const USAGE_ENTRY_ID_RE = ENTRY_ID_RE;
export { dayKey };
