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
  contextBudgetRatio: 0.08,
  contextBudgetHardRatio: 0.1,
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
});

const POSITIVE_INT_KEYS = [
  'scopeMaxBytes',
  'scopeMaxTokens',
  'maxBytes',
  'globalMaxBytes',
  'consolidateMaxBytes',
  'consolidateMaxTokens',
  'curateMaxBytes',
  'curateMaxTokens',
  'curateEntriesShown',
  'keepSummaryVersions',
  'rawArchiveMaxBytes',
  'maxActiveMemories',
  'indexMaxBytes',
  'indexMaxTokens',
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
  'curatorStartupDelayMs',
  'curatorCooldownMs',
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
  config.injectIndex = config.injectIndex !== false;
  config.autoSummary = config.autoSummary !== false;
  config.curatorEnabled = config.curatorEnabled !== false;
  config.curatorBackfill = config.curatorBackfill === true;
  config.fullSyncOnDelete = config.fullSyncOnDelete !== false;
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

  if (config.maxBytes < config.scopeMaxBytes + config.globalMaxBytes) {
    throw new TypeError('dsh-memory-feiyu: maxBytes 必须至少等于 scopeMaxBytes + globalMaxBytes');
  }
  if (!(config.contextBudgetRatio > 0 && config.contextBudgetRatio <= 0.08 + 1e-9)) {
    throw new TypeError('dsh-memory-feiyu: contextBudgetRatio 必须在 (0, 0.08] 内');
  }
  if (!(config.contextBudgetHardRatio >= config.contextBudgetRatio && config.contextBudgetHardRatio <= 0.1 + 1e-9)) {
    throw new TypeError('dsh-memory-feiyu: contextBudgetHardRatio 必须在 [contextBudgetRatio, 0.10] 内');
  }
  return config;
}

/**
 * 依据实际模型上下文窗口计算长期记忆预算。
 * 正常使用 8%，绝对不超过 10%；拿不到窗口时回退 8192 tokens。
 * @param {number|undefined|null} contextWindow
 * @param {typeof DEFAULT_CONFIG} config
 */
export function resolveContextBudget(contextWindow, config = DEFAULT_CONFIG) {
  const ratio = config.contextBudgetRatio ?? 0.08;
  const hardRatio = config.contextBudgetHardRatio ?? 0.1;
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
 * 判断 cwd 是否位于私人工作区内（含工作区根目录），防止相似前缀目录误匹配。
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
