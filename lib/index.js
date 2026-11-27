/**
 * dsh-memory-feiyu 的 DSH Host 插件入口。
 * 只在 privateWorkspace 内注册记忆工具并注入记忆快照；其他工作区完全隔离。
 *
 * 本文件刻意不 import 任何 DSH 运行时包：插件只依赖公开的 ctx 服务约定，
 * 这样既能被 DSH 加载，也能在 node --test 中对核心模块做独立测试。
 * @module dsh-memory-feiyu
 */
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_CONFIG, normalizeConfig, isWorkspaceAgent, isWorkspacePath } from './config.js';
import { MemoryStore, assertNoSecrets } from './store.js';
import { composeCurationContext } from './feiyu.js';
import {
  buildMemoryUpdate,
  buildSnapshot,
  entriesSyncState,
  hasSnapshotMessage,
  lastMemorySync,
  MEMORY_SOURCE_KIND,
} from './injection.js';
import { CuratorService, extractTurns, isRootWorkspaceSession } from './curator.js';
import { lockSummaries, scrubSummaryForDeleted } from './summary.js';
import { searchMemories } from './search.js';
import { byteLength, estimateTokens, sha256 } from './text.js';
import { UsageStore } from './usage.js';
import { rankByActivity, describeActivity } from './activity.js';
import { FloatingCore, parseCore, renderCore } from './core.js';
import { DreamingService, formatDreamRunResult } from './dreaming.js';

// 版本号只从 package.json 读，避免诊断里出现「代码已升级、版本还写着旧值」。
const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export const name = 'dsh-memory-feiyu';

/** 设置页可实时修改的字段；它们由 Settings 服务以 volatile 引用传入。 */
const VOLATILE_KEYS = [
  'scopeMaxBytes',
  'scopeMaxTokens',
  'maxBytes',
  'maxActiveMemories',
  'keepSummaryVersions',
  'injectIndex',
  'indexMaxBytes',
  'indexMaxTokens',
  'autoSummary',
  'maxSnapshotsPerSession',
  // v2.0：命中/活跃度/浮动核心/Dreaming 都可即时调整
  'hitStatsMode',
  'usageHalfLifeDays',
  'usageDailyHitCap',
  'activityGraceHours',
  'coreEnabled',
  'coreMaxItems',
  'coreMaxBytes',
  'coreItemMaxBytes',
  'coreMinSources',
  'dreamingEnabled',
  'dreamingIntervalHours',
  'dreamingMinNewMemories',
  'dreamingRunsPerDay',
  'dreamingHeatThreshold',
  'dreamingMaxOutputTokens',
  'archiveRecallLimit',
];

/** 运行时配置。volatile 字段会出现在设置页，并即时影响记忆行为。 */
export const Config = z.object({
  privateWorkspace: z.string().required(),
  memoryDir: z.string().required(),
  globalMemoryDir: z.string().default(''),
  scopeMaxBytes: z.number().step(1).min(0).default(DEFAULT_CONFIG.scopeMaxBytes).volatile(),
  scopeMaxTokens: z.number().step(1).min(0).default(DEFAULT_CONFIG.scopeMaxTokens).volatile(),
  maxBytes: z.number().step(1).min(0).default(DEFAULT_CONFIG.maxBytes).volatile(),
  globalMaxBytes: z.number().step(1).min(0).default(DEFAULT_CONFIG.globalMaxBytes),
  consolidateMaxBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.consolidateMaxBytes),
  consolidateMaxTokens: z.number().step(1).min(1).default(DEFAULT_CONFIG.consolidateMaxTokens),
  curateMaxBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.curateMaxBytes),
  curateMaxTokens: z.number().step(1).min(1).default(DEFAULT_CONFIG.curateMaxTokens),
  curateEntriesShown: z.number().step(1).min(1).default(DEFAULT_CONFIG.curateEntriesShown),
  keepSummaryVersions: z.number().step(1).min(1).default(DEFAULT_CONFIG.keepSummaryVersions).volatile(),
  rawArchiveMaxBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.rawArchiveMaxBytes),
  maxActiveMemories: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxActiveMemories).volatile(),
  injectIndex: z.boolean().default(DEFAULT_CONFIG.injectIndex).volatile(),
  indexMaxBytes: z.number().step(1).min(0).default(DEFAULT_CONFIG.indexMaxBytes).volatile(),
  indexMaxTokens: z.number().step(1).min(0).default(DEFAULT_CONFIG.indexMaxTokens).volatile(),
  contextBudgetRatio: z.number().min(0).max(0.08).default(DEFAULT_CONFIG.contextBudgetRatio),
  contextBudgetHardRatio: z.number().min(0).max(0.1).default(DEFAULT_CONFIG.contextBudgetHardRatio),
  fallbackContextTokens: z.number().step(1).min(1).default(DEFAULT_CONFIG.fallbackContextTokens),
  autoSummary: z.boolean().default(DEFAULT_CONFIG.autoSummary).volatile(),
  maxSnapshotsPerSession: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxSnapshotsPerSession).volatile(),
  digestMaxBytes: z.number().step(1).min(256).default(DEFAULT_CONFIG.digestMaxBytes),
  digestMaxTokens: z.number().step(1).min(64).default(DEFAULT_CONFIG.digestMaxTokens),
  digestRecentEntries: z.number().step(1).min(1).default(DEFAULT_CONFIG.digestRecentEntries),
  digestSummaryMaxBytes: z.number().step(1).min(200).default(DEFAULT_CONFIG.digestSummaryMaxBytes),
  digestIntervalTurns: z.number().step(1).min(1).default(DEFAULT_CONFIG.digestIntervalTurns),
  maxDigestMessages: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxDigestMessages),
  digestTotalBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.digestTotalBytes),
  digestTotalTokens: z.number().step(1).min(256).default(DEFAULT_CONFIG.digestTotalTokens),
  fullSyncChangedEntries: z.number().step(1).min(1).default(DEFAULT_CONFIG.fullSyncChangedEntries),
  fullSyncOnDelete: z.boolean().default(DEFAULT_CONFIG.fullSyncOnDelete),
  longTermSynthesisMaxBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.longTermSynthesisMaxBytes),
  longTermSynthesisMaxTokens: z.number().step(1).min(100).default(DEFAULT_CONFIG.longTermSynthesisMaxTokens),
  longTermMaxOutputTokens: z.number().step(1).min(100).default(DEFAULT_CONFIG.longTermMaxOutputTokens),
  longTermMode: z.string().default(DEFAULT_CONFIG.longTermMode),
  curatorBackfill: z.boolean().default(DEFAULT_CONFIG.curatorBackfill),
  curatorEnabled: z.boolean().default(DEFAULT_CONFIG.curatorEnabled),
  curatorThresholdTurns: z.number().step(1).min(1).default(DEFAULT_CONFIG.curatorThresholdTurns),
  curatorSessionsPerBatch: z.number().step(1).min(1).max(32).default(DEFAULT_CONFIG.curatorSessionsPerBatch),
  curatorBatchesPerRun: z.number().step(1).min(1).max(32).default(DEFAULT_CONFIG.curatorBatchesPerRun),
  curatorTurnsPerSlice: z.number().step(1).min(1).max(50).default(DEFAULT_CONFIG.curatorTurnsPerSlice),
  curatorMaxBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.curatorMaxBytes),
  curatorMaxTokens: z.number().step(1).min(100).default(DEFAULT_CONFIG.curatorMaxTokens),
  curatorBatchBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.curatorBatchBytes),
  curatorBatchTokens: z.number().step(1).min(100).default(DEFAULT_CONFIG.curatorBatchTokens),
  curatorMaxOutputTokens: z.number().step(1).min(100).default(DEFAULT_CONFIG.curatorMaxOutputTokens),
  curatorTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONFIG.curatorTimeoutMs),
  curatorEntriesShown: z.number().step(1).min(1).default(DEFAULT_CONFIG.curatorEntriesShown),
  curatorRunsPerHour: z.number().step(1).min(1).default(DEFAULT_CONFIG.curatorRunsPerHour),
  curatorStartupDelayMs: z.number().step(1).min(0).default(DEFAULT_CONFIG.curatorStartupDelayMs),
  curatorCooldownMs: z.number().step(1).min(0).default(DEFAULT_CONFIG.curatorCooldownMs),
  curatorDurabilityGate: z.boolean().default(DEFAULT_CONFIG.curatorDurabilityGate),
  // v2.0
  hitStatsMode: z.string().default(DEFAULT_CONFIG.hitStatsMode).volatile(),
  usageHalfLifeDays: z.number().step(1).min(1).default(DEFAULT_CONFIG.usageHalfLifeDays).volatile(),
  usageDailyHitCap: z.number().step(1).min(1).default(DEFAULT_CONFIG.usageDailyHitCap).volatile(),
  activityGraceHours: z.number().step(1).min(0).default(DEFAULT_CONFIG.activityGraceHours).volatile(),
  usageCompactAfterLines: z.number().step(1).min(200).default(DEFAULT_CONFIG.usageCompactAfterLines),
  coreEnabled: z.boolean().default(DEFAULT_CONFIG.coreEnabled).volatile(),
  coreMaxItems: z.number().step(1).min(1).max(10).default(DEFAULT_CONFIG.coreMaxItems).volatile(),
  coreItemMaxBytes: z.number().step(1).min(120).default(DEFAULT_CONFIG.coreItemMaxBytes).volatile(),
  coreMaxBytes: z.number().step(1).min(0).default(DEFAULT_CONFIG.coreMaxBytes).volatile(),
  coreMinSources: z.number().step(1).min(1).default(DEFAULT_CONFIG.coreMinSources).volatile(),
  coreOverlapThreshold: z.number().min(0).max(0.95).default(DEFAULT_CONFIG.coreOverlapThreshold),
  dreamingEnabled: z.boolean().default(DEFAULT_CONFIG.dreamingEnabled).volatile(),
  dreamingIntervalHours: z.number().step(1).min(1).default(DEFAULT_CONFIG.dreamingIntervalHours).volatile(),
  dreamingMinNewMemories: z.number().step(1).min(1).default(DEFAULT_CONFIG.dreamingMinNewMemories).volatile(),
  dreamingRunsPerDay: z.number().step(1).min(1).default(DEFAULT_CONFIG.dreamingRunsPerDay).volatile(),
  dreamingHeatThreshold: z.number().step(1).min(1).default(DEFAULT_CONFIG.dreamingHeatThreshold).volatile(),
  dreamingMaxBytes: z.number().step(1).min(4000).default(DEFAULT_CONFIG.dreamingMaxBytes),
  dreamingMaxTokens: z.number().step(1).min(1000).default(DEFAULT_CONFIG.dreamingMaxTokens),
  dreamingMaxOutputTokens: z.number().step(1).min(200).default(DEFAULT_CONFIG.dreamingMaxOutputTokens).volatile(),
  dreamingTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONFIG.dreamingTimeoutMs),
  dreamingCooldownMs: z.number().step(1).min(0).default(DEFAULT_CONFIG.dreamingCooldownMs),
  dreamingStartupDelayMs: z.number().step(1).min(0).default(DEFAULT_CONFIG.dreamingStartupDelayMs),
  dreamingCandidates: z.number().step(1).min(1).default(DEFAULT_CONFIG.dreamingCandidates),
  archiveRecallLimit: z.number().step(1).min(1).default(DEFAULT_CONFIG.archiveRecallLimit).volatile(),
});

/** volatile 字段在配置里是引用；读取当前有效值。 */
function readConfig(rawConfig) {
  const plain = { ...rawConfig };
  for (const key of VOLATILE_KEYS) {
    const value = plain[key];
    if (value && typeof value.get === 'function') plain[key] = value.get();
  }
  return normalizeConfig(plain);
}

/** 本地创建一条带稳定身份的 user 消息，避免依赖 dsh-llm 的构建产物。 */
function createUserMessage(input) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: structuredClone(input.content),
    source: structuredClone(input.source),
  });
}

function logWarn(ctx, message, error) {
  try {
    ctx.logger?.warn?.(`[dsh-memory-feiyu] ${message}${error ? `: ${String(error?.message ?? error)}` : ''}`);
  } catch {
    // 日志失败不影响记忆功能。
  }
}

/* ------------------------- 设置页写操作的本机 HTTP 接口 ------------------------- */

const API_PREFIX = '/api/dsh-memory-feiyu';
const CLIENT_HEADER = 'x-dsh-memory-client';
const CLIENT_VALUE = 'dsh-memory-feiyu/1';
const MAX_BODY = 64 * 1024;

function jsonReply(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY) throw new Error('请求体过大');
    chunks.push(buffer);
  }
  if (length === 0) return {};
  const text = Buffer.concat(chunks, length).toString('utf8');
  if (text.includes('\uFFFD')) throw new Error('请求体不是合法 UTF-8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}


function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

/** 是否为私人工作区的根会话（子代理、fork 子会话、其他工作区都拒绝）。 */
function isRootWorkspaceAgent(agent, privateWorkspace) {
  if (!isWorkspaceAgent(agent, privateWorkspace)) return false;
  const header = agent?.session?.header;
  if (!header) return false;
  if (header.parentSession) return false;
  if (header.origin === 'subagent') return false;
  if (Number(header.delegationDepth ?? 0) > 0) return false;
  return true;
}

function parseTraceText(trace) {
  const text = String(trace ?? '');
  const session = /session=([^\s]+)/.exec(text)?.[1] ?? '';
  const turn = Number.parseInt(/turn=(\d+)/.exec(text)?.[1] ?? '', 10);
  const seq = /seq=(\d+)(?:-(\d+))?/.exec(text);
  return {
    sessionId: session,
    turn: Number.isInteger(turn) ? turn : 0,
    seqStart: seq ? Number.parseInt(seq[1], 10) : 0,
    seqEnd: seq ? Number.parseInt(seq[2] ?? seq[1], 10) : 0,
  };
}

function quoteHash(quote) {
  return createHash('sha256').update(String(quote ?? ''), 'utf8').digest('hex');
}

function recentConversationText(agent, maxTurns = 2, maxChars = 6000) {
  try {
    const events = agent?.session?.snapshotEvents?.() ?? [];
    const turns = extractTurns(events).slice(-maxTurns);
    let text = turns.map((turn) => {
      const messages = turn.messages.map((message) => `${message.role.toUpperCase()}: ${message.text}`).join('\n');
      return `[turn ${turn.turn} | seq ${turn.startSeq}-${turn.endSeq}]\n${messages}`;
    }).join('\n\n');
    if (!text) {
      const messages = (agent?.session?.deriveMessages?.() ?? []).slice(-6);
      text = messages.map((message) => {
        const content = Array.isArray(message?.content)
          ? message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
          : String(message?.content ?? '');
        return `${String(message?.role ?? 'user').toUpperCase()}: ${content}`;
      }).join('\n');
    }
    const chars = Array.from(text);
    return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join('')}…` : text;
  } catch {
    return '';
  }
}

/** 四层溯源校验：指纹、会话存在、坐标命中、正文支持（启发式，不冒充语义验证）。 */
async function buildTraceReport(entry, sessionQuery, privateWorkspace) {
  const hashVerdict = MemoryStore.verifyQuote(entry);
  const evidence = Array.isArray(entry.evidence) && entry.evidence.length > 0
    ? entry.evidence
    : (entry.quote ? [{ ...parseTraceText(entry.trace), quote: entry.quote, quoteHash: entry.quoteHash }] : []);
  const levels = {
    quoteHash: hashVerdict,
    session: evidence.length === 0 ? 'legacy' : 'unknown',
    location: evidence.length === 0 ? 'legacy' : 'unknown',
    support: evidence.length === 0 ? 'legacy' : 'unverified',
  };
  const details = [];
  if (evidence.length > 0 && sessionQuery?.readSession) {
    for (const item of evidence) {
      if (!item.sessionId) continue;
      try {
        const loaded = await sessionQuery.readSession(item.sessionId);
        const header = loaded?.header;
        if (!header || !isWorkspacePath(header.cwd, privateWorkspace)) {
          levels.session = 'missing';
          details.push(`${item.sessionId}: 会话不存在或不属于私人工作区`);
          continue;
        }
        levels.session = 'verified';
        const turns = extractTurns(loaded.events ?? []);
        const turn = turns.find((candidate) => candidate.turn === Number(item.turn));
        if (!turn) {
          levels.location = 'mismatch';
          details.push(`${item.sessionId}: 找不到 turn ${item.turn}`);
          continue;
        }
        const start = Number(item.seqStart) || turn.startSeq;
        const end = Number(item.seqEnd) || turn.endSeq;
        const inRange = start >= turn.startSeq && end <= turn.endSeq && String(turn.text).includes(String(item.quote));
        levels.location = inRange ? 'verified' : 'mismatch';
        if (!inRange) details.push(`${item.sessionId}: 引文不在 turn ${item.turn} 的 seq ${start}-${end} 内`);
        if (String(item.quoteHash) !== quoteHash(item.quote)) {
          levels.quoteHash = 'mismatch';
          details.push(`${item.sessionId}: 证据引文哈希不一致`);
        }
        const normalizedQuote = String(item.quote).replace(/\s+/g, ' ').trim();
        const normalizedContent = String(entry.content ?? '').replace(/\s+/g, ' ');
        if (normalizedQuote && normalizedContent.includes(normalizedQuote)) levels.support = 'quote-in-content';
        else if (normalizedQuote && normalizedQuote.split(/[，。；、,.;\s]+/).filter((part) => part.length >= 2).some((part) => normalizedContent.includes(part))) levels.support = 'heuristic-overlap';
      } catch (error) {
        levels.session = 'missing';
        details.push(`${item.sessionId}: ${String(error?.message ?? error)}`);
      }
    }
  }
  let overall = 'unverified';
  if (levels.quoteHash === 'mismatch') overall = 'mismatch';
  else if (levels.quoteHash === 'legacy') overall = 'legacy';
  else if (levels.session === 'verified' && levels.location === 'verified') overall = 'source-verified';
  else if (levels.quoteHash === 'verified') overall = 'hash-only';
  return { levels, overall, evidence, details };
}
function textTool(definition) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    async execute(args, exec) {
      return definition.execute(args ?? {}, exec);
    },
  };
}

/** 格式化检索结果：包含完整原始记录和原始 ID。 */
function formatSearchResults(results, queryLabel) {
  if (results.length === 0) return `没有找到与「${queryLabel}」匹配的记忆。`;
  const blocks = results.map((entry) => {
    const lines = [
      `## ${entry.id}`,
      `- 时间: ${entry.createdAt}`,
      `- 标签: ${(entry.tags ?? []).join(', ') || '无标签'}`,
      `- 来源: ${entry.source || '未注明'}`,
      `- 上下文: ${entry.context || '未注明'}`,
      `- 重要度: ${entry.importance ?? 1}`,
      `- 概述: ${entry.summary || '（无概述）'}`,
      `- 相关度: ${entry.score ?? 0}`,
      '- 正文:',
      ...String(entry.content ?? '').split('\n').map((line) => `  ${line}`),
    ];
    return lines.join('\n');
  });
  return `找到 ${results.length} 条原始记忆：\n\n${blocks.join('\n\n')}`;
}

/** 格式化回忆结果：明确标出层次，并说明回忆不等于恢复。 */
function formatRecallResults(results, queryLabel, scope = 'archive') {
  const scopeLabel = { archive: '冷库', all: '冷库 + 短期', active: '短期' }[scope] ?? scope;
  if (results.length === 0) return `在${scopeLabel}里没有找到与「${queryLabel}」匹配的记忆。`;
  const blocks = results.map((entry) => {
    const layer = entry.layer === 'archive' ? '冷库（未参与日常注入）' : '短期（活动）';
    return [
      `## ${entry.id}`,
      `- 所在层: ${layer}${entry.archivedAt ? ` · 归档于 ${entry.archivedAt}` : ''}`,
      `- 时间: ${entry.createdAt}`,
      `- 标签: ${(entry.tags ?? []).join(', ') || '无标签'}`,
      `- 概述: ${entry.summary || '（无概述）'}`,
      `- 相关度: ${entry.score ?? 0}`,
      '- 正文:',
      ...String(entry.content ?? '').split('\n').map((line) => `  ${line}`),
    ].join('\n');
  });
  return [
    `在${scopeLabel}里找到 ${results.length} 条记忆：`,
    '（回忆是只读的：冷库条目不会影响日常注入与默认检索，也不会自动搬回短期记忆。确实需要重新启用时，用 memory_restore 恢复。）',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

/**
 * 插件入口。
 * @param {{tools: object, get: Function, on: Function, effect: Function, logger?: object}} ctx
 * @param {Record<string, unknown>} rawConfig
 */
export async function apply(ctx, rawConfig) {
  let config = readConfig(rawConfig);
  const usage = new UsageStore({
    memoryDir: config.memoryDir,
    dailyHitCap: config.usageDailyHitCap,
    compactAfterLines: config.usageCompactAfterLines,
    logger: ctx.logger,
  });
  await usage.init();
  const store = new MemoryStore({
    memoryDir: config.memoryDir,
    globalMemoryDir: config.globalMemoryDir,
    maxActiveMemories: config.maxActiveMemories,
    rawArchiveMaxBytes: config.rawArchiveMaxBytes,
    keepSummaryVersions: config.keepSummaryVersions,
    maxContentBytes: config.consolidateMaxBytes,
    usage,
    usageHalfLifeDays: config.usageHalfLifeDays,
    activityGraceHours: config.activityGraceHours,
    logger: ctx.logger,
  });
  await store.init();
  const core = new FloatingCore({
    memoryDir: config.memoryDir,
    maxItems: config.coreMaxItems,
    itemMaxBytes: config.coreItemMaxBytes,
    minSources: config.coreMinSources,
    overlapThreshold: config.coreOverlapThreshold,
    logger: ctx.logger,
  });
  await core.init();

  let lastRootAgent = null;
  let sessionQueryService = null;
  const curator = new CuratorService({
    store,
    config,
    privateWorkspace: config.privateWorkspace,
    logger: ctx.logger,
  });
  await curator.init();
  const dreaming = new DreamingService({
    store,
    core,
    curator,
    config,
    logger: ctx.logger,
  });
  await dreaming.init();

  function refreshCurator() {
    curator.config = { ...config };
    curator.privateWorkspace = config.privateWorkspace;
    try {
      curator.llm = ctx.get?.('llm') ?? curator.llm;
    } catch {
      // llm 服务未就绪时保持为空，后续事件再刷新。
    }
    let agent = lastRootAgent;
    if (!agent) {
      try {
        const agents = ctx.get?.('agents');
        agent = agents?.roots?.()[0] ?? agents?.list?.()[0];
      } catch {
        agent = null;
      }
    }
    try {
      let selection = agent?.model?.current?.();
      if (!selection?.provider || !selection?.model) {
        try {
          selection = ctx.get?.('agentDefaultModel')?.currentSelection?.();
        } catch {
          selection = null;
        }
      }
      curator.route = selection?.provider && selection?.model
        ? { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
        : null;
      if (agent) lastRootAgent = agent;
    } catch {
      curator.route = null;
    }
    // Dreaming 复用 Curator 的模型路由与重试逻辑。
    dreaming.config = { ...config };
    dreaming.llm = curator.llm;
    dreaming.route = curator.route;
  }
  refreshCurator();

  ctx.effect(() => () => {
    void curator.close();
    void dreaming.close();
    return Promise.all([store.close(), usage.close(), core.close()]);
  }, 'dsh-memory-feiyu.store');

  // 启动诊断：设置页接口是否注册成功，写进记忆目录供排查（不含任何记忆内容）。
  const diagnostics = {
    startedAt: new Date().toISOString(),
    packageVersion: PACKAGE_VERSION,
    sourceHash: '',
    injectAvailable: typeof ctx.inject === 'function',
    webServerInjected: false,
    auth: 'pending',
    tools: 0,
    curatorAvailable: false,
    curatorEnabled: config.curatorEnabled === true,
    curatorBackfill: config.curatorBackfill === true,
    longTermMode: config.longTermMode ?? 'off',
    coreEnabled: config.coreEnabled !== false,
    dreamingEnabled: config.dreamingEnabled !== false,
    coreCount: 0,
    usageTracked: 0,
    archiveCount: 0,
    routes: 0,
    errors: [],
  };
  try {
    const hash = createHash('sha256');
    for (const file of ['store.js', 'index.js', 'injection.js', 'feiyu.js', 'curator.js', 'dreaming.js', 'core.js', 'usage.js', 'activity.js', 'summary.js', 'config.js', 'search.js', 'text.js']) {
      hash.update(await fs.readFile(new URL(`./${file}`, import.meta.url), 'utf8'));
    }
    diagnostics.sourceHash = hash.digest('hex');
  } catch {
    diagnostics.sourceHash = 'unavailable';
  }
  const runtimeFile = path.join(config.memoryDir, 'runtime.json');
  const writeDiagnostics = async () => {
    try {
      await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
      await fs.writeFile(runtimeFile, `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');
    } catch {
      // 诊断写盘失败不影响记忆功能。
    }
  };
  const diagnosticsTimer = setTimeout(() => { void writeDiagnostics(); }, 6000);
  diagnosticsTimer.unref?.();

  // 关闭 Settings 的自动生成表单；记忆页由本插件自己提供。
  ctx.inject?.(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'dsh-memory-feiyu.settings',
    );
  });

  /** 重新读取设置页写入的 volatile 字段，并同步可变的存储上限。 */
  function refreshConfig() {
    try {
      const next = readConfig(rawConfig);
      config = next;
      store.maxActiveMemories = next.maxActiveMemories;
      store.keepSummaryVersions = next.keepSummaryVersions;
      store.usageHalfLifeDays = next.usageHalfLifeDays;
      store.activityGraceHours = next.activityGraceHours;
      store.hitStatsMode = next.hitStatsMode;
      usage.dailyHitCap = next.usageDailyHitCap;
      core.maxItems = next.coreMaxItems;
      core.itemMaxBytes = next.coreItemMaxBytes;
      core.minSources = next.coreMinSources;
      core.overlapThreshold = next.coreOverlapThreshold;
      refreshCurator();
    } catch (error) {
      logWarn(ctx, '设置值无效，继续使用上一次有效配置', error);
    }
    return config;
  }

  const workspaceOnly = ({ agent }) => isRootWorkspaceAgent(agent, config.privateWorkspace);

  function assertToolAccess(agent) {
    if (!isWorkspaceAgent(agent, config.privateWorkspace)) {
      throw new Error('该记忆工具只在私人工作区可用');
    }
    if (!isRootWorkspaceAgent(agent, config.privateWorkspace)) {
      throw new Error('该记忆工具只允许私人工作区的根会话使用；子代理不得读写长期记忆');
    }
  }

  async function resolveContextWindow(agent) {
    try {
      const selection = agent?.model?.current?.();
      if (!selection?.provider || !selection?.model) return undefined;
      const llm = ctx.get?.('llm');
      if (!llm?.resolveModelInfo) return undefined;
      const info = await llm.resolveModelInfo(selection.provider, selection.model);
      return info?.context?.contextWindow;
    } catch (error) {
      logWarn(ctx, '读取模型上下文窗口失败，使用 8192 tokens 回退', error);
      return undefined;
    }
  }

  /**
   * 注入时再次过滤已删除短期记忆支持的长期 claim。
   * 即使磁盘清洗失败，也不会把“只由被删记忆支持的事实”送进模型。
   */
  function filterSummaryForInjection(summary, deletedEntries) {
    if (!summary) return { text: summary, omittedLines: 0 };
    const scrubbed = scrubSummaryForDeleted(summary, (deletedEntries ?? []).map((entry) => entry.id), deletedEntries);
    if (scrubbed.removedLines === 0) return { text: summary, omittedLines: 0 };
    return {
      text: `${scrubbed.text}\n\n（长期记忆中有 ${scrubbed.removedLines} 条仅由已删除短期记忆支持的 claim，已从本次注入中排除）`.trim(),
      omittedLines: scrubbed.removedLines,
    };
  }

  /** v2.0：当前要注入的浮动核心条目（关闭时不注入）。 */
  function coreItemsForInjection() {
    if (config.coreEnabled === false) return [];
    return core.list();
  }

  async function snapshotFor(agent) {
    refreshConfig();
    const [globalSummary, workspaceSummary, entries, deleted, contextWindow] = await Promise.all([
      store.readGlobalSummary(),
      store.readSummary(),
      store.listActive(),
      store.listDeleted(),
      resolveContextWindow(agent),
    ]);
    const filtered = filterSummaryForInjection(workspaceSummary, deleted);
    return buildSnapshot({
      globalSummary,
      workspaceSummary: filtered.text,
      entries,
      coreItems: coreItemsForInjection(),
      contextWindow,
      config,
    });
  }

  /* -------------------- v2.0 有效命中：只认“真的被用到的引用” -------------------- */

  // 每次工具检索先登记候选；轮末只有助手回复里真正引用了它，才计一次有效命中。
  // 自动注入、未使用的搜索结果、Curator/Dreaming 的整理扫描都不会进入这里。
  const hitCandidates = new Map();

  function registerHitCandidates(agent, ids) {
    const sessionId = agent?.session?.id;
    if (!sessionId) return;
    const list = (ids ?? []).filter((id) => /^mem-[0-9a-f]{8}$/.test(String(id)));
    if (list.length === 0) return;
    const bucket = hitCandidates.get(sessionId) ?? new Map();
    const now = Date.now();
    for (const id of list) bucket.set(id, { at: now });
    while (bucket.size > 80) bucket.delete(bucket.keys().next().value);
    hitCandidates.set(sessionId, bucket);
  }

  function assistantTextForTurn(agent, turn) {
    try {
      const events = agent?.session?.snapshotEvents?.() ?? [];
      const chunks = [];
      for (const event of events) {
        if (event?.type !== 'assistant/message') continue;
        const eventTurn = Number(event?.data?.turn);
        if (Number.isInteger(turn) && Number.isInteger(eventTurn) && eventTurn !== turn) continue;
        const content = event?.data?.message?.content;
        if (typeof content === 'string') chunks.push(content);
        else if (Array.isArray(content)) {
          chunks.push(content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n'));
        }
      }
      return chunks.join('\n');
    } catch {
      return '';
    }
  }

  function citesMemory(text, entry) {
    if (!text || !entry) return false;
    const haystack = String(text);
    if (haystack.includes(entry.id)) return true;
    // 容忍 "mem 1234abcd" / 大小写 / 连字符等写法差异。
    const squeezed = haystack.toLowerCase().replace(/[\s_\-—－]/g, '');
    const idBody = entry.id.replace(/^mem-/, '');
    if (squeezed.includes(`mem${idBody}`)) return true;
    if (entry.quote && entry.quote.length >= 8 && haystack.includes(entry.quote)) return true;
    const summary = String(entry.summary ?? '').replace(/\s+/g, ' ').trim();
    if (summary.length >= 12 && haystack.replace(/\s+/g, ' ').includes(summary)) return true;
    return false;
  }

  /** 该轮用户自己的发言（不含插件注入的记忆快照）。 */
  function userTextForTurn(agent, turn) {
    try {
      const events = agent?.session?.snapshotEvents?.() ?? [];
      const chunks = [];
      for (const event of events) {
        if (event?.type !== 'user/message') continue;
        const eventTurn = Number(event?.data?.turn);
        if (Number.isInteger(turn) && Number.isInteger(eventTurn) && eventTurn !== turn) continue;
        const message = event?.data?.message;
        if (message?.source?.kind === MEMORY_SOURCE_KIND) continue;
        chunks.push(memoryText(message));
      }
      return chunks.join('\n');
    } catch {
      return '';
    }
  }

  /** 轮末结算：助手引用或用户再次提及，都算这一轮"真的用到了"这条记忆。 */
  async function settleHits(agent, turn) {
    const sessionId = agent?.session?.id;
    if (!sessionId) return { counted: 0 };
    const bucket = hitCandidates.get(sessionId);
    if (!bucket || bucket.size === 0) return { counted: 0 };
    hitCandidates.delete(sessionId);
    const assistantText = assistantTextForTurn(agent, turn);
    const userText = userTextForTurn(agent, turn);
    if (!assistantText && !userText) return { counted: 0 };
    let entries;
    try {
      // 冷库里的记忆也可能被回忆并引用，所以两个层都要看。
      entries = await store.listAll(true, true);
    } catch (error) {
      logWarn(ctx, '读取短期记忆失败，本轮有效命中未记录', error);
      return { counted: 0 };
    }
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    let counted = 0;
    for (const id of bucket.keys()) {
      const entry = byId.get(id);
      if (!entry) continue;
      const fromAssistant = citesMemory(assistantText, entry);
      const fromUser = citesMemory(userText, entry);
      if (!fromAssistant && !fromUser) continue;
      const reason = fromAssistant && fromUser ? 'both' : fromAssistant ? 'assistant' : 'user';
      try {
        const result = await usage.recordHit(id, { sessionId, turn: Number(turn) || 0, reason });
        if (result.counted) counted += 1;
      } catch (error) {
        logWarn(ctx, '有效命中写入失败', error);
      }
    }
    return { counted };
  }

  function memoryText(message) {
    const parts = Array.isArray(message?.content) ? message.content : [];
    return parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
  }

  function pendingMemoryMessages(agent) {
    return (agent?.inbox?.nextStep ?? []).filter((message) => message?.source?.kind === MEMORY_SOURCE_KIND);
  }

  async function desiredMemoryUpdate(agent, messages, options = {}) {
    const [globalSummary, workspaceSummary, entries, deleted, contextWindow] = await Promise.all([
      store.readGlobalSummary(),
      store.readSummary(),
      store.listActive(),
      store.listDeleted(),
      resolveContextWindow(agent),
    ]);
    const coreItems = coreItemsForInjection();
    const filtered = filterSummaryForInjection(workspaceSummary, deleted);
    const currentEntries = entriesSyncState(entries);
    const summaryHash = sha256(filtered.text);
    const coreHash = sha256(JSON.stringify(coreItems.map((item) => [item.id, item.title, item.body, item.sources, item.pinned])));
    const sync = { summaryHash, entries: currentEntries, coreHash };
    const snapshot = buildSnapshot({
      globalSummary,
      workspaceSummary: filtered.text,
      entries,
      coreItems,
      contextWindow,
      config,
    });

    // pending 代表尚未提交的最新一次同步；用它作为基线，避免同一轮重复计算。
    const pending = pendingMemoryMessages(agent);
    const pendingLast = pending[pending.length - 1];
    const baseline = pendingLast?.source?.sync ?? lastMemorySync(messages)?.sync ?? null;
    if (!baseline || options.forceFull === true) {
      return { form: 'snapshot', text: snapshot.text, snapshot, sync, reason: baseline ? 'forced-full' : 'no-baseline' };
    }

    const changedEntries = entries.filter((entry) => baseline.entries?.[entry.id] !== currentEntries[entry.id]);
    const deletedEntries = Object.keys(baseline.entries ?? {})
      .filter((id) => !currentEntries[id])
      .map((id) => deleted.find((entry) => entry.id === id) ?? { id, summary: '', deletedAt: '' });
    const summaryChanged = baseline.summaryHash !== summaryHash;
    // 升级前的旧快照没有 coreHash：视为变化一次，之后按真实内容比较。
    const coreChanged = baseline.coreHash === undefined ? coreItems.length > 0 : baseline.coreHash !== coreHash;
    if (!summaryChanged && changedEntries.length === 0 && deletedEntries.length === 0 && !coreChanged) {
      return { skip: 'unchanged' };
    }

    const mustFull = coreChanged
      || (deletedEntries.length > 0 && config.fullSyncOnDelete !== false)
      || changedEntries.length > config.fullSyncChangedEntries;
    if (!mustFull) {
      const update = buildMemoryUpdate({
        summary: filtered.text,
        changedEntries,
        deletedEntries,
        maxBytes: config.digestMaxBytes,
        maxTokens: config.digestMaxTokens,
      });
      if (!update.tooLarge) {
        return {
          form: 'update',
          text: update.text,
          update,
          sync,
          changed: changedEntries.length,
          deleted: deletedEntries.length,
          summaryChanged,
          coreChanged,
        };
      }
    }
    return {
      form: 'snapshot',
      text: snapshot.text,
      snapshot,
      sync,
      changed: changedEntries.length,
      deleted: deletedEntries.length,
      summaryChanged,
      coreChanged,
      reason: coreChanged ? 'core-changed' : mustFull ? 'structural' : 'update-too-large',
    };
  }

  async function flushInjectionInner(agent, options = {}) {
    if (!isRootWorkspaceAgent(agent, config.privateWorkspace)) {
      return { injected: false, reason: 'not-workspace-root' };
    }
    const sessionId = agent?.session?.id ?? '';
    if (options.turn !== undefined && sessionId && lastFlushTurn.get(sessionId) === options.turn) {
      return { injected: false, reason: 'same-turn' };
    }
    let messages = [];
    try {
      messages = agent?.session?.deriveMessages?.() ?? [];
    } catch (error) {
      logWarn(ctx, '读取会话历史失败，按未注入处理', error);
    }
    const desired = await desiredMemoryUpdate(agent, messages, options);
    if (desired.skip) {
      if (sessionId && options.turn !== undefined) lastFlushTurn.set(sessionId, options.turn);
      return { injected: false, reason: desired.skip, ...desired };
    }
    if (hasSnapshotMessage(messages, desired.text)) {
      if (sessionId && options.turn !== undefined) lastFlushTurn.set(sessionId, options.turn);
      return { injected: false, reason: 'unchanged', ...desired };
    }
    if (typeof agent.inject !== 'function' && !agent.inbox) {
      return { injected: false, reason: 'agent-inject-unavailable', ...desired };
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: desired.text }],
      source: {
        kind: MEMORY_SOURCE_KIND,
        scope: 'workspace',
        form: desired.form,
        ...(desired.sync ? { sync: desired.sync } : {}),
        ...(options.turn !== undefined ? { turn: Number(options.turn) } : {}),
      },
    });
    const pending = pendingMemoryMessages(agent);
    let injected = false;
    if (pending.length > 0 && typeof agent.inbox?.replace === 'function') {
      const last = pending[pending.length - 1];
      if (memoryText(last) === desired.text) {
        for (const extra of pending.slice(0, -1)) {
          try { agent.inbox.remove?.(extra.id); } catch { /* 已被 claim */ }
        }
        if (sessionId && options.turn !== undefined) lastFlushTurn.set(sessionId, options.turn);
        return { injected: false, reason: 'pending-unchanged', ...desired };
      }
      let replaced = false;
      try {
        replaced = agent.inbox.replace(last.id, message);
      } catch {
        replaced = false;
      }
      for (const extra of pending.slice(0, -1)) {
        try { agent.inbox.remove?.(extra.id); } catch { /* 已被 claim */ }
      }
      if (!replaced) {
        agent.inject(message);
        injected = true;
      }
    } else {
      agent.inject(message);
      injected = true;
    }
    if (sessionId && options.turn !== undefined) lastFlushTurn.set(sessionId, options.turn);
    return { injected, reason: injected ? 'injected' : 'replaced', ...desired };
  }

  const injectionChains = new Map();
  const lastFlushTurn = new Map();
  // DSH 原生压缩完成后，下一次 pre-step 必须把最新长期记忆重新放进本步。
  const compactionPending = new Set();

  async function ensureInjected(agent, options = {}) {
    const sessionId = agent?.session?.id ?? `anonymous-${Math.random()}`;
    const previous = injectionChains.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => flushInjectionInner(agent, options), () => flushInjectionInner(agent, options));
    const guarded = run.catch(() => {});
    injectionChains.set(sessionId, guarded);
    try {
      return await run;
    } finally {
      if (injectionChains.get(sessionId) === guarded) injectionChains.delete(sessionId);
    }
  }

  async function queueMemoryForLiveAgents(options = {}) {
    let agents = [];
    try {
      const registry = ctx.get?.('agents');
      agents = registry?.roots?.() ?? registry?.list?.() ?? [];
    } catch {
      agents = [];
    }
    if (lastRootAgent) agents = [...agents, lastRootAgent];
    const seen = new Set();
    for (const agent of agents) {
      const id = agent?.session?.id;
      if (!id || seen.has(id)) continue;
      if (options.excludeSessionId && id === options.excludeSessionId) continue;
      seen.add(id);
      if (!isRootWorkspaceAgent(agent, config.privateWorkspace)) continue;
      await ensureInjected(agent, { ...options, forceFull: options.forceFull === true }).catch((error) => {
        logWarn(ctx, '主动排队记忆更新失败', error);
      });
    }
  }

  /**
   * 压缩完成后，在下一次 pre-step 直接补进当前请求。
   * 这是关键：不能只依赖 inbox，因为压缩可能已经在请求组装前发生；
   * 旧的记忆快照可能被压缩摘要遮蔽，必须在摘要之后重新给出最新完整长期记忆。
   */
  async function injectAfterCompaction(agent, messages, decision) {
    const desired = await desiredMemoryUpdate(agent, messages, { forceFull: true, reason: 'post-compaction' });
    if (desired.skip) {
      compactionPending.delete(agent.session.id);
      return decision;
    }
    const entered = Array.isArray(decision.messages) ? decision.messages : [];
    if (hasSnapshotMessage([...(messages ?? []), ...entered], desired.text)) {
      compactionPending.delete(agent.session.id);
      return decision;
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: desired.text }],
      source: {
        kind: MEMORY_SOURCE_KIND,
        scope: 'workspace',
        form: 'snapshot',
        reason: 'post-compaction',
        ...(desired.sync ? { sync: desired.sync } : {}),
      },
    });
    for (const pending of pendingMemoryMessages(agent)) {
      try { agent.inbox?.remove?.(pending.id); } catch { /* 已被 claim */ }
    }
    compactionPending.delete(agent.session.id);
    return { ...decision, messages: [...entered, message] };
  }

  // Curator 合成长期记忆后，立即给存活会话排队一次更新（不等待下一 turn/end）。
  curator.onApplied = async () => {
    await queueMemoryForLiveAgents({ forceFull: true, reason: 'curator-synthesis' });
    // 有新的短期记忆被整理后，顺便看看 Dreaming 是否到期（频率/阈值仍由它自己把关）。
    void dreaming.dueNow()
      .then((due) => (due.due ? dreaming.runOnce(due.reason) : null))
      .catch((error) => logWarn(ctx, 'Dreaming 到期检查失败', error));
  };
  // Dreaming 更新浮动核心后，同样让存活会话立刻看到。
  dreaming.onApplied = async () => {
    await queueMemoryForLiveAgents({ forceFull: true, reason: 'dreaming-core' });
  };

  // 延后到 tools 服务就绪：模块级 inject 会把插件钉死在 agent 作用域，webServer 就注入不到了。
  const registerTools = (toolCtx) => {
    toolCtx.tools.register(textTool({
      name: 'memory_search',
      description: '检索私人工作区的短期记忆原文。**只搜活动记忆**：冷库 archive 不在这里出现。支持精确 ID、主题标签、关键词和中文字符 n-gram；返回完整记录和记忆 ID。索引只是目录，细节必须用本工具读取原文。用户明确要求回忆过去时改用 memory_recall。',
      parameters: objectSchema({
        query: { type: 'string', description: '关键词或自然语言查询' },
        id: { type: 'string', description: '精确记忆 ID，例如 mem-1a2b3c4d' },
        tags: { type: 'string', description: '主题标签，多个用逗号分隔；要求全部匹配' },
        limit: { type: 'number', description: '最多返回条数，默认 10，最大 50' },
      }),
      async execute(args, exec) {
        assertToolAccess(exec.agent);
        const label = args.id || args.query || args.tags || '';
        if (!label) throw new Error('请提供 query、id 或 tags 之一');
        if (args.id) assertNoSecrets(String(args.id));
        if (args.query) assertNoSecrets(String(args.query));
        if (args.tags) assertNoSecrets(String(args.tags));
        // 明确只查活动层：冷库必须走 memory_recall，避免"顺手搜到旧账"。
        const results = await store.search(args.query, {
          id: args.id,
          tags: args.tags,
          limit: args.limit,
          includeArchived: false,
        });
        registerHitCandidates(exec.agent, results.map((entry) => entry.id));
        return formatSearchResults(results, label);
      },
    }), { when: workspaceOnly });

    toolCtx.tools.register(textTool({
      name: 'memory_recall',
      description: '按需回忆过去：检索冷库 archive（以及可选的活动记忆），返回完整原文。只在用户明确要求「回忆过去、翻旧记录、以前那件事」时使用；回忆不等于恢复，默认不会把冷库条目搬回短期记忆。',
      parameters: objectSchema({
        query: { type: 'string', description: '要回忆的主题、人物或事件' },
        id: { type: 'string', description: '精确记忆 ID' },
        tags: { type: 'string', description: '主题标签，逗号分隔' },
        scope: { type: 'string', description: 'archive（默认，只翻冷库）、all（冷库 + 活动）、active（只查活动）' },
        limit: { type: 'number', description: '最多返回条数，默认使用配置的 archiveRecallLimit，最大 50' },
      }),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const label = args.id || args.query || args.tags || '';
        if (!label) throw new Error('请提供 query、id 或 tags 之一');
        const scope = ['archive', 'all', 'active'].includes(String(args.scope)) ? String(args.scope) : 'archive';
        const limit = Math.max(1, Math.min(50, Number.parseInt(String(args.limit ?? config.archiveRecallLimit), 10) || config.archiveRecallLimit));
        const results = await store.recall(args.query, { id: args.id, tags: args.tags, limit, scope });
        registerHitCandidates(exec.agent, results.map((entry) => entry.id));
        return formatRecallResults(results, label, scope);
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_add',
      description: '向私人工作区新增一条短期记忆（原子事实/经历/偏好/状态变化/约定/更正）。Curator 之后会把短期记忆综合进长期认知；密码、令牌、密钥等会被拒绝。',
      parameters: objectSchema({
        content: { type: 'string', description: '完整、具体的事实正文，写明时间、来源和上下文' },
        summary: { type: 'string', description: '一句话概述；省略时自动从正文提取' },
        tags: { type: 'string', description: '主题标签，多个用逗号分隔' },
        source: { type: 'string', description: '来源，例如 conversation、用户指示、项目文件' },
        context: { type: 'string', description: '上下文，例如会话 ID、项目阶段、相关文件' },
        importance: { type: 'number', description: '重要度 0～3，默认 1' },
        session: { type: 'string', description: '来源会话 ID，用于溯源' },
        turn: { type: 'number', description: '来源轮次，用于溯源' },
        seq: { type: 'string', description: '来源事件序号范围，例如 88-96' },
        quote: { type: 'string', description: '支撑这条记忆的原话引文（自动计算指纹）' },
      }, ['content']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        if (typeof args.content !== 'string' || args.content.trim() === '') {
          throw new Error('content 必须是非空字符串');
        }
        const traceParts = [];
        if (args.session) traceParts.push(`session=${String(args.session).trim()}`);
        if (args.turn !== undefined && args.turn !== null && args.turn !== '') traceParts.push(`turn=${args.turn}`);
        if (args.seq) traceParts.push(`seq=${String(args.seq).trim()}`);
        const entry = await store.add({
          content: args.content,
          summary: args.summary,
          tags: args.tags,
          source: args.source ?? 'conversation',
          context: args.context ?? `session=${exec.agent?.session?.id ?? 'unknown'}`,
          importance: args.importance,
          trace: traceParts.join(' '),
          quote: args.quote ?? '',
        }).catch((error) => {
          if (error?.code === 'TOMBSTONED') {
            throw new Error(`这条事实已被用户删除（${error.memoryId}）；如确需重新记录，请先用 memory_restore("${error.memoryId}") 恢复原条目。`);
          }
          throw error;
        });
        return `已保存短期记忆 ${entry.id}\n- 时间: ${entry.createdAt}\n- 标签: ${(entry.tags ?? []).join(', ') || '无标签'}\n- 概述: ${entry.summary}\n（本轮结束时统一同步记忆更新）`;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_curate',
      description: '按策展预算返回长期记忆全文和短期记忆材料：长期 25%、短期 50%、对话 25%。短期条目按完整块展示，不会从中间截断。可用 query 先缩小范围。',
      parameters: objectSchema({
        query: { type: 'string', description: '可选关键词；省略时整理全部短期记忆' },
        limit: { type: 'number', description: '最多展示多少条短期记忆，默认 80' },
      }),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        let entries = await store.listActive();
        if (args.query) {
          const found = searchMemories(entries, { query: args.query, limit: 200 });
          entries = found;
        }
        const context = composeCurationContext({
          summary: await store.readSummary(),
          entries,
          conversation: recentConversationText(exec.agent, 2),
          maxBytes: config.curateMaxBytes,
          maxTokens: config.curateMaxTokens,
          entriesShown: args.limit ?? config.curateEntriesShown,
        });
        return context.text;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_consolidate',
      description: '显式写入一份新的长期记忆，或用 mode 切换自动演化/冻结。旧版本会进入 summary_history；内容必须基于短期记忆，不得编造。默认 manual（冻结自动演化）。',
      parameters: objectSchema({
        summary: { type: 'string', description: '新的长期记忆 Markdown；省略且提供 mode 时只切换模式' },
        mode: { type: 'string', description: 'auto（允许自动演化）或 manual（冻结当前版本）' },
      }),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const mode = args.mode === 'auto' || args.mode === 'manual' ? args.mode : undefined;
        if (args.summary === undefined && mode) {
          const switched = await store.setSummaryMode(mode);
          return switched.changed
            ? `长期记忆更新方式已切换为 ${mode}。`
            : `长期记忆更新方式已经是 ${mode}，未改动。`;
        }
        if (typeof args.summary !== 'string' || args.summary.trim() === '') {
          throw new Error('summary 必须是非空字符串；只切换模式时请提供 mode');
        }
        assertNoSecrets(args.summary);
        if (byteLength(args.summary) > config.consolidateMaxBytes || estimateTokens(args.summary) > config.consolidateMaxTokens) {
          throw new Error(`摘要超过整理预算：${config.consolidateMaxBytes} 字节 / ${config.consolidateMaxTokens} tokens`);
        }
        const result = await store.writeSummary(args.summary, {
          mode: mode ?? 'manual',
          reason: 'memory_consolidate',
          source: 'tool',
        });
        return result.changed
          ? `长期记忆已更新，共 ${result.bytes} 字节；旧版本已进入 summary_history。`
          : '长期记忆内容未变化，未重复写入。';
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_core',
      description: '查看或维护浮动核心记忆（最多 10 条、由 Dreaming 自主综合的当前重点）。action=list 查看；update/add 需要提供来源短期记忆 ID；delete 会写入墓碑、Dreaming 不会复活；pin 固定后自动流程不能改；history/restore 查看并回退单条改动。',
      parameters: objectSchema({
        action: { type: 'string', description: 'list（默认）/add/update/delete/pin/history/restore' },
        id: { type: 'string', description: '浮动核心 ID，例如 fc-1a2b3c4d' },
        title: { type: 'string', description: '标题，≤30 字' },
        body: { type: 'string', description: '正文，≤400 字' },
        sources: { type: 'string', description: '来源短期记忆 ID，逗号分隔（至少 2 条）' },
        pinned: { type: 'boolean', description: 'pin 动作的目标状态，默认 true' },
        seq: { type: 'number', description: 'history 中要回退到的 seq' },
      }),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const action = String(args.action ?? 'list');
        const [active, archived, deleted] = await Promise.all([store.listActive(), store.listArchived(), store.listDeleted()]);
        const common = {
          activeIds: active.map((entry) => entry.id),
          archivedIds: archived.filter((entry) => entry.status !== 'deleted').map((entry) => entry.id),
          deletedIds: deleted.map((entry) => entry.id),
          longTermText: await store.readSummary(),
          actor: 'tool',
          reason: 'memory_core',
        };
        if (action === 'list') {
          const stats = core.stats();
          if (core.items.length === 0) return `浮动核心记忆为空（上限 ${stats.maxItems} 条）。Dreaming 会在有新短期记忆时自动综合。`;
          const lines = core.items.map((item) => `${item.pinned ? '📌 ' : ''}[${item.id}] ${item.title}\n  ${item.body}\n  来源: ${item.sources.join(', ')}${item.updatedAt ? ` · 更新 ${item.updatedAt}` : ''}`);
          return `浮动核心记忆 ${stats.count}/${stats.maxItems} 条（${stats.bytes} B）：\n\n${lines.join('\n\n')}`;
        }
        if (action === 'add') {
          const sources = String(args.sources ?? '').split(/[,，\s]+/).filter(Boolean);
          const result = await core.add({ title: args.title, body: args.body, sources }, common);
          await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-add' });
          return `已新增浮动核心 ${result.item.id}（${sources.length} 条来源）。`;
        }
        if (action === 'update') {
          const patch = {};
          if (args.title !== undefined) patch.title = args.title;
          if (args.body !== undefined) patch.body = args.body;
          if (args.sources !== undefined) patch.sources = String(args.sources).split(/[,，\s]+/).filter(Boolean);
          if (Object.keys(patch).length === 0) throw new Error('update 至少要提供 title、body 或 sources 之一');
          const result = await core.update(String(args.id ?? ''), patch, common);
          await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-update' });
          return result.changed ? `已更新浮动核心 ${args.id}。` : `浮动核心 ${args.id} 内容没有变化。`;
        }
        if (action === 'delete') {
          const result = await core.remove(String(args.id ?? ''), 'tool-delete', common);
          await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-delete' });
          return `已删除浮动核心 ${args.id}；同样的内容不会被 Dreaming 重新写回。`;
        }
        if (action === 'pin') {
          const result = await core.setPinned(String(args.id ?? ''), args.pinned !== false, common);
          return result.changed ? `已${args.pinned === false ? '取消固定' : '固定'}浮动核心 ${args.id}。` : `浮动核心 ${args.id} 状态没有变化。`;
        }
        if (action === 'history') {
          const records = await core.history(String(args.id ?? ''));
          if (records.length === 0) return `浮动核心 ${args.id} 没有变更历史。`;
          return records.map((record) => `${record.seq}. ${record.ts} · ${record.op} · ${record.actor} · ${record.reason || '—'} · ${record.title}`).join('\n');
        }
        if (action === 'restore') {
          const result = await core.restoreFromHistory(String(args.id ?? ''), args.seq, common);
          await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-restore' });
          return result.changed ? `已把浮动核心 ${args.id} 回退到 seq ${args.seq} 之前的状态。` : '目标状态与当前一致，未改动。';
        }
        throw new Error(`未知的浮动核心操作 ${action}`);
      },
    }), { when: workspaceOnly });

    toolCtx.tools.register(textTool({
      name: 'memory_dream',
      description: 'Dreaming：深度整合记忆、维护浮动核心、提炼长期认知。action=status 查看状态与运行记录；run 立即跑一次（force=true 跳过频率限制）；revert 回滚某次运行的浮动核心。日常由调度自动执行，无需手动调用。',
      parameters: objectSchema({
        action: { type: 'string', description: 'status（默认）/run/revert' },
        force: { type: 'boolean', description: 'run 时忽略间隔与阈值' },
        runId: { type: 'string', description: 'revert 时要回滚的 Dreaming 运行 ID' },
      }),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const action = String(args.action ?? 'status');
        if (action === 'status') {
          const status = await dreaming.status();
          return JSON.stringify(status, null, 2);
        }
        if (action === 'run') {
          const result = await dreaming.runOnce(args.force === true ? 'manual-force' : 'manual', { force: args.force === true });
          return formatDreamRunResult(result);
        }
        if (action === 'revert') {
          const result = await dreaming.revertRun(String(args.runId ?? ''));
          await queueMemoryForLiveAgents({ forceFull: true, reason: 'dream-revert' });
          return `已回滚 Dreaming ${result.runId}：浮动核心现 ${result.coreItems} 条${result.summaryReverted ? '，长期记忆也已回滚' : ''}。`;
        }
        throw new Error(`未知的 Dreaming 操作 ${action}`);
      },
    }), { when: workspaceOnly });

    toolCtx.tools.register(textTool({
      name: 'memory_status',
      description: '查看私人工作区记忆各层状态：短期（含命中与活跃度）、冷库 archive、长期记忆版本、浮动核心、Dreaming 运行情况、Curator 状态与预算。',
      parameters: objectSchema({}),
      async execute(_args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const [stats, curatorStatus, snapshot, archive, usageStats, dreamStatus] = await Promise.all([
          store.stats(),
          curator.status(),
          snapshotFor(exec.agent),
          store.archiveSummary(),
          Promise.resolve(usage.stats()),
          dreaming.status(),
        ]);
        const active = await store.listActive();
        const ranked = rankByActivity(active, usage.all(), { now: Date.now(), halfLifeDays: config.usageHalfLifeDays });
        return JSON.stringify({
          ...stats,
          memoryDir: config.memoryDir,
          privateWorkspace: config.privateWorkspace,
          contextBudget: snapshot.contextBudget,
          archive: { ...archive, bytes: archive.bytes },
          core: { ...core.stats(), injected: snapshot.core, items: core.list() },
          usage: usageStats,
          activity: {
            halfLifeDays: config.usageHalfLifeDays,
            graceHours: config.activityGraceHours,
            mode: store.hitStatsMode,
            drivesArchiving: store.hitStatsMode === 'enforce',
            top: ranked.slice(0, 5).map((entry) => ({ id: entry.id, summary: entry.summary, activity: entry.activity, label: describeActivity(entry.activity) })),
          },
          dreaming: {
            enabled: dreamStatus.enabled,
            available: dreamStatus.available,
            due: dreamStatus.due,
            lastRun: dreamStatus.lastRun ? { runId: dreamStatus.lastRun.runId, status: dreamStatus.lastRun.status, finishedAt: dreamStatus.lastRun.finishedAt } : null,
            counters: dreamStatus.counters,
          },
          curator: curatorStatus,
          snapshot: {
            totalBytes: snapshot.totalBytes,
            totalTokens: snapshot.totalTokens,
            core: snapshot.core,
            index: snapshot.index,
            summaries: snapshot.summaries,
          },
        }, null, 2);
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_forget',
      description: '软删除一条短期记忆；正文保留、可恢复。删除后仅由它支持的长期 claim 会从长期记忆和注入中移除，并阻止同样的短期事实被重新写入。',
      parameters: objectSchema({
        id: { type: 'string', description: '要删除的记忆 ID，例如 mem-1a2b3c4d' },
        reason: { type: 'string', description: '删除原因，便于以后追溯' },
      }, ['id']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        if (typeof args.id !== 'string' || args.id.trim() === '') throw new Error('id 必须是非空字符串');
        const result = await store.forget(args.id, args.reason ?? '');
        if (!result.changed) return `记忆 ${args.id} 已经是删除状态，未重复处理。`;
        let scrub = null;
        try {
          scrub = await store.scrubLongTermForDeleted([result.entry]);
        } catch (error) {
          logWarn(ctx, '短期记忆已删除，但长期记忆清洗失败；注入过滤仍会兜底', error);
        }
        // 浮动核心的来源生命周期：删掉的记忆不能再挂在核心条目上。
        let coreScrub = null;
        try {
          const [active, archived, deleted] = await Promise.all([store.listActive(), store.listArchived(), store.listDeleted()]);
          coreScrub = await core.scrubSources([result.entry.id], {
            activeIds: active.map((entry) => entry.id),
            archivedIds: archived.filter((entry) => entry.status !== 'deleted').map((entry) => entry.id),
            deletedIds: deleted.map((entry) => entry.id),
            longTermText: await store.readSummary(),
          });
        } catch (error) {
          logWarn(ctx, '短期记忆已删除，但浮动核心来源清洗失败', error);
        }
        if (coreScrub?.changed) await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-source-scrub' });
        return [
          `已软删除短期记忆 ${result.entry.id}`,
          `- 时间: ${result.entry.deletedAt}`,
          `- 原因: ${result.entry.deleteReason || '未填写'}`,
          scrub?.changed ? `- 已从长期记忆移除 ${scrub.removedLines} 条仅由它支持的 claim。` : '',
          coreScrub?.changed
            ? `- 浮动核心同步更新：${coreScrub.updated.length} 条去掉该来源，${coreScrub.removed.length} 条因无来源被移除。`
            : '',
          `正文仍然保留；如需恢复，用 memory_restore("${result.entry.id}")。`,
        ].filter(Boolean).join('\n');
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_restore',
      description: '恢复一条被软删除的短期记忆；重复恢复不产生重复记录。恢复后重新参与检索、索引和后续长期合成。',
      parameters: objectSchema({
        id: { type: 'string', description: '要恢复的记忆 ID，例如 mem-1a2b3c4d' },
      }, ['id']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        if (typeof args.id !== 'string' || args.id.trim() === '') throw new Error('id 必须是非空字符串');
        const result = await store.restore(args.id);
        if (!result.changed) return `记忆 ${args.id} 本来就是活动状态，未重复处理。`;
        const overflowNote = result.overflowArchived > 0
          ? `\n- 容量上限：恢复后有 ${result.overflowArchived} 条低活跃记忆被移入冷库（${(result.overflowIds ?? []).join(', ')}）`
          : '';
        return `已恢复短期记忆 ${result.entry.id}\n- 概述: ${result.entry.summary || '（无概述）'}\n已重新参与搜索、索引和长期记忆合成。${overflowNote}`;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_summary_rollback',
      description: '把私人工作区的长期记忆回滚到 summary_history 里的某个版本。回滚前会先归档当前版本，回滚本身也可再回滚；回滚后进入 manual 冻结，需显式恢复 auto。',
      parameters: objectSchema({
        version: { type: 'string', description: '摘要版本号，例如 3 或 0003' },
      }, ['version']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const result = await store.rollbackSummary(args.version);
        if (!result.changed) return `长期记忆已经是版本 ${result.version} 的内容，未改动。`;
        return `长期记忆已回滚到版本 ${result.version}（${result.bytes} 字节）。当前更新方式为 manual（已冻结自动演化）；原来的版本已归档成新版本。`;
      },
    }), { when: workspaceOnly });
    toolCtx.tools.register(textTool({
      name: 'memory_update',
      description: '修改一条短期记忆（正文、概述、标签或引文）。修改前自动留快照，可用 memory_history 查看、memory_revert 回退。',
      parameters: objectSchema({
        id: { type: 'string', description: '要修改的记忆 ID' },
        content: { type: 'string', description: '新的正文；省略则不修改' },
        summary: { type: 'string', description: '新的概述；省略则不修改' },
        tags: { type: 'string', description: '新的标签，逗号分隔；省略则不修改' },
        quote: { type: 'string', description: '新的原话引文；省略则不修改' },
        reason: { type: 'string', description: '修改原因，写入历史快照' },
      }, ['id']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const patch = {};
        for (const key of ['content', 'summary', 'tags', 'quote']) {
          if (args[key] !== undefined) patch[key] = args[key];
        }
        if (Object.keys(patch).length === 0) throw new Error('至少要提供 content、summary、tags、quote 之一');
        const result = await store.update(args.id, patch, args.reason ?? '')
          .catch((error) => {
            if (error?.code === 'TOMBSTONED') {
              throw new Error(`正文与已删除事实相同（${error.memoryId}），请先 memory_restore("${error.memoryId}")。`);
            }
            throw error;
          });
        if (!result.changed) return `记忆 ${args.id} 内容没有变化，未写入。`;
        return `已更新短期记忆 ${result.entry.id}\n- 改动字段: ${result.fields.join(', ')}\n- 修改前内容已存入修改历史，可用 memory_revert("${result.entry.id}") 回退。`;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_history',
      description: '查看一条短期记忆的修改历史（每次修改前的快照），用于确认改动和选择要回退的版本。',
      parameters: objectSchema({
        id: { type: 'string', description: '记忆 ID' },
      }, ['id']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const list = await store.revisions(args.id);
        if (list.length === 0) return `记忆 ${args.id} 没有修改历史。`;
        const lines = list.map((record, index) => {
          const fields = Array.isArray(record.changed) ? record.changed.join('/') : '';
          return `${index + 1}. ${record.ts} · ${fields}${record.reason ? ` · ${record.reason}` : ''} · 概述「${record.previous.summary ?? ''}」`;
        });
        return `记忆 ${args.id} 共 ${list.length} 条修改历史：\n${lines.join('\n')}`;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_revert',
      description: '把一条短期记忆回退到某次修改之前的内容。省略 version 时回退最近一次修改。',
      parameters: objectSchema({
        id: { type: 'string', description: '记忆 ID' },
        version: { type: 'string', description: '修改历史里的序号（从 1 开始）；省略则回退最近一次' },
      }, ['id']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const result = await store.revert(args.id, args.version);
        return `已回退短期记忆 ${result.entry.id}（版本 ${result.version}）\n- 概述: ${result.entry.summary || '（无概述）'}`;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_trace',
      description: '查看一条短期记忆的溯源信息：来源会话、轮次、原话引文，并校验引文指纹是否与写入时一致。',
      parameters: objectSchema({
        id: { type: 'string', description: '记忆 ID' },
      }, ['id']),
      async execute(args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        // v2.0：已删除条目的正文、引文和来源坐标不再通过溯源接口暴露。
        const entry = await store.get(args.id, true);
        if (!entry) throw new Error(`没有找到记忆 ${args.id}`);
        if (entry.status === 'deleted') {
          return [
            `记忆 ${entry.id} 已被删除（${entry.deletedAt || '时间未知'}）。`,
            '- 正文、引文、指纹和来源坐标对检索/溯源接口不可见。',
            `- 如需重新启用，请用 memory_restore("${entry.id}")（会同时恢复它的可检索性）。`,
          ].join('\n');
        }
        const report = await buildTraceReport(entry, sessionQueryService, config.privateWorkspace);
        const verdict = report.levels.quoteHash;
        const label = {
          verified: '引文指纹一致（仅证明引文未被改写，不等于语义已验证）',
          'missing-quote': '没有记录引文（旧条目或不带溯源的写入）',
          'missing-hash': '缺少引文指纹',
          mismatch: '引文与指纹不一致，可能被手工改写',
        }[verdict];
        const lines = [
          `记忆 ${entry.id}`,
          `- 创建: ${entry.createdAt}`,
          `- 状态: ${entry.status === 'deleted' ? 'deleted' : 'active'}`,
          `- 溯源: ${entry.trace || '（未记录）'}`,
          `- 引文: ${entry.quote || '（未记录）'}`,
          `- 引文哈希: ${entry.quoteHash || '（未记录）'}`,
          `- 指纹校验: ${verdict} · ${label}`,
          `- 会话存在: ${report.levels.session}`,
          `- 坐标命中: ${report.levels.location}`,
          `- 正文支持: ${report.levels.support}`,
          `- 综合: ${report.overall}`,
        ];
        if (report.details.length > 0) lines.push(`- 说明: ${report.details.join('；')}`);
        return lines.join('\n');
      },
    }), { when: workspaceOnly });
    diagnostics.tools = 15;
    void writeDiagnostics();
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], registerTools);
  } else {
    registerTools(ctx);
  }


  // 自动 curator 的会话查询服务。DSH 桌面 profile 默认挂载 session-query-sqlite。
  const attachSessionQuery = (queryCtx) => {
    sessionQueryService = queryCtx?.sessionQuery ?? null;
    if (!sessionQueryService) return;
    curator.sessionQuery = sessionQueryService;
    diagnostics.curatorAvailable = true;
    refreshCurator();
    void writeDiagnostics();
    void curator.start().catch((error) => logWarn(ctx, '启动 Curator 扫描失败', error));
  };
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionQuery'], attachSessionQuery);
  } else if (ctx.get?.('sessionQuery')) {
    attachSessionQuery({ sessionQuery: ctx.get('sessionQuery') });
  }

  ctx.on('agent/created', async ({ agent }) => {
    try {
      if (isRootWorkspaceAgent(agent, config.privateWorkspace)) {
        lastRootAgent = agent;
        refreshCurator();
        void curator.onEarlyEvent('new-root-session').catch((error) => logWarn(ctx, 'Curator 提前触发失败', error));
      }
      await ensureInjected(agent);
    } catch (error) {
      logWarn(ctx, '新会话注入失败', error);
    }
  });

  // 每轮结束后检查记忆是否变化；未变化时不重复追加。同时累计 Curator 待整理回合。
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'compaction/start' || event?.type === 'compaction/end') {
      if (session?.header && isRootWorkspaceSession(session.header, config.privateWorkspace)) {
        compactionPending.add(session.id);
        if (event.type === 'compaction/end') {
          const agent = ctx.get?.('agents')?.get?.(session.id);
          if (agent) {
            // 兜底：若压缩发生在 pre-step 之后，至少让下一个 step/下一轮拿到最新完整记忆。
            void ensureInjected(agent, { forceFull: true, reason: 'post-compaction' })
              .catch((error) => logWarn(ctx, '压缩后记忆兜底排队失败', error));
          }
        }
      }
      return;
    }
    if (event?.type !== 'turn/end') return;
    try {
      const agents = ctx.get?.('agents');
      const agent = agents?.get?.(session?.id);
      if (!agent) return;
      if (isRootWorkspaceAgent(agent, config.privateWorkspace)) {
        lastRootAgent = agent;
        refreshCurator();
        void curator.onTurnEnd().catch((error) => logWarn(ctx, 'Curator 回合累计失败', error));
      }
      void (async () => {
        await settleHits(agent, event.data?.turn);
        await ensureInjected(agent, { turn: event.data?.turn });
        // 记忆是工作区级的：其他存活根会话也要在下次请求前看到变化。
        await queueMemoryForLiveAgents({
          excludeSessionId: agent.session.id,
          reason: 'workspace-sync',
        });
      })().catch((error) => logWarn(ctx, '轮末记忆快照刷新失败', error));
    } catch (error) {
      logWarn(ctx, '轮末检查失败', error);
    }
  });

  // DSH 原生压缩会遮蔽旧记忆快照；压缩结束后在下一次 pre-step 重新注入最新完整长期记忆。
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next();
    if (!agent?.session?.id || !compactionPending.has(agent.session.id)) return decision;
    if (decision?.kind === 'reject') return decision;
    try {
      return await injectAfterCompaction(agent, messages, decision);
    } catch (error) {
      logWarn(ctx, '压缩后长期记忆重注入失败', error);
      return decision;
    }
  });

  ctx.on('agent/disposed', ({ agent } = {}) => {
    if (agent?.session?.id) {
      lastFlushTurn.delete(agent.session.id);
      compactionPending.delete(agent.session.id);
      hitCandidates.delete(agent.session.id);
    }
    if (agent && isRootWorkspaceAgent(agent, config.privateWorkspace)) {
      refreshCurator();
      void curator.onEarlyEvent('root-agent-disposed').catch((error) => logWarn(ctx, 'Curator 结束触发失败', error));
    }
  });

  ctx.on('session/disposed', (session) => {
    if (session?.header?.id) {
      lastFlushTurn.delete(session.header.id);
      compactionPending.delete(session.header.id);
      hitCandidates.delete(session.header.id);
    }
    if (session?.header && isRootWorkspaceSession(session.header, config.privateWorkspace)) {
      void curator.onEarlyEvent('root-session-disposed').catch((error) => logWarn(ctx, 'Curator 会话结束触发失败', error));
    }
  });

  // 设置页接口只接受 DSH 自己的 Host/Origin + Cookie/Peer 认证；缺失即拒绝，绝不回退。
  ctx.inject?.(['webServer'], (webCtx) => {
    diagnostics.webServerInjected = true;
    diagnostics.auth = 'cookie-required';
    const currentConnection = () => {
      try {
        return ctx.get?.('connection') ?? webCtx.connection ?? null;
      } catch {
        return null;
      }
    };
    const authorize = (request) => {
      const connection = currentConnection();
      if (!connection?.admit) return { status: 503, error: 'auth-unavailable' };
      let admission;
      try {
        admission = connection.admit(request);
      } catch {
        return { status: 503, error: 'auth-unavailable' };
      }
      if (admission?.rejection) {
        return { status: admission.rejection, error: admission.rejection === 403 ? 'forbidden' : 'unauthorized' };
      }
      if (!admission?.peer) return { status: 401, error: 'unauthorized' };
      if (admission.peer?.principal?.kind !== 'owner') return { status: 403, error: 'forbidden' };
      return null;
    };
    const register = (routePath, handler) => {
      const route = { kind: 'exact', path: routePath, handler };
      try {
        if (typeof webCtx.effect === 'function') {
          webCtx.effect(() => webCtx.webServer.register(route), `dsh-memory-feiyu: ${routePath}`);
        } else {
          webCtx.webServer.register(route);
        }
        diagnostics.routes += 1;
      } catch (error) {
        diagnostics.errors.push(`${routePath}: ${String(error?.message ?? error)}`);
        logWarn(ctx, `注册记忆接口失败（${routePath}）`, error);
      }
    };

    const guarded = (action) => async (request, response) => {
      const method = request.method ?? 'POST';
      if (method !== 'POST') {
        return jsonReply(response, 405, { ok: false, error: 'method-not-allowed' });
      }
      const rejection = authorize(request);
      if (rejection) {
        return jsonReply(response, rejection.status, { ok: false, error: rejection.error });
      }
      if (request.headers?.[CLIENT_HEADER] !== CLIENT_VALUE) {
        return jsonReply(response, 403, { ok: false, error: 'client-required' });
      }
      const contentType = String(request.headers?.['content-type'] ?? '').toLowerCase();
      if (contentType && !contentType.includes('application/json')) {
        return jsonReply(response, 415, { ok: false, error: 'json-required' });
      }
      try {
        const body = await readJsonBody(request);
        const value = await action(body ?? {});
        jsonReply(response, 200, { ok: true, ...value });
      } catch (error) {
        jsonReply(response, 400, { ok: false, error: String(error?.message ?? error) });
      }
    };

    register(`${API_PREFIX}/state`, guarded(async (body = {}) => {
      if (body.mode === 'auto' || body.mode === 'manual') {
        await store.setSummaryMode(body.mode);
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'summary-mode' });
      }
      refreshConfig();
      const [active, deleted, archived, summary, stats, versions, versionInfo, recent, curatorStatus, summaryIndex, archiveSummary, dreamStatus] = await Promise.all([
        store.listActive(),
        store.listDeleted(),
        store.listArchived(),
        store.readSummary(),
        store.stats(),
        store.listSummaryVersions(),
        store.listSummaryVersionInfo(),
        store.recentEvents(3),
        curator.status(),
        store.summaryIndexReport(),
        store.archiveSummary(),
        dreaming.status(),
      ]);
      const slim = (entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt ?? entry.createdAt,
        summary: entry.summary,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        source: entry.source ?? '',
        context: entry.context ?? '',
        importance: entry.importance ?? 1,
        // 已删除条目的正文不在状态接口里返回：设置页只需要概述来确认是哪一条。
        content: entry.status === 'deleted' ? '' : (entry.content ?? ''),
        contentHidden: entry.status === 'deleted',
        status: entry.status ?? 'active',
        deletedAt: entry.deletedAt ?? '',
        deleteReason: entry.deleteReason ?? '',
        archivedAt: entry.archivedAt ?? '',
        archiveReason: entry.archiveReason ?? '',
        trace: entry.trace ?? '',
        quote: entry.status === 'deleted' ? '' : (entry.quote ?? ''),
        sourceType: entry.sourceType ?? '',
        curatorOp: entry.curatorOp ?? '',
        mergedFrom: Array.isArray(entry.mergedFrom) ? entry.mergedFrom : [],
      });
      const ranked = rankByActivity(active, usage.all(), { now: Date.now(), halfLifeDays: config.usageHalfLifeDays });
      const activityById = {};
      for (const entry of ranked) activityById[entry.id] = entry.activity;
      return {
        version: PACKAGE_VERSION,
        active: ranked.map((entry) => ({ ...slim(entry), activity: entry.activity, activityLabel: describeActivity(entry.activity) })),
        deleted: deleted.map((entry) => ({ ...slim(entry), activity: activityById[entry.id] ?? null })),
        archivedCount: archived.length,
        archivedActiveCount: archived.filter((entry) => entry.status !== 'deleted').length,
        archive: archiveSummary,
        summaryText: summary,
        summaryHash: stats.summaryHash,
        privateWorkspace: config.privateWorkspace,
        summaryBytes: byteLength(summary),
        summaryMode: stats.summaryMode,
        longTerm: {
          version: stats.summaryVersion,
          bytes: stats.summaryBytes,
          locks: stats.longTermLocks,
          forgotten: stats.longTermForgotten,
          lockErrors: stats.longTermLockErrors,
          indexOk: summaryIndex.ok,
          indexMissing: summaryIndex.missing.length,
          indexExtra: summaryIndex.extra.length,
          indexMismatched: summaryIndex.mismatched.length,
        },
        longTermLocks: lockSummaries(summary),
        longTermForgottenList: store.longTermForgotten(),
        tombstoneCount: stats.tombstoneCount,
        parseErrors: stats.parseErrors,
        parseErrorDetails: stats.parseErrorDetails,
        stateRecovered: stats.stateRecovered,
        versions,
        versionInfo,
        recent,
        curator: curatorStatus,
        core: {
          ...core.stats(),
          items: core.list(),
          maxBytes: config.coreMaxBytes,
          enabled: config.coreEnabled !== false,
        },
        usage: usage.stats(),
        activity: {
          halfLifeDays: config.usageHalfLifeDays,
          dailyHitCap: config.usageDailyHitCap,
          graceHours: config.activityGraceHours,
          // observe：命中只观察，不参与自动归档；enforce 才会用命中影响淘汰。
          mode: store.hitStatsMode,
          drivesArchiving: store.hitStatsMode === 'enforce',
        },
        dreaming: {
          ...dreamStatus,
          runs: (dreamStatus.recentRuns ?? []).map((run) => ({ ...run })),
        },
        limits: {
          maxActiveMemories: config.maxActiveMemories,
          rawArchiveMaxBytes: config.rawArchiveMaxBytes,
          coreMaxItems: config.coreMaxItems,
          coreMaxBytes: config.coreMaxBytes,
          coreItemMaxBytes: config.coreItemMaxBytes,
          archiveRecallLimit: config.archiveRecallLimit,
        },
      };
    }));
    register(`${API_PREFIX}/update`, guarded(async (body) => {
      const patch = {};
      for (const key of ['content', 'summary', 'tags', 'quote']) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (Object.keys(patch).length === 0) throw new Error('没有需要修改的字段');
      const result = await store.update(body.id, patch, body.reason ?? '');
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'settings-update' });
      return { changed: result.changed, id: result.entry?.id ?? '', fields: result.fields ?? [] };
    }));
    register(`${API_PREFIX}/history`, guarded(async (body) => {
      const list = await store.revisions(body.id);
      return {
        id: body.id,
        revisions: list.map((record, index) => ({
          index: index + 1,
          version: record.rev ?? record.version ?? String(index + 1),
          rev: record.rev ?? '',
          ts: record.ts ?? '',
          reason: record.reason ?? '',
          changed: Array.isArray(record.changed) ? record.changed : [],
          summary: record.previous?.summary ?? '',
        })),
      };
    }));
    register(`${API_PREFIX}/revert`, guarded(async (body) => {
      const result = await store.revert(body.id, body.version);
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'settings-revert' });
      return { changed: result.changed, id: result.entry?.id ?? '', version: result.version };
    }));
    register(`${API_PREFIX}/forget`, guarded(async (body) => {
      const result = await store.forget(body.id, body.reason ?? '');
      let coreScrub = null;
      if (result.changed) {
        await store.scrubLongTermForDeleted([result.entry]).catch((error) => {
          logWarn(ctx, '设置页删除短期记忆后清洗长期记忆失败', error);
        });
        try {
          const [active, archived, deleted] = await Promise.all([store.listActive(), store.listArchived(), store.listDeleted()]);
          coreScrub = await core.scrubSources([result.entry.id], {
            activeIds: active.map((entry) => entry.id),
            archivedIds: archived.filter((entry) => entry.status !== 'deleted').map((entry) => entry.id),
            deletedIds: deleted.map((entry) => entry.id),
            longTermText: await store.readSummary(),
          });
        } catch (error) {
          logWarn(ctx, '设置页删除短期记忆后清洗浮动核心来源失败', error);
        }
      }
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'settings-forget' });
      return {
        changed: result.changed,
        alreadyDeleted: result.alreadyDeleted === true,
        id: result.entry?.id ?? '',
        coreScrub: coreScrub ? { updated: coreScrub.updated, removed: coreScrub.removed } : null,
      };
    }));
    register(`${API_PREFIX}/restore`, guarded(async (body) => {
      const result = await store.restore(body.id);
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'settings-restore' });
      return {
        changed: result.changed,
        alreadyActive: result.alreadyActive === true,
        id: result.entry?.id ?? '',
        overflowArchived: result.overflowArchived ?? 0,
        overflowIds: result.overflowIds ?? [],
        entryArchived: result.entryArchived === true,
      };
    }));
    register(`${API_PREFIX}/rollback`, guarded(async (body) => {
      const result = await store.rollbackSummary(body.version);
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'summary-rollback' });
      return { changed: result.changed, version: result.version, bytes: result.bytes ?? 0, mode: result.mode };
    }));
    register(`${API_PREFIX}/long-term`, guarded(async (body = {}) => {
      const action = String(body.action ?? '');
      if (action === 'update') {
        const result = await store.updateLongTerm({
          text: body.text,
          expectedHash: body.expectedHash,
          protectChanged: body.protectChanged !== false,
          reason: body.reason,
        });
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'long-term-edit' });
        return { changed: result.changed, hash: result.hash, bytes: result.bytes, text: result.text };
      }
      if (action === 'unlock') {
        const result = await store.unlockLongTermBlock(body.id, body.reason);
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'long-term-unlock' });
        return { changed: result.changed, hash: result.hash, bytes: result.bytes, text: result.text, lockId: result.lockId };
      }
      if (action === 'forget') {
        const result = await store.forgetLongTermBlock({
          id: body.id,
          text: body.text,
          reason: body.reason,
        });
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'long-term-forget' });
        return { changed: result.changed, hash: result.hash, bytes: result.bytes, text: result.text, removed: result.removed };
      }
      if (action === 'state') {
        return store.summaryMeta();
      }
      throw new Error('未知的长期记忆操作');
    }));
    register(`${API_PREFIX}/core`, guarded(async (body = {}) => {
      const action = String(body.action ?? 'list');
      const [active, archived, deleted] = await Promise.all([store.listActive(), store.listArchived(), store.listDeleted()]);
      const common = {
        activeIds: active.map((entry) => entry.id),
        archivedIds: archived.filter((entry) => entry.status !== 'deleted').map((entry) => entry.id),
        deletedIds: deleted.map((entry) => entry.id),
        longTermText: await store.readSummary(),
        actor: 'settings',
        reason: 'settings-core',
      };
      if (action === 'list') {
        return { core: { ...core.stats(), maxBytes: config.coreMaxBytes, items: core.list() } };
      }
      if (action === 'add') {
        const sources = String(body.sources ?? '').split(/[,，\s]+/).filter(Boolean);
        const result = await core.add({ title: body.title, body: body.body, sources }, { ...common, reason: 'settings-core-add' });
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-add' });
        return { changed: result.changed, items: core.list(), stats: core.stats(), id: result.item?.id ?? '' };
      }
      if (action === 'update') {
        const patch = {};
        for (const key of ['title', 'body', 'pinned']) if (body[key] !== undefined) patch[key] = body[key];
        if (body.sources !== undefined) patch.sources = String(body.sources).split(/[,，\s]+/).filter(Boolean);
        if (Object.keys(patch).length === 0) throw new Error('没有需要修改的字段');
        const result = await core.update(String(body.id ?? ''), patch, { ...common, reason: body.reason ?? 'settings-core-update' });
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-update' });
        return { changed: result.changed, items: core.list(), stats: core.stats() };
      }
      if (action === 'delete') {
        const result = await core.remove(String(body.id ?? ''), body.reason ?? 'settings-delete', common);
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-delete' });
        return { changed: result.changed, items: core.list(), stats: core.stats() };
      }
      if (action === 'history') {
        return { id: body.id, history: await core.history(String(body.id ?? '')) };
      }
      if (action === 'restore') {
        const result = await core.restoreFromHistory(String(body.id ?? ''), body.seq, common);
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'core-restore' });
        return { changed: result.changed, items: core.list(), stats: core.stats() };
      }
      throw new Error('未知的浮动核心操作');
    }));
    register(`${API_PREFIX}/dream`, guarded(async (body = {}) => {
      const action = String(body.action ?? 'status');
      if (action === 'status') {
        return { dreaming: await dreaming.status(), core: { ...core.stats(), items: core.list() } };
      }
      if (action === 'run') {
        const result = await dreaming.runOnce(body.force === true ? 'settings-force' : 'settings', { force: body.force === true });
        if (result.skipped) {
          return { skipped: true, reason: result.errors?.[0] ?? result.reason ?? 'unknown', run: { runId: result.runId, status: result.status } };
        }
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'dreaming-run' });
        return {
          run: { runId: result.runId, status: result.status, ops: result.ops, coreAfter: result.coreAfter, errors: result.errors ?? [], snapshotDir: result.snapshotDir ?? '' },
          dreaming: await dreaming.status(),
          core: { ...core.stats(), items: core.list() },
        };
      }
      if (action === 'revert') {
        const result = await dreaming.revertRun(String(body.runId ?? ''), { summary: body.summary === true });
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'dream-revert' });
        return { reverted: result.reverted, runId: result.runId, summaryReverted: result.summaryReverted, core: { ...core.stats(), items: core.list() } };
      }
      throw new Error('未知的 Dreaming 操作');
    }));
    register(`${API_PREFIX}/archive`, guarded(async (body = {}) => {
      const action = String(body.action ?? 'list');
      if (action === 'list') {
        const archived = (await store.listArchived()).filter((entry) => entry.status !== 'deleted');
        const query = String(body.query ?? '').trim();
        const limit = Math.max(1, Math.min(50, Number.parseInt(String(body.limit ?? config.archiveRecallLimit), 10) || config.archiveRecallLimit));
        let items = archived;
        if (query) {
          const found = await store.searchArchive(query, { limit });
          const ids = new Set(found.map((entry) => entry.id));
          items = found.length > 0 ? archived.filter((entry) => ids.has(entry.id)) : [];
        }
        return {
          total: archived.length,
          summary: await store.archiveSummary(),
          query,
          items: items.slice(0, limit).map((entry) => ({
            id: entry.id,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt ?? entry.createdAt,
            archivedAt: entry.archivedAt ?? '',
            archiveReason: entry.archiveReason ?? '',
            summary: entry.summary ?? '',
            tags: entry.tags ?? [],
            content: entry.content ?? '',
            importance: entry.importance ?? 1,
          })),
        };
      }
      if (action === 'restore') {
        // 冷库接口只恢复「确实在冷库里」的条目；活动区里的软删除走 /restore。
        const eligibility = await store.restorable(String(body.id ?? ''));
        if (!eligibility.allowed || eligibility.layer !== 'archive') {
          throw new Error(eligibility.reason === 'already-active'
            ? `记忆 ${body.id} 已经在短期记忆里，不需要从冷库恢复`
            : `记忆 ${body.id} 不在冷库里，冷库接口不能恢复它`);
        }
        const result = await store.restore(String(body.id ?? ''));
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'archive-restore' });
        return {
          changed: result.changed,
          id: result.entry?.id ?? '',
          overflowArchived: result.overflowArchived ?? 0,
          overflowIds: result.overflowIds ?? [],
          entryArchived: result.entryArchived === true,
        };
      }
      if (action === 'demote') {
        const result = await store.archiveActive(String(body.id ?? ''), body.reason ?? 'settings-demote');
        await queueMemoryForLiveAgents({ forceFull: true, reason: 'archive-demote' });
        return { archived: result.archived, id: result.id };
      }
      throw new Error('未知的冷库操作');
    }));
    void writeDiagnostics();
  });

  // 插件在会话中途加载时，为已经存在的本工作区 agent 补一次快照。
  try {
    const agents = ctx.get?.('agents');
    if (agents?.list) {
      for (const agent of agents.list()) {
        if (isRootWorkspaceAgent(agent, config.privateWorkspace)) {
          lastRootAgent = lastRootAgent ?? agent;
          void ensureInjected(agent).catch((error) => logWarn(ctx, '已有会话补注入失败', error));
        }
      }
      refreshCurator();
    }
  } catch (error) {
    logWarn(ctx, '枚举已有会话失败', error);
  }

  // Dreaming 自带低频调度（启动延迟 + 30 分钟检查），due 才真正调用模型。
  try {
    dreaming.start();
  } catch (error) {
    logWarn(ctx, 'Dreaming 调度启动失败', error);
  }

  diagnostics.coreCount = core.items.length;
  diagnostics.usageTracked = usage.stats().tracked;
  try {
    diagnostics.archiveCount = (await store.listArchived()).length;
  } catch {
    diagnostics.archiveCount = 0;
  }
  diagnostics.applyCompleted = true;
  void writeDiagnostics();
}

export { isWorkspacePath, byteLength };
