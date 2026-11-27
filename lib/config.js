/**
 * 插件配置默认值、预算解析和工作区隔离判断。
 * 纯函数，无 DSH 依赖。
 * @module dsh-memory-feiyu/config
 */
import path from 'node:path';

/** 所有预算默认值。与任务规格逐项对应。 */
export const DEFAULT_CONFIG = Object.freeze({
  scopeMaxBytes: 12000,
  scopeMaxTokens: 4000,
  maxBytes: 14000,
  globalMaxBytes: 2000,
  consolidateMaxBytes: 36000,
  consolidateMaxTokens: 8192,
  curateMaxBytes: 64000,
  curateMaxTokens: 2000,
  curateEntriesShown: 80,
  keepSummaryVersions: 30,
  rawArchiveMaxBytes: 300000,
  maxActiveMemories: 200,
  injectIndex: true,
  indexMaxBytes: 40960,
  indexMaxTokens: 12000,
  contextBudgetRatio: 0,
  contextBudgetHardRatio: 0,
  fallbackContextTokens: 8192,
  autoSummary: true,
  // 兼容 1.2.x 的字段；1.3.0 不再用它硬性停止完整快照。
  maxSnapshotsPerSession: 8,
  // 1.3.0：取消累计快照/digest 次数上限；只保留单次容量保护。
  digestMaxBytes: 12000,
  digestMaxTokens: 4000,
  // 以下字段为 1.2.x 配置兼容保留，运行时不再作为累计上限使用。
  digestRecentEntries: 24,
  digestSummaryMaxBytes: 12000,
  digestIntervalTurns: 1,
  maxDigestMessages: 100000,
  digestTotalBytes: 100000000,
  digestTotalTokens: 100000000,
  fullSyncChangedEntries: 12,
  fullSyncOnDelete: true,
  longTermSynthesisMaxBytes: 64000,
  longTermSynthesisMaxTokens: 16000,
  longTermMaxOutputTokens: 4000,
  longTermMode: 'off',
  curatorBackfill: false,
  curatorEnabled: true,
  curatorThresholdTurns: 20,
  curatorSessionsPerBatch: 8,
  curatorBatchesPerRun: 8,
  curatorTurnsPerSlice: 8,
  curatorMaxBytes: 64000,
  curatorMaxTokens: 12000,
  curatorBatchBytes: 32000,
  curatorBatchTokens: 6000,
  curatorMaxOutputTokens: 2000,
  curatorTimeoutMs: 120000,
  curatorEntriesShown: 80,
  curatorRunsPerHour: 3,
  curatorStartupDelayMs: 15000,
  curatorCooldownMs: 60000,
  curatorDurabilityGate: true,

  /* ---------- v2.0：短期记忆活跃度与有效命中 ---------- */
  // observe：命中只统计、只展示，不参与自动归档；enforce：命中参与活跃度排序与淘汰。
  // 先用 observe 观察真实对话里的"转述漏计/ID 误计"，验证过再切 enforce。
  hitStatsMode: 'observe',
  // 活跃度衰减半衰期（天）：只影响排序/淘汰，不删除任何内容。
  usageHalfLifeDays: 30,
  // 单条记忆每天最多计入多少次有效命中，避免一次长会话自我强化排序。
  usageDailyHitCap: 5,
  // 受保护窗口（小时）：窗口内更新/被引用的条目不会被容量淘汰搬进冷库。
  activityGraceHours: 24,
  // usage 日志压缩阈值（行）；超过后折叠成快照。
  usageCompactAfterLines: 2000,

  /* ---------- v2.0：浮动核心记忆 ---------- */
  coreEnabled: true,
  coreMaxItems: 10,
  coreItemMaxBytes: 600,
  coreMaxBytes: 1600,
  coreMinSources: 2,
  // 与长期记忆的最大 bigram 重合度；超过视为重复，不进入浮动核心。
  coreOverlapThreshold: 0.6,

  /* ---------- v2.0：Dreaming 深度整合 ---------- */
  dreamingEnabled: true,
  dreamingIntervalHours: 24,
  dreamingMinNewMemories: 6,
  // 热度变化触发：有效命中（次数/最后命中时间）变化达到这个条数也会触发一次。
  dreamingHeatThreshold: 3,
  dreamingRunsPerDay: 2,
  dreamingMaxBytes: 48000,
  dreamingMaxTokens: 12000,
  dreamingMaxOutputTokens: 3000,
  dreamingTimeoutMs: 180000,
  dreamingCooldownMs: 300000,
  dreamingStartupDelayMs: 90000,
  dreamingCandidates: 60,

  /* ---------- v2.0：Archive 冷库 ---------- */
  archiveRecallLimit: 20,
});

const POSITIVE_INT_KEYS = [
  'consolidateMaxBytes',
  'consolidateMaxTokens',
  'curateMaxBytes',
  'curateMaxTokens',
  'curateEntriesShown',
  'keepSummaryVersions',
  'rawArchiveMaxBytes',
  'maxActiveMemories',
  'fallbackContextTokens',
  'maxSnapshotsPerSession',
  'digestMaxBytes',
  'digestMaxTokens',
  'digestRecentEntries',
  'digestSummaryMaxBytes',
  'digestIntervalTurns',
  'maxDigestMessages',
  'digestTotalBytes',
  'digestTotalTokens',
  'fullSyncChangedEntries',
  'longTermSynthesisMaxBytes',
  'longTermSynthesisMaxTokens',
  'longTermMaxOutputTokens',
  'curatorThresholdTurns',
  'curatorSessionsPerBatch',
  'curatorBatchesPerRun',
  'curatorTurnsPerSlice',
  'curatorMaxBytes',
  'curatorMaxTokens',
  'curatorBatchBytes',
  'curatorBatchTokens',
  'curatorMaxOutputTokens',
  'curatorTimeoutMs',
  'curatorEntriesShown',
  'curatorRunsPerHour',
  // v2.0
  'usageHalfLifeDays',
  'usageDailyHitCap',
  'usageCompactAfterLines',
  'coreMaxItems',
  'coreItemMaxBytes',
  'coreMinSources',
  'dreamingIntervalHours',
  'dreamingMinNewMemories',
  'dreamingHeatThreshold',
  'dreamingRunsPerDay',
  'dreamingMaxBytes',
  'dreamingMaxTokens',
  'dreamingMaxOutputTokens',
  'dreamingTimeoutMs',
  'dreamingCandidates',
  'archiveRecallLimit',
];

/** 允许为 0 的非负整数字段（关闭保护窗口、冷却/启动延迟为 0 等）。 */
const NON_NEGATIVE_INT_KEYS = [
  // 注入预算：0 = 不限（按实际数据注入，不按字节/token/窗口比例截断）。
  'scopeMaxBytes',
  'scopeMaxTokens',
  'maxBytes',
  'globalMaxBytes',
  'indexMaxBytes',
  'indexMaxTokens',
  'coreMaxBytes',
  'activityGraceHours',
  'curatorStartupDelayMs',
  'curatorCooldownMs',
  'dreamingStartupDelayMs',
  'dreamingCooldownMs',
];

/**
 * 合并并校验配置。
 * @param {Record<string, unknown>} input
 * @returns {typeof DEFAULT_CONFIG & Record<string, unknown>}
 */
export function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  for (const key of POSITIVE_INT_KEYS) {
    const value = Number(config[key]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`dsh-memory-feiyu: ${key} 必须是正整数`);
    }
    config[key] = value;
  }
  for (const key of NON_NEGATIVE_INT_KEYS) {
    const value = Number(config[key]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`dsh-memory-feiyu: ${key} 必须是非负整数`);
    }
    config[key] = value;
  }
  config.injectIndex = config.injectIndex !== false;
  config.autoSummary = config.autoSummary !== false;
  config.curatorEnabled = config.curatorEnabled !== false;
  config.curatorBackfill = config.curatorBackfill === true;
  config.curatorDurabilityGate = config.curatorDurabilityGate !== false;
  config.fullSyncOnDelete = config.fullSyncOnDelete !== false;
  config.coreEnabled = config.coreEnabled !== false;
  config.dreamingEnabled = config.dreamingEnabled !== false;
  config.coreOverlapThreshold = Math.max(0, Math.min(0.95, Number(config.coreOverlapThreshold) || DEFAULT_CONFIG.coreOverlapThreshold));
  if (!['observe', 'enforce'].includes(String(config.hitStatsMode))) {
    throw new TypeError('dsh-memory-feiyu: hitStatsMode 必须是 observe 或 enforce');
  }
  config.hitStatsMode = String(config.hitStatsMode);
  if (!['off', 'preview', 'apply'].includes(config.longTermMode)) {
    throw new TypeError('dsh-memory-feiyu: longTermMode 必须是 off、preview 或 apply');
  }

  if (typeof config.privateWorkspace !== 'string' || config.privateWorkspace.trim() === '') {
    throw new TypeError('dsh-memory-feiyu: privateWorkspace 必填');
  }
  if (!path.isAbsolute(config.privateWorkspace)) {
    throw new TypeError('dsh-memory-feiyu: privateWorkspace 必须是绝对路径');
  }
  if (typeof config.memoryDir !== 'string' || config.memoryDir.trim() === '') {
    throw new TypeError('dsh-memory-feiyu: memoryDir 必填');
  }
  if (!path.isAbsolute(config.memoryDir)) {
    throw new TypeError('dsh-memory-feiyu: memoryDir 必须是绝对路径');
  }
  if (config.globalMemoryDir !== undefined && config.globalMemoryDir !== '' && !path.isAbsolute(config.globalMemoryDir)) {
    throw new TypeError('dsh-memory-feiyu: globalMemoryDir 必须是绝对路径');
  }
  if (config.globalMemoryDir === undefined) config.globalMemoryDir = '';

  // 预算字段统一语义：0 = 不限；只有正数才做相互校验。
  if (config.maxBytes > 0 && config.maxBytes < config.scopeMaxBytes + config.globalMaxBytes) {
    throw new TypeError('dsh-memory-feiyu: maxBytes 必须至少等于 scopeMaxBytes + globalMaxBytes');
  }
  if (config.coreMaxBytes > 0 && config.maxBytes > 0 && config.coreMaxBytes >= config.maxBytes) {
    throw new TypeError('dsh-memory-feiyu: coreMaxBytes 必须小于 maxBytes');
  }
  if (config.coreMaxBytes > 0 && config.coreItemMaxBytes > config.coreMaxBytes) {
    throw new TypeError('dsh-memory-feiyu: coreItemMaxBytes 不能大于 coreMaxBytes');
  }
  if (!(config.contextBudgetRatio >= 0 && config.contextBudgetRatio <= 0.08 + 1e-9)) {
    throw new TypeError('dsh-memory-feiyu: contextBudgetRatio 必须在 [0, 0.08] 内（0 = 不限）');
  }
  if (!(config.contextBudgetHardRatio >= 0 && config.contextBudgetHardRatio <= 0.1 + 1e-9)) {
    throw new TypeError('dsh-memory-feiyu: contextBudgetHardRatio 必须在 [0, 0.10] 内（0 = 不限）');
  }
  if (config.contextBudgetRatio > 0 && config.contextBudgetHardRatio > 0
      && config.contextBudgetHardRatio < config.contextBudgetRatio) {
    throw new TypeError('dsh-memory-feiyu: contextBudgetHardRatio 不能小于 contextBudgetRatio');
  }
  return config;
}

/**
 * 依据实际模型上下文窗口计算长期记忆预算。
 * 默认 0：不按模型窗口比例封顶。显式启用两个正数比例时，按配置计算；
 * 拿不到窗口时使用 fallbackContextTokens（默认 8192）。
 * @param {number|undefined|null} contextWindow
 * @param {typeof DEFAULT_CONFIG} config
 */
export function resolveContextBudget(contextWindow, config = DEFAULT_CONFIG) {
  const ratio = Number(config.contextBudgetRatio ?? 0);
  const hardRatio = Number(config.contextBudgetHardRatio ?? 0);
  // 0 = 不限：整块记忆注入不再按模型窗口比例封顶。
  if (!(ratio > 0)) {
    return {
      tokens: Number.POSITIVE_INFINITY,
      bytes: Number.POSITIVE_INFINITY,
      hardTokens: Number.POSITIVE_INFINITY,
      contextWindow: Number.isSafeInteger(contextWindow) && contextWindow > 0 ? contextWindow : null,
      source: 'unlimited',
      ratio: 0,
      hardRatio: hardRatio > 0 ? hardRatio : 0,
    };
  }
  if (Number.isSafeInteger(contextWindow) && contextWindow > 0) {
    const normalTokens = Math.floor(contextWindow * ratio);
    const hardTokens = Math.floor(contextWindow * hardRatio);
    const tokens = Math.max(1, Math.min(normalTokens, hardTokens));
    return {
      tokens,
      bytes: tokens * 4,
      hardTokens,
      contextWindow,
      source: 'model',
      ratio,
      hardRatio,
    };
  }
  const tokens = config.fallbackContextTokens ?? 8192;
  return {
    tokens,
    bytes: tokens * 4,
    hardTokens: tokens,
    contextWindow: null,
    source: 'fallback',
    ratio,
    hardRatio,
  };
}

/** 规范化路径，Windows 下大小写不敏感。 */
function comparablePath(value) {
  const resolved = path.resolve(String(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * 判断 cwd 是否位于私人工作区内（含工作区根目录），同名前缀目录不算（例如 …/workspace2）。
 * @param {string|undefined|null} cwd
 * @param {string|undefined|null} privateWorkspace
 */
export function isWorkspacePath(cwd, privateWorkspace) {
  if (typeof cwd !== 'string' || cwd === '') return false;
  if (typeof privateWorkspace !== 'string' || privateWorkspace === '') return false;
  const target = comparablePath(cwd);
  const root = comparablePath(privateWorkspace);
  const relative = path.relative(root, target);
  if (relative === '') return true;
  if (relative.startsWith('..')) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

/** 判断一个 agent 是否属于私人工作区。 */
export function isWorkspaceAgent(agent, privateWorkspace) {
  const cwd = agent?.session?.header?.cwd;
  return isWorkspacePath(cwd, privateWorkspace);
}

/** 供日志使用的工作区标签。 */
export function workspaceLabel(privateWorkspace) {
  return path.basename(path.resolve(privateWorkspace));
}
