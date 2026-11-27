/**
 * dsh-memory-feiyu 公共类型声明。
 * 仅用于编辑器和二次开发；运行时代码为纯 JavaScript。
 */

export interface FeiyuConfig {
  privateWorkspace: string;
  memoryDir: string;
  globalMemoryDir?: string;
  scopeMaxBytes: number;
  scopeMaxTokens: number;
  maxBytes: number;
  globalMaxBytes: number;
  consolidateMaxBytes: number;
  consolidateMaxTokens: number;
  curateMaxBytes: number;
  curateMaxTokens: number;
  curateEntriesShown: number;
  keepSummaryVersions: number;
  rawArchiveMaxBytes: number;
  maxActiveMemories: number;
  injectIndex: boolean;
  indexMaxBytes: number;
  indexMaxTokens: number;
  contextBudgetRatio: number;
  contextBudgetHardRatio: number;
  fallbackContextTokens: number;
  autoSummary: boolean;
  maxSnapshotsPerSession: number;
  digestMaxBytes: number;
  digestMaxTokens: number;
  digestRecentEntries: number;
  digestSummaryMaxBytes: number;
  digestIntervalTurns: number;
  maxDigestMessages: number;
  digestTotalBytes: number;
  digestTotalTokens: number;
  fullSyncChangedEntries: number;
  fullSyncOnDelete: boolean;
  longTermSynthesisMaxBytes: number;
  longTermSynthesisMaxTokens: number;
  longTermMaxOutputTokens: number;
  longTermMode: 'off' | 'preview' | 'apply';
  curatorBackfill: boolean;
  curatorEnabled: boolean;
  curatorThresholdTurns: number;
  curatorSessionsPerBatch: number;
  curatorBatchesPerRun: number;
  curatorTurnsPerSlice: number;
  curatorMaxBytes: number;
  curatorMaxTokens: number;
  curatorBatchBytes: number;
  curatorBatchTokens: number;
  curatorMaxOutputTokens: number;
  curatorTimeoutMs: number;
  curatorEntriesShown: number;
  curatorRunsPerHour: number;
  curatorStartupDelayMs: number;
  curatorDurabilityGate: boolean;
  curatorCooldownMs: number;

  /* ---------- v2.0 ---------- */
  usageHalfLifeDays: number;
  usageDailyHitCap: number;
  activityGraceHours: number;
  usageCompactAfterLines: number;
  coreEnabled: boolean;
  coreMaxItems: number;
  coreItemMaxBytes: number;
  coreMaxBytes: number;
  coreMinSources: number;
  coreOverlapThreshold: number;
  dreamingEnabled: boolean;
  dreamingIntervalHours: number;
  dreamingMinNewMemories: number;
  dreamingRunsPerDay: number;
  dreamingMaxBytes: number;
  dreamingMaxTokens: number;
  dreamingMaxOutputTokens: number;
  dreamingTimeoutMs: number;
  dreamingCooldownMs: number;
  dreamingStartupDelayMs: number;
  dreamingCandidates: number;
  archiveRecallLimit: number;
}

/** 有效命中统计中的单条记录。 */
export interface MemoryUsageRecord {
  id: string;
  hits: number;
  firstHitAt: string;
  lastHitAt: string;
  lastSession: string;
  lastTurn: number;
  contentUpdatedAt: string;
  archivedAt: string;
  day: string;
  dayCount: number;
}

/** 活跃度：主项是最后有效引用/实质更新的衰减，辅助项是命中频率与重要度。 */
export interface MemoryActivity {
  score: number;
  lastActiveAt: string;
  hits: number;
  importance: number;
  decay: number;
  ageDays: number;
}

/** 浮动核心记忆条目。 */
export interface CoreItem {
  id: string;
  title: string;
  body: string;
  sources: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

/** 一次 Dreaming 运行的摘要记录。 */
export interface DreamRun {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  reason: string;
  status: 'running' | 'ok' | 'noop' | 'skipped' | 'rejected' | 'partial' | 'failed';
  add: number;
  update: number;
  remove: number;
  skipped?: number;
  coreAfter?: number | null;
  errors?: string[];
  snapshotDir?: string;
}

export interface MemoryEntry {
  /** 唯一记忆 ID，格式 mem-xxxxxxxx。 */
  id: string;
  /** ISO 时间，带 +08:00 偏移。 */
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  source: string;
  context: string;
  summary: string;
  importance: number;
  content: string;
  status?: 'active' | 'deleted';
  /** v2.0：归档（冷库）时间与原因；空字符串表示不在冷库。 */
  archivedAt?: string;
  archiveReason?: string;
  trace?: string;
  quote?: string;
  quoteHash?: string;
  sourceType?: string;
  curatorOp?: string;
  evidence?: Array<{
    sessionId: string;
    turn: number;
    seqStart: number;
    seqEnd: number;
    quote: string;
    quoteHash: string;
  }>;
}

export interface SearchResult extends MemoryEntry {
  score: number;
}

export interface SearchOptions {
  query?: string;
  id?: string;
  tags?: string | string[];
  limit?: number;
  /** v2.0：默认 false（冷库不参与默认搜索）；只有显式包含或 memory_recall 才访问冷库。 */
  includeArchived?: boolean;
}

export interface RecallOptions {
  id?: string;
  tags?: string | string[];
  limit?: number;
  /** archive（默认，只翻冷库）、all（冷库 + 活动）、active（只查活动）。 */
  scope?: 'archive' | 'all' | 'active';
}

export interface StoreOptions {
  memoryDir: string;
  globalMemoryDir?: string;
  maxActiveMemories?: number;
  rawArchiveMaxBytes?: number;
  keepSummaryVersions?: number;
  maxContentBytes?: number;
  utcOffsetMinutes?: number;
  now?: () => Date;
  idFactory?: () => string;
  logger?: { warn?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
  /** v2.0：有效命中存储；用于活跃度排序与低活跃归档。 */
  usage?: { get?: (id: string) => MemoryUsageRecord | undefined; noteArchive?: Function; noteRestore?: Function; recordContentUpdate?: Function } | null;
  usageHalfLifeDays?: number;
  activityGraceHours?: number;
}

export interface MemoryStats {
  activeCount: number;
  archivedCount: number;
  archivedActiveCount?: number;
  archivedDeletedCount?: number;
  deletedCount?: number;
  tombstoneCount?: number;
  maxActiveMemories: number;
  rawBytes: number;
  rawTotalBytes?: number;
  rawArchiveMaxBytes: number;
  archiveBytes: number;
  summaryBytes: number;
  summaryHash?: string;
  summaryMode: 'auto' | 'manual';
  summaryVersions: number;
  longTermLocks?: number;
  longTermLockErrors?: number;
  longTermForgotten?: number;
  summaryIndexOk?: boolean;
  summaryIndexMissing?: number;
  summaryIndexExtra?: number;
  summaryIndexMismatched?: number;
  parseErrors?: number;
  parseErrorDetails?: Array<{ id: string; reason: string; line: number }>;
  stateRecovered?: boolean;
}

export interface ContextBudget {
  tokens: number;
  bytes: number;
  hardTokens: number;
  contextWindow: number | null;
  source: 'model' | 'fallback';
  ratio: number;
  hardRatio: number;
}

export interface IndexRender {
  text: string;
  total: number;
  shown: number;
  omitted: number;
  bytes: number;
  tokens: number;
}

export interface Snapshot {
  text: string;
  hash: string;
  contextBudget: ContextBudget;
  totalBytes: number;
  totalTokens: number;
  summaries: {
    globalBytes: number;
    workspaceBytes: number;
    totalBytes: number;
    maxBytes: number;
    scopeMaxBytes: number;
    globalMaxBytes: number;
  };
  index: IndexRender;
  config: FeiyuConfig;
}

export declare const DEFAULT_CONFIG: Readonly<Partial<FeiyuConfig>>;
export declare const name: 'dsh-memory-feiyu';
export declare const inject: string[];
export declare function apply(ctx: unknown, config: Record<string, unknown>): Promise<void>;
export declare const MEMORY_SOURCE_KIND: 'feiyu-memory';
export declare const INDEX_HEADER: '## 短期记忆索引';
export declare const INDEX_RULES: string;

export declare function normalizeConfig(input?: Partial<FeiyuConfig>): FeiyuConfig;
export declare function resolveContextBudget(contextWindow: number | undefined | null, config?: FeiyuConfig): ContextBudget;
export declare function isWorkspacePath(cwd: string | undefined | null, privateWorkspace: string | undefined | null): boolean;
export declare function isWorkspaceAgent(agent: { session?: { header?: { cwd?: string } } } | undefined, privateWorkspace: string): boolean;

export declare class SecretDetectedError extends Error {
  code: 'SECRET_DETECTED';
}
export declare function assertNoSecrets(text: string): void;
export declare function oneLine(text: string, maxChars?: number): string;
export declare function byteLength(text: string): number;
export declare function estimateTokens(text: string): number;
export declare function truncateUtf8(text: string, maxBytes: number, suffix?: string): string;
export declare function fitTextToBudget(text: string, options: { maxBytes: number; maxTokens?: number; suffix?: string }): string;
export declare function sha256(text: string): string;
export declare function normalizeTags(input: string | string[]): string[];

export declare class MemoryStore {
  constructor(options: StoreOptions);
  readonly memoryDir: string;
  init(): Promise<this>;
  journal(event: Record<string, unknown>): Promise<void>;
  listActive(): Promise<MemoryEntry[]>;
  listArchived(): Promise<MemoryEntry[]>;
  listAll(includeArchived?: boolean): Promise<MemoryEntry[]>;
  get(id: string, includeArchived?: boolean): Promise<MemoryEntry | undefined>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  add(input: {
    content: string;
    tags?: string | string[];
    summary?: string;
    source?: string;
    context?: string;
    importance?: number;
    createdAt?: string;
  }): Promise<MemoryEntry>;
  readSummary(): Promise<string>;
  readGlobalSummary(): Promise<string>;
  writeSummary(text: string, options?: { mode?: 'auto' | 'manual'; archive?: boolean; expectedHash?: string; reason?: string; source?: string; protected?: boolean; sourceHash?: string }): Promise<{ changed: boolean; mode: 'auto' | 'manual'; bytes: number; hash: string; locks?: number }>;
  summaryMeta(): Promise<{ text: string; hash: string; bytes: number; mode: 'auto' | 'manual'; summaryVersion: number; locks: Array<{ id: string; content: string; bytes: number }>; lockErrors: unknown[]; forgotten: Array<{ hash: string; text: string; at: string; reason: string }> }>;
  summaryIndexReport(): Promise<{ ok: boolean; files: string[]; missing: number[]; extra: number[]; mismatched: unknown[]; maxVersion: number }>;
  repairSummaryIndex(options?: { apply?: boolean }): Promise<Record<string, unknown>>;
  updateLongTerm(input: { text: string; expectedHash?: string; protectChanged?: boolean; reason?: string }): Promise<Record<string, unknown>>;
  unlockLongTermBlock(id: string, reason?: string): Promise<Record<string, unknown>>;
  forgetLongTermBlock(input: { id?: string; text?: string; reason?: string }): Promise<Record<string, unknown>>;
  longTermForgotten(): Array<{ hash: string; text: string; at: string; reason: string }>;
  scrubLongTermForDeleted(entries?: MemoryEntry[]): Promise<{ changed: boolean; removedLines: number; text?: string }>;
  listSummaryVersions(): Promise<string[]>;
  stats(): Promise<MemoryStats>;
  close(): Promise<void>;
}

export declare function tokenize(text: string): string[];
export declare function scoreEntry(entry: MemoryEntry, queryTokens: string[], options?: { phrase?: string }): number;
export declare function searchMemories(entries: MemoryEntry[], options?: SearchOptions): SearchResult[];

export declare function displayTime(iso: string): string;
export declare function planCurationBudget(maxBytes: number): { summary: number; raw: number; conversation: number; total: number };
export declare function buildAutoSummary(entries: MemoryEntry[], options?: { maxBytes?: number; maxTokens?: number }): string;
export declare function curateEntries(entries: MemoryEntry[], options?: { maxBytes?: number; maxTokens?: number; entriesShown?: number }): {
  entries: MemoryEntry[];
  text: string;
  bytes: number;
  tokens: number;
  omitted: number;
};
export declare function composeCurationContext(input?: {
  summary?: string;
  entries?: MemoryEntry[];
  conversation?: string;
  maxBytes?: number;
  maxTokens?: number;
  entriesShown?: number;
}): {
  text: string;
  budget: { summary: number; raw: number; conversation: number; total: number };
  summary: { budget: number; bytes: number; text: string };
  raw: { budget: number; bytes: number; entries: MemoryEntry[]; omitted: number; text: string };
  conversation: { budget: number; bytes: number; text: string };
  totalBytes: number;
};
export declare function mergeEntries(...lists: MemoryEntry[][]): MemoryEntry[];

export declare function formatIndexLine(entry: MemoryEntry): string;
export declare function renderIndex(entries: MemoryEntry[], options?: { maxBytes?: number; maxTokens?: number }): IndexRender;
export declare function buildSnapshot(input?: {
  globalSummary?: string;
  workspaceSummary?: string;
  entries?: MemoryEntry[];
  contextWindow?: number;
  config?: Partial<FeiyuConfig>;
}): Snapshot;
export declare function entrySyncState(entry: MemoryEntry): string;
export declare function entriesSyncState(entries: MemoryEntry[]): Record<string, string>;
export declare function lastMemorySync(messages: Array<{ role?: string; source?: { kind?: string; form?: string; sync?: { summaryHash?: string; entries?: Record<string, string> } }; content?: Array<{ type?: string; text?: string }> }>): { text: string; sync: { summaryHash?: string; entries?: Record<string, string> } | null; form?: string } | null;
export declare function buildMemoryUpdate(input?: {
  summary?: string;
  changedEntries?: MemoryEntry[];
  deletedEntries?: MemoryEntry[];
  maxBytes?: number;
  maxTokens?: number;
}): { tooLarge: boolean; form?: 'update'; text: string; hash?: string; totalBytes?: number; totalTokens?: number; changed?: number; deleted?: number };
export declare function buildMemoryDigest(input?: {
  summary?: string;
  entries?: MemoryEntry[];
  maxBytes?: number;
  maxTokens?: number;
  summaryMaxBytes?: number;
  recentEntries?: number;
  config?: Partial<FeiyuConfig>;
}): { form: 'digest'; text: string; hash: string; totalBytes: number; totalTokens: number; summaryBytes: number; recentEntries: number };
export declare function countFullSnapshots(messages: Array<{ role?: string; source?: { kind?: string; form?: string }; content?: Array<{ type?: string; text?: string }> }>): number;
export declare function digestUsage(messages: Array<{ role?: string; source?: { kind?: string; form?: string; turn?: number }; content?: Array<{ type?: string; text?: string }> }>): { count: number; bytes: number; tokens: number; lastTurn: number };
export declare function hasSnapshotMessage(messages: Array<{ role?: string; source?: { kind?: string }; content?: Array<{ type?: string; text?: string }> }>, snapshotText: string): boolean;
export declare function shouldInjectSnapshot(messages: Array<{ role?: string; source?: { kind?: string }; content?: Array<{ type?: string; text?: string }> }>, snapshotText: string): boolean;
export declare function lastSnapshotText(messages: Array<{ role?: string; source?: { kind?: string }; content?: Array<{ type?: string; text?: string }> }>): string;
