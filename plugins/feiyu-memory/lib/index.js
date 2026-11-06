/**
 * dsh-memory-feiyu 的 DSH Host 插件入口。
 * 只在 privateWorkspace 内注册记忆工具并注入记忆快照；其他工作区完全隔离。
 *
 * 本文件刻意不 import 任何 DSH 运行时包：插件只依赖公开的 ctx 服务约定，
 * 这样既能被 DSH 加载，也能在 node --test 中对核心模块做独立测试。
 * @module dsh-memory-feiyu
 */
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
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
];

/** 运行时配置。volatile 字段会出现在设置页，并即时影响记忆行为。 */
export const Config = z.object({
  privateWorkspace: z.string().required(),
  memoryDir: z.string().required(),
  globalMemoryDir: z.string().default(''),
  scopeMaxBytes: z.number().step(1).min(1000).default(DEFAULT_CONFIG.scopeMaxBytes).volatile(),
  scopeMaxTokens: z.number().step(1).min(1).default(DEFAULT_CONFIG.scopeMaxTokens).volatile(),
  maxBytes: z.number().step(1).min(3000).default(DEFAULT_CONFIG.maxBytes).volatile(),
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
  indexMaxBytes: z.number().step(1).min(1).default(DEFAULT_CONFIG.indexMaxBytes).volatile(),
  indexMaxTokens: z.number().step(1).min(1).default(DEFAULT_CONFIG.indexMaxTokens).volatile(),
  contextBudgetRatio: z.number().min(0.01).max(0.08).default(DEFAULT_CONFIG.contextBudgetRatio),
  contextBudgetHardRatio: z.number().min(0.01).max(0.1).default(DEFAULT_CONFIG.contextBudgetHardRatio),
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

/**
 * 插件入口。
 * @param {{tools: object, get: Function, on: Function, effect: Function, logger?: object}} ctx
 * @param {Record<string, unknown>} rawConfig
 */
export async function apply(ctx, rawConfig) {
  let config = readConfig(rawConfig);
  const store = new MemoryStore({
    memoryDir: config.memoryDir,
    globalMemoryDir: config.globalMemoryDir,
    maxActiveMemories: config.maxActiveMemories,
    rawArchiveMaxBytes: config.rawArchiveMaxBytes,
    keepSummaryVersions: config.keepSummaryVersions,
    maxContentBytes: config.consolidateMaxBytes,
    logger: ctx.logger,
  });
  await store.init();

  let lastRootAgent = null;
  let sessionQueryService = null;
  const curator = new CuratorService({
    store,
    config,
    privateWorkspace: config.privateWorkspace,
    logger: ctx.logger,
  });
  await curator.init();

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
      const selection = agent?.model?.current?.();
      curator.route = selection?.provider && selection?.model
        ? { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
        : null;
      if (agent) lastRootAgent = agent;
    } catch {
      curator.route = null;
    }
  }
  refreshCurator();

  ctx.effect(() => () => {
    void curator.close();
    return store.close();
  }, 'dsh-memory-feiyu.store');

  // 启动诊断：设置页接口是否注册成功，写进记忆目录供排查（不含任何记忆内容）。
  const diagnostics = {
    startedAt: new Date().toISOString(),
    packageVersion: '1.3.0',
    sourceHash: '',
    injectAvailable: typeof ctx.inject === 'function',
    webServerInjected: false,
    auth: 'pending',
    tools: 0,
    curatorAvailable: false,
    curatorEnabled: config.curatorEnabled === true,
    curatorBackfill: config.curatorBackfill === true,
    longTermMode: config.longTermMode ?? 'off',
    routes: 0,
    errors: [],
  };
  try {
    const hash = createHash('sha256');
    for (const file of ['store.js', 'index.js', 'injection.js', 'feiyu.js', 'curator.js', 'config.js', 'search.js', 'text.js']) {
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
      refreshCurator();
    } catch (error) {
      logWarn(ctx, '设置值无效，继续使用上一次有效配置', error);
    }
    return config;
  }

  const workspaceOnly = ({ agent }) => isRootWorkspaceAgent(agent, config.privateWorkspace);

  function assertToolAccess(agent) {
    if (!isWorkspaceAgent(agent, config.privateWorkspace)) {
      throw new Error('该记忆工具只在已配置的私人工作区可用');
    }
    if (!isRootWorkspaceAgent(agent, config.privateWorkspace)) {
      throw new Error('该记忆工具只允许已配置的私人工作区的根会话使用；子代理不得读写长期记忆');
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
    return buildSnapshot({ globalSummary, workspaceSummary: filtered.text, entries, contextWindow, config });
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
    const filtered = filterSummaryForInjection(workspaceSummary, deleted);
    const currentEntries = entriesSyncState(entries);
    const summaryHash = sha256(filtered.text);
    const sync = { summaryHash, entries: currentEntries };
    const snapshot = buildSnapshot({ globalSummary, workspaceSummary: filtered.text, entries, contextWindow, config });

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
    if (!summaryChanged && changedEntries.length === 0 && deletedEntries.length === 0) {
      return { skip: 'unchanged' };
    }

    const mustFull = (deletedEntries.length > 0 && config.fullSyncOnDelete !== false)
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
      reason: mustFull ? 'structural' : 'update-too-large',
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
  curator.onApplied = async () => { await queueMemoryForLiveAgents({ forceFull: true, reason: 'curator-synthesis' }); };

  // 延后到 tools 服务就绪：模块级 inject 会把插件钉死在 agent 作用域，webServer 就注入不到了。
  const registerTools = (toolCtx) => {
    toolCtx.tools.register(textTool({
      name: 'memory_search',
      description: '检索已配置的私人工作区的短期记忆原文。支持精确 ID、主题标签、关键词和中文字符 n-gram；返回完整记录和记忆 ID。索引只是目录，细节必须用本工具读取原文。',
      parameters: objectSchema({
        query: { type: 'string', description: '关键词或自然语言查询' },
        id: { type: 'string', description: '精确记忆 ID，例如 mem-1a2b3c4d' },
        tags: { type: 'string', description: '主题标签，多个用逗号分隔；要求全部匹配' },
        limit: { type: 'number', description: '最多返回条数，默认 10，最大 50' },
        include_archived: { type: 'boolean', description: '是否包含已归档记忆，默认 true' },
      }),
      async execute(args, exec) {
        assertToolAccess(exec.agent);
        const label = args.id || args.query || args.tags || '';
        if (!label) throw new Error('请提供 query、id 或 tags 之一');
        if (args.id) assertNoSecrets(String(args.id));
        if (args.query) assertNoSecrets(String(args.query));
        if (args.tags) assertNoSecrets(String(args.tags));
        const results = await store.search(args.query, {
          id: args.id,
          tags: args.tags,
          limit: args.limit,
          includeArchived: args.include_archived !== false,
        });
        return formatSearchResults(results, label);
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_add',
      description: '向已配置的私人工作区新增一条短期记忆（原子事实/经历/偏好/状态变化/约定/更正）。Curator 之后会把短期记忆综合进长期认知；密码、令牌、密钥等会被拒绝。',
      parameters: objectSchema({
        content: { type: 'string', description: '完整、具体的事实正文，写明时间、来源和上下文' },
        summary: { type: 'string', description: '一句话概述；省略时自动从正文提取' },
        tags: { type: 'string', description: '主题标签，多个用逗号分隔' },
        source: { type: 'string', description: '来源，例如 conversation、主人指示、项目文件' },
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
            throw new Error(`这条事实已被主人删除（${error.memoryId}）；如确需重新记录，请先用 memory_restore("${error.memoryId}") 恢复原条目。`);
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
      name: 'memory_status',
      description: '查看已配置的私人工作区短期/长期记忆的条数、字节、版本、索引状态、Curator 状态和预算。',
      parameters: objectSchema({}),
      async execute(_args, exec) {
        refreshConfig();
        assertToolAccess(exec.agent);
        const [stats, curatorStatus, snapshot] = await Promise.all([
          store.stats(),
          curator.status(),
          snapshotFor(exec.agent),
        ]);
        return JSON.stringify({
          ...stats,
          memoryDir: config.memoryDir,
          privateWorkspace: config.privateWorkspace,
          contextBudget: snapshot.contextBudget,
          curator: curatorStatus,
          snapshot: {
            totalBytes: snapshot.totalBytes,
            totalTokens: snapshot.totalTokens,
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
        return [
          `已软删除短期记忆 ${result.entry.id}`,
          `- 时间: ${result.entry.deletedAt}`,
          `- 原因: ${result.entry.deleteReason || '未填写'}`,
          scrub?.changed ? `- 已从长期记忆移除 ${scrub.removedLines} 条仅由它支持的 claim。` : '',
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
        return `已恢复短期记忆 ${result.entry.id}\n- 概述: ${result.entry.summary || '（无概述）'}\n已重新参与搜索、索引和长期记忆合成。`;
      },
    }), { when: workspaceOnly });
  
    toolCtx.tools.register(textTool({
      name: 'memory_summary_rollback',
      description: '把已配置的私人工作区的长期记忆回滚到 summary_history 里的某个版本。回滚前会先归档当前版本，回滚本身也可再回滚；回滚后进入 manual 冻结，需显式恢复 auto。',
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
        const entry = await store.get(args.id, true);
        if (!entry) throw new Error(`没有找到记忆 ${args.id}`);
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
    diagnostics.tools = 12;
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
      const [active, deleted, archived, summary, stats, versions, versionInfo, recent, curatorStatus, summaryIndex] = await Promise.all([
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
        content: entry.content ?? '',
        status: entry.status ?? 'active',
        deletedAt: entry.deletedAt ?? '',
        deleteReason: entry.deleteReason ?? '',
        trace: entry.trace ?? '',
        quote: entry.quote ?? '',
        sourceType: entry.sourceType ?? '',
        curatorOp: entry.curatorOp ?? '',
      });
      return {
        active: active.map(slim),
        deleted: deleted.map(slim),
        archivedCount: archived.length,
        archivedActiveCount: archived.filter((entry) => entry.status !== 'deleted').length,
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
      if (result.changed) {
        await store.scrubLongTermForDeleted([result.entry]).catch((error) => {
          logWarn(ctx, '设置页删除短期记忆后清洗长期记忆失败', error);
        });
      }
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'settings-forget' });
      return { changed: result.changed, alreadyDeleted: result.alreadyDeleted === true, id: result.entry?.id ?? '' };
    }));
    register(`${API_PREFIX}/restore`, guarded(async (body) => {
      const result = await store.restore(body.id);
      await queueMemoryForLiveAgents({ forceFull: true, reason: 'settings-restore' });
      return { changed: result.changed, alreadyActive: result.alreadyActive === true, id: result.entry?.id ?? '' };
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

  diagnostics.applyCompleted = true;
  void writeDiagnostics();
}

export { isWorkspacePath, byteLength };
