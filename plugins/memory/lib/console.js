// Host-side service behind the Scoped memory console.
//
// The browser never touches Markdown: every read and every mutation goes
// through this service, which reuses MemoryStore's lock, atomic writes,
// journal, and summary primitives. The service is harness-free so its behavior
// (including revision conflicts and summary scrubbing) can be tested with
// plain Node.js.

import {
  SUMMARY_FILE,
  byteLength,
  hashText,
  normalizeTags,
  summaryVersion,
  truncateUtf8Markdown,
  validateContent,
  validateMergedSummary,
  detectSecrets
} from './store.js'
import {
  clearProvenanceDeleted,
  markProvenanceDeleted,
  provenanceView,
  setProvenance
} from './provenance.js'
import { appendCuratorRun, summarizeCuratorLog } from './curator-log.js'
import { rewriteSummaryForMutation } from './summary-scrub.js'
import {
  MEMORY_SETTINGS_NAMESPACES,
  memorySettingsSnapshot,
  settingsPatchOps,
  settingsUserLayerPatch
} from './web.js'

/** Stable machine code for errors the UI renders differently. */
export class ConsoleError extends Error {
  constructor(message, status = 400, code = 'console-rejected') {
    super(message)
    this.name = 'ConsoleError'
    this.status = status
    this.code = code
  }
}

/**
 * The eight parameters the console edits. Defaults mirror the schema in
 * `lib/index.js`; the test suite compares them against Config.toJSON().
 */
export const CONSOLE_PARAMS = Object.freeze([
  {
    key: 'autoSummarize',
    kind: 'boolean',
    group: 'curation',
    default: true,
    live: true,
    labelZh: '自动整理',
    labelEn: 'Automatic curation',
    hintZh: '每累计 20 个有效回合后，由后台整理器提炼长期记忆。关闭后不再自动整理，手动整理仍可用。',
    hintEn: 'Distill memory in the background after every N effective turns. Turning it off stops automatic curation; manual curation still works.'
  },
  {
    key: 'curateEveryTurns',
    kind: 'integer',
    group: 'curation',
    default: 20,
    min: 1,
    max: 1000,
    live: true,
    labelZh: '整理间隔（有效回合）',
    labelEn: 'Curate every (effective turns)',
    hintZh: '每累计多少个有效回合触发一次后台整理。默认 20，是私人工作区正常使用的值。',
    hintEn: 'Effective turns between background curation runs. The default 20 is the tuned value for this workspace.'
  },
  {
    key: 'curateMaxOps',
    kind: 'integer',
    group: 'curation',
    default: 8,
    min: 1,
    max: 32,
    live: true,
    labelZh: '单次最大操作数（curateMaxOps）',
    labelEn: 'Max operations per run',
    hintZh: '一次整理最多执行多少条 add / update / merge。',
    hintEn: 'Maximum add/update/merge operations in one curation run.'
  },
  {
    key: 'curateMaxAdds',
    kind: 'integer',
    group: 'curation',
    default: 3,
    min: 0,
    max: 10,
    live: true,
    labelZh: '单次最大新增数（maxAdds）',
    labelEn: 'Max new entries per run',
    hintZh: '一次整理最多新增多少条记忆；设为 0 时只能更新或合并。',
    hintEn: 'Maximum new entries one run may add; 0 allows updates and merges only.'
  },
  {
    key: 'curateMaxBytes',
    kind: 'integer',
    group: 'curation',
    default: 40000,
    min: 4096,
    max: 200000,
    live: true,
    labelZh: '整理输入预算（字节）',
    labelEn: 'Curation input budget (bytes)',
    hintZh: '一次整理送给模型的对话与条目总量上限。',
    hintEn: 'Upper bound on the conversation and entries sent to the model for one run.'
  },
  {
    key: 'maxBytes',
    kind: 'integer',
    group: 'injection',
    default: 3000,
    min: 256,
    max: 1048576,
    live: true,
    labelZh: '注入摘要字节上限（maxBytes）',
    labelEn: 'Injected summary bytes (maxBytes)',
    hintZh: '每次提示词注入的摘要字节预算；超出会按完整行截断。',
    hintEn: 'Byte budget for the injected summary; truncation happens on whole lines.'
  },
  {
    key: 'injectTokens',
    kind: 'integer',
    group: 'injection',
    default: 1200,
    min: 0,
    max: 200000,
    live: true,
    labelZh: '注入 token 上限（injectTokens）',
    labelEn: 'Injected token cap (injectTokens)',
    hintZh: '估算 token 上限；0 表示只按字节限制。中文约每个字符 1 token。',
    hintEn: 'Estimated token cap; 0 leaves the byte budget in charge. CJK text costs about one token per character.'
  },
  {
    key: 'maxActiveSummaries',
    kind: 'integer',
    group: 'injection',
    default: 1,
    min: 1,
    max: 32,
    live: true,
    labelZh: '并发摘要上限（maxActiveSummaries）',
    labelEn: 'Concurrent summaries',
    hintZh: '同时进行的轮次摘要任务上限；超出后丢弃新任务。',
    hintEn: 'Maximum concurrent turn-summarization jobs; new jobs are dropped beyond it.'
  }
])

/** Recommended values offered by “restore recommended defaults”. */
export const RECOMMENDED_PARAMS = Object.freeze({
  autoSummarize: true,
  curateEveryTurns: 20,
  curateMaxOps: 8,
  curateMaxAdds: 3,
  curateMaxBytes: 40000,
  maxBytes: 3000,
  injectTokens: 1200,
  maxActiveSummaries: 1
})

/** Settings that stay visible but are never editable from this page. */
const LOCKED_SETTINGS = Object.freeze([
  { key: 'privateWorkspace', zh: '私人工作区', en: 'Private workspace', reasonZh: '决定哪些会话能使用记忆，需在 profile 中修改。', reasonEn: 'Decides which sessions may use memory; edit it in the profile.' },
  { key: 'memoryDir', zh: '记忆数据目录', en: 'Memory directory', reasonZh: '数据目录路径不允许由客户端指定，需在 profile 中修改。', reasonEn: 'The data directory is never client-selectable; edit it in the profile.' },
  { key: 'scopedMemory', zh: '工作区隔离', en: 'Workspace isolation', reasonZh: '关闭后记忆会落到全局作用域；本页拒绝管理全局记忆。', reasonEn: 'Turning it off moves memory to the global scope; this page refuses to manage global memory.' },
  { key: 'readOnlyScopes', zh: '只读作用域', en: 'Read-only scopes', reasonZh: '写入保护设置，需在 profile 中修改。', reasonEn: 'A write-protection setting; edit it in the profile.' },
  { key: 'seedFromAgentsMd', zh: 'AGENTS.md 种子', en: 'AGENTS.md seeding', reasonZh: '只在插件启动时读取，修改需重新加载插件。', reasonEn: 'Read only when the plugin starts; changing it requires a reload.' },
  { key: 'embeddingApiKey', zh: '嵌入 API 密钥', en: 'Embeddings API key', secret: true, reasonZh: '凭据永不通过本接口返回；只显示是否已配置。', reasonEn: 'Credentials are never returned by this endpoint; only whether one is configured.' }
])

const MAX_ENTRIES = 2000
const MAX_HISTORY = 50
const MAX_DELETED = 200

/** One stable revision for an entry, used for optimistic updates. */
export function memoryEntryRevision(entry) {
  return hashText([
    entry?.id ?? '',
    entry?.ts ?? '',
    entry?.content ?? '',
    Array.isArray(entry?.tags) ? entry.tags.join(',') : '',
    String(entry?.importance ?? '')
  ].join('\u0000')).slice(0, 16)
}

function isoNow(now) {
  return new Date(now).toISOString()
}

function clip(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function entryView(entry, provenance, archived) {
  return {
    id: entry.id,
    ts: entry.ts,
    content: entry.content,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    importance: Number.isFinite(entry.importance) ? entry.importance : 1,
    archived: archived === true,
    bytes: byteLength(entry.content ?? ''),
    revision: memoryEntryRevision(entry),
    provenance: provenanceView(provenance, entry.id)
  }
}

function sortEntries(left, right) {
  return String(right.ts ?? '').localeCompare(String(left.ts ?? ''))
}

/**
 * Make a mutation visible in the injected summary immediately.
 *
 * Shared by the console and the memory_* tools: scrub the stale bullet(s)
 * locally, append a bounded manual note, bump the version, and let the caller
 * queue the normal LLM consolidation. Returns the scrub outcome so a failure is
 * reported instead of hidden.
 */
export async function refreshInjectedSummary({ store, runtime, resolved = {}, remove = [], note = '', now = Date.now() } = {}) {
  let changed = false
  let removed = []
  let error = null
  const budget = Math.max(256, Math.min(
    Number.isFinite(resolved.maxBytes) ? resolved.maxBytes : 3000,
    Number.isFinite(resolved.scopeMaxBytes) && resolved.scopeMaxBytes > 0 ? resolved.scopeMaxBytes : 3000
  ))
  try {
    await store.withLock(async () => {
      const before = await store.readSummary()
      const result = rewriteSummaryForMutation(before, { remove, note })
      if (!result.ok) {
        error = result.reason ?? '摘要重写失败'
        return
      }
      if (!result.changed) return
      const bounded = truncateUtf8Markdown(result.text, budget)
      const check = validateMergedSummary(bounded)
      if (!check.ok) {
        error = check.reason
        return
      }
      await store.archiveCurrentSummary(resolved.keepSummaryVersions ?? 20)
      await store.writeAtomic(SUMMARY_FILE, bounded.trimEnd() + '\n')
      runtime.state.version = summaryVersion(bounded)
      runtime.state.lastConsolidatedAt = now
      await store.writeState(runtime.state)
      changed = true
      removed = result.removed
    })
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure)
  }
  return { changed, removed, error, version: runtime?.state?.version ?? 0 }
}

/**
 * Service behind `GET/POST /_dsh/memory/console`.
 */
export class MemoryConsoleService {
  constructor(options = {}) {
    this.store = options.store
    this.runtime = options.runtime
    this.resolved = options.resolved ?? {}
    this.scopeKey = options.scopeKey
    this.scopeLabel = options.scopeLabel ?? '私人工作区'
    this.getPending = options.getPending
    this.getCurator = options.getCurator ?? (() => ({}))
    this.getLiveSessions = options.getLiveSessions ?? (() => [])
    this.requestConsolidation = options.requestConsolidation ?? (() => {})
    this.runCuration = options.runCuration
    this.settings = options.settings
    this.readDefaults = options.readDefaults
    this.readDiagnostics = options.readDiagnostics
    this.namespaces = options.namespaces ?? MEMORY_SETTINGS_NAMESPACES
    this.now = options.now ?? (() => Date.now())
    this.runLimit = Number.isFinite(options.runLimit) ? options.runLimit : 100
  }

  assertScope() {
    if (this.resolved.scopedMemory !== true) {
      throw new ConsoleError('当前配置未启用工作区隔离，管理页面不会读取全局记忆。请先在插件配置中开启 scopedMemory。', 409, 'scope-disabled')
    }
    if (typeof this.scopeKey !== 'string' || this.scopeKey === 'global' || !this.scopeKey.startsWith('ws-')) {
      throw new ConsoleError('无法解析私人工作区作用域，管理页面已拒绝读取。', 409, 'scope-unresolved')
    }
  }

  summaryBudget() {
    const maxBytes = Number.isFinite(this.resolved.maxBytes) ? this.resolved.maxBytes : 3000
    const scopeMax = Number.isFinite(this.resolved.scopeMaxBytes) ? this.resolved.scopeMaxBytes : 1200
    return Math.max(256, Math.min(maxBytes, scopeMax > 0 ? scopeMax : maxBytes))
  }

  async readPendingSafe() {
    try {
      const pending = await this.getPending()
      return pending !== null && typeof pending === 'object' ? pending : { sessions: {}, owned: {}, lifetimeTurns: 0 }
    } catch {
      return { sessions: {}, owned: {}, lifetimeTurns: 0 }
    }
  }

  async readAllEntries() {
    const active = await this.store.readRawEntries()
    const archived = await this.store.readArchivedEntries()
    return { active, archived }
  }

  /**
   * Full console snapshot: summary, entries, provenance, curator status,
   * pending sessions, and the parameter view.
   */
  async snapshot() {
    this.assertScope()
    const [summaryText, summaryInfo, history, provenance, log, pending, settings, diagnostics] = await Promise.all([
      this.store.readSummary(),
      this.store.fileInfo(SUMMARY_FILE),
      this.store.listSummaryHistory(),
      this.store.readProvenance(),
      this.store.readCuratorLog(),
      this.readPendingSafe(),
      this.settingsView(),
      typeof this.readDiagnostics === 'function' ? this.readDiagnostics() : Promise.resolve({})
    ])
    const { active, archived } = await this.readAllEntries()
    const fileVersion = summaryVersion(summaryText)
    if (Number.isFinite(fileVersion) && fileVersion !== this.runtime?.state?.version) {
      // A manual repair or another writer may have advanced the file while this
      // process was idle; the file is authoritative for what the model sees.
      if (this.runtime?.state !== undefined) {
        this.runtime.state.version = fileVersion
        this.runtime.state.lastConsolidatedAt = Math.max(this.runtime.state.lastConsolidatedAt || 0, summaryInfo.mtime)
      }
    }
    const entries = [
      ...active.map((entry) => entryView(entry, provenance, false)),
      ...archived
        .filter((entry) => !active.some((item) => item.id === entry.id))
        .map((entry) => entryView(entry, provenance, true))
    ].sort(sortEntries).slice(0, MAX_ENTRIES)
    const deleted = await this.readDeleted(provenance, active)
    const curator = this.curatorStatus(pending, log, diagnostics)
    const tags = new Map()
    for (const entry of entries) {
      for (const tag of entry.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
    }
    return {
      scope: { key: this.scopeKey, label: this.scopeLabel },
      generatedAt: isoNow(this.now()),
      revision: hashText(`${summaryText}\u0000${JSON.stringify(entries.map((entry) => entry.revision))}`).slice(0, 16),
      summary: {
        text: summaryText,
        version: summaryVersion(summaryText),
        bytes: byteLength(summaryText),
        updatedAt: summaryInfo.mtime,
        budgetBytes: this.summaryBudget(),
        history: history.map(({ version, file, mtime, bytes }) => ({ version, file, mtime, bytes }))
      },
      entries,
      deleted,
      tags: [...tags.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      curator,
      settings,
      locked: this.lockedSettings()
    }
  }

  async readDeleted(provenance, active) {
    const activeIds = new Set(active.map((entry) => entry.id))
    const { events } = await this.store.readJournal(0)
    const latest = new Map()
    for (const event of events) {
      if (typeof event.id !== 'string' || event.id.length === 0) continue
      latest.set(event.id, event)
    }
    const rows = []
    for (const [id, event] of latest) {
      if (activeIds.has(id) || event.op !== 'delete' || !isPlainObject(event.entry)) continue
      const provenanceRecord = provenanceView(provenance, id)
      if (provenanceRecord.mergedInto !== null) continue
      rows.push({
        ...entryView(event.entry, provenance, false),
        deletedAt: provenanceRecord.deletedAt ?? event.entry.ts ?? ''
      })
    }
    return rows.sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt))).slice(0, MAX_DELETED)
  }

  curatorStatus(pending, log, diagnostics = {}) {
    const now = this.now()
    const live = new Set((this.getLiveSessions() ?? []).map((session) => (typeof session === 'string' ? session : session.id)))
    const every = Number.isFinite(this.resolved.curateEveryTurns) ? this.resolved.curateEveryTurns : 20
    const sessions = Object.entries(pending.sessions ?? {}).map(([id, record]) => {
      const owned = pending.owned?.[id] !== undefined
      const pendingTurns = Number.isFinite(record.pendingTurns) ? record.pendingTurns : 0
      return {
        id,
        shortId: id.replace(/^session-/, '').slice(0, 8),
        pendingTurns,
        remaining: Math.max(0, every - pendingTurns),
        owned,
        live: live.has(id),
        lastTurnAt: record.lastTurnAt ?? 0,
        lastCuratedAt: record.lastCuratedAt ?? 0,
        lastAttemptAt: record.lastAttemptAt ?? 0,
        attempts: record.attempts ?? 0,
        emptyChecks: record.emptyChecks ?? 0
      }
    }).sort((left, right) => right.pendingTurns - left.pendingTurns || right.lastTurnAt - left.lastTurnAt)
    const totals = summarizeCuratorLog(log)
    const runtime = this.getCurator() ?? {}
    // Before this build the plugin only kept aggregate counters in
    // diagnostics.json. Show that one legacy record, labelled as such, instead
    // of pretending no curation ever ran; per-run detail starts with the log.
    const legacy = diagnostics?.curator
    let lastRun = totals.lastRun
    let runs = log.runs
    if (lastRun === null && legacy !== null && typeof legacy === 'object' && Number.isFinite(legacy.lastAt)) {
      lastRun = {
        runId: 'legacy-aggregate',
        startedAt: legacy.lastAt,
        endedAt: legacy.lastAt,
        sessionId: typeof legacy.lastSessionId === 'string' ? legacy.lastSessionId : '',
        trigger: 'threshold',
        status: legacy.lastError ? 'failed' : legacy.lastEmpty === true ? 'empty' : 'ok',
        adds: Number.isFinite(legacy.applied) ? Math.trunc(legacy.applied) : 0,
        updates: 0,
        merges: 0,
        llmCalls: Number.isFinite(legacy.calls) ? Math.trunc(legacy.calls) : 0,
        llmFailures: 0,
        legacy: true,
        ...(typeof legacy.lastError === 'string' ? { error: legacy.lastError } : {})
      }
      runs = [lastRun]
    }
    // The threshold is workspace-wide: A=8, B=6, C=6 is 20 even though no
    // single session reaches it. Keep per-session remaining for diagnostics,
    // but compute the live countdown from the owned-session sum.
    const workspacePending = sessions
      .filter((session) => session.owned)
      .reduce((sum, session) => sum + session.pendingTurns, 0)
    const next = Math.max(0, every - workspacePending)
    return {
      running: Array.isArray(runtime.running) ? runtime.running : [],
      consolidating: runtime.consolidating === true,
      everyTurns: every,
      lifetimeTurns: Number.isFinite(pending.lifetimeTurns) ? pending.lifetimeTurns : 0,
      pendingTurns: workspacePending,
      nextIn: next,
      sessions,
      lastRun,
      totals: totals.totals,
      runs,
      llm: {
        calls: totals.totals.llmCalls > 0 ? totals.totals.llmCalls : (lastRun?.llmCalls ?? runtime.curatorCalls ?? 0),
        failures: totals.totals.llmFailures > 0 ? totals.totals.llmFailures : (lastRun?.llmFailures ?? runtime.curatorFailures ?? 0),
        ms: runtime.llm?.ms ?? 0
      },
      summary: {
        version: Number.isFinite(this.runtime?.state?.version) ? this.runtime.state.version : 0,
        updatedAt: Number.isFinite(this.runtime?.state?.lastConsolidatedAt) ? this.runtime.state.lastConsolidatedAt : 0
      },
      lastError: totals.lastRun?.error ?? runtime.lastError?.message ?? null,
      orphanGraceMs: Number.isFinite(this.resolved.orphanGraceMs) ? this.resolved.orphanGraceMs : 0,
      checkedAt: now
    }
  }

  async settingsView() {
    let snapshot
    try {
      snapshot = memorySettingsSnapshot(this.settings, this.readDefaults, this.namespaces)
    } catch (error) {
      throw new ConsoleError(`设置服务暂不可用：${error instanceof Error ? error.message : String(error)}`, 503, 'settings-unavailable')
    }
    const descriptor = snapshot.settings
    const value = isPlainObject(descriptor.value) ? descriptor.value : {}
    const user = isPlainObject(descriptor.user) ? descriptor.user : {}
    const base = isPlainObject(descriptor.base) ? descriptor.base : {}
    const defaults = isPlainObject(descriptor.defaults) ? descriptor.defaults : {}
    const fields = CONSOLE_PARAMS.map((spec) => {
      const effective = value[spec.key] !== undefined ? value[spec.key] : this.resolved[spec.key]
      return {
        key: spec.key,
        kind: spec.kind,
        group: spec.group,
        live: spec.live,
        value: spec.kind === 'boolean' ? effective !== false : Number.isFinite(effective) ? Math.trunc(effective) : spec.default,
        defaultValue: defaults[spec.key] !== undefined ? defaults[spec.key] : spec.default,
        baseValue: base[spec.key],
        overridden: Object.prototype.hasOwnProperty.call(user, spec.key),
        min: spec.min,
        max: spec.max,
        labelZh: spec.labelZh,
        labelEn: spec.labelEn,
        hintZh: spec.hintZh,
        hintEn: spec.hintEn,
        recommended: RECOMMENDED_PARAMS[spec.key]
      }
    })
    return {
      namespace: snapshot.ns,
      writable: snapshot.writable,
      revision: descriptor.revision,
      fields,
      secretsConfigured: Array.isArray(descriptor.secrets) ? descriptor.secrets : []
    }
  }

  lockedSettings() {
    return LOCKED_SETTINGS.map((row) => {
      if (row.secret === true) {
        const configured = typeof this.resolved.embeddingApiKey === 'string' && this.resolved.embeddingApiKey.length > 0
        return {
          key: row.key,
          value: configured ? 'configured' : 'not-configured',
          configured,
          zh: row.zh,
          en: row.en,
          reasonZh: row.reasonZh,
          reasonEn: row.reasonEn
        }
      }
      return {
        key: row.key,
        value: this.resolved[row.key] ?? null,
        zh: row.zh,
        en: row.en,
        reasonZh: row.reasonZh,
        reasonEn: row.reasonEn
      }
    })
  }

  /** Entry detail plus its journal history. */
  async entry(id) {
    this.assertScope()
    const key = String(id ?? '').trim()
    if (!/^mem-[A-Za-z0-9_-]{4,64}$/.test(key)) throw new ConsoleError('记忆 ID 格式无效', 400, 'invalid-id')
    const { active, archived } = await this.readAllEntries()
    const current = active.find((entry) => entry.id === key) ?? archived.find((entry) => entry.id === key)
    const provenance = await this.store.readProvenance()
    const { events } = await this.store.readJournal(0)
    const history = events
      .filter((event) => event.id === key && isPlainObject(event.entry))
      .slice(-MAX_HISTORY)
      .reverse()
      .map((event) => ({
        seq: event.seq,
        op: event.op,
        ts: event.entry.ts,
        content: event.entry.content,
        tags: Array.isArray(event.entry.tags) ? event.entry.tags : [],
        importance: Number.isFinite(event.entry.importance) ? event.entry.importance : 1,
        revision: memoryEntryRevision(event.entry)
      }))
    if (current === undefined && history.length === 0) throw new ConsoleError('找不到这条记忆', 404, 'not-found')
    return {
      entry: current === undefined ? null : entryView(current, provenance, !active.some((entry) => entry.id === key)),
      provenance: provenanceView(provenance, key),
      history
    }
  }

  validateParam(key, value) {
    const spec = CONSOLE_PARAMS.find((item) => item.key === key)
    if (spec === undefined) throw new ConsoleError(`参数 ${key} 不允许在此修改`, 400, 'param-locked')
    if (spec.kind === 'boolean') {
      if (typeof value !== 'boolean') throw new ConsoleError(`${spec.labelZh} 必须是 true 或 false`, 400, 'invalid-param')
      return value
    }
    if (!Number.isInteger(value)) throw new ConsoleError(`${spec.labelZh} 必须是整数`, 400, 'invalid-param')
    if (value < spec.min || value > spec.max) {
      throw new ConsoleError(`${spec.labelZh} 必须在 ${spec.min} 到 ${spec.max} 之间`, 400, 'invalid-param')
    }
    return value
  }

  async saveSettings(payload = {}) {
    this.assertScope()
    if (this.settings === undefined || this.settings.writable !== true) throw new ConsoleError('本部署的设置为只读', 409, 'settings-readonly')
    const set = isPlainObject(payload.set) ? payload.set : {}
    const unset = Array.isArray(payload.unset) ? payload.unset.filter((key) => typeof key === 'string') : []
    const normalizedSet = {}
    for (const [key, value] of Object.entries(set)) normalizedSet[key] = this.validateParam(key, value)
    for (const key of unset) this.validateParam(key, this.resolved[key])
    const expected = Number.isSafeInteger(payload.expectedRevision) ? payload.expectedRevision : undefined
    const before = memorySettingsSnapshot(this.settings, this.readDefaults, this.namespaces)
    const patch = settingsUserLayerPatch({ set: normalizedSet, unset }, before.settings)
    if (Object.keys(patch.set).length === 0 && patch.unset.length === 0) return this.settingsView()
    try {
      await this.settings.mutate(before.ns, settingsPatchOps(patch), expected)
    } catch (error) {
      const conflict = error !== null && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT'
      throw new ConsoleError(
        conflict ? '配置已被另一个窗口修改，请刷新后重试。' : `配置保存失败：${error instanceof Error ? error.message : String(error)}`,
        conflict ? 409 : 400,
        conflict ? 'settings-conflict' : 'settings-rejected'
      )
    }
    return this.settingsView()
  }

  /** Restore one previously retained summary version. */
  async restoreSummary(version, confirm) {
    this.assertScope()
    if (confirm !== true) throw new ConsoleError('恢复摘要需要确认', 400, 'confirm-required')
    const target = Number.isInteger(version) ? version : -1
    if (target < 1) throw new ConsoleError('摘要版本号无效', 400, 'invalid-version')
    const match = await this.store.latestSummaryHistory(target)
    if (match === null) throw new ConsoleError(`没有保留的摘要版本 v${target}`, 404, 'version-not-found')
    const bounded = truncateUtf8Markdown(match.text, this.summaryBudget())
    if (!bounded.startsWith('# DSH memory') || summaryVersion(bounded) < 1 || !validateMergedSummary(bounded).ok) {
      throw new ConsoleError('保留的摘要版本格式无效，已拒绝写入', 409, 'invalid-summary')
    }
    await this.store.withLock(async () => {
      await this.store.archiveCurrentSummary(this.resolved.keepSummaryVersions ?? 20)
      await this.store.writeAtomic(SUMMARY_FILE, bounded.trimEnd() + '\n')
      this.runtime.state.version = summaryVersion(bounded)
      this.runtime.state.lastConsolidatedAt = this.now()
      await this.store.writeState(this.runtime.state)
    })
    return { restoredVersion: summaryVersion(bounded), sourceFile: match.file }
  }

  async mutate(payload = {}) {
    this.assertScope()
    const action = String(payload.action ?? '')
    if (action === 'add') return this.addEntry(payload)
    if (action === 'update') return this.updateEntry(payload)
    if (action === 'delete') return this.deleteEntry(payload)
    if (action === 'restore-entry') return this.restoreEntry(payload)
    if (action === 'restore-summary') return this.restoreSummary(payload.version, payload.confirm)
    if (action === 'curate-now') return this.curateNow()
    if (action === 'refresh') return this.snapshot()
    throw new ConsoleError(`不支持的操作：${action || '(empty)'}`, 400, 'unknown-action')
  }

  async addEntry(payload) {
    const content = validateContent(payload.content)
    const secrets = detectSecrets(content)
    if (secrets.length > 0) throw new ConsoleError(`内容看起来包含凭据（${secrets.map((item) => item.type).join(',')}），拒绝写入`, 400, 'credential-rejected')
    const tags = normalizeTags(Array.isArray(payload.tags) ? payload.tags : [])
    const importance = Number.isFinite(payload.importance) ? Math.min(3, Math.max(0, Math.trunc(payload.importance))) : 1
    const allowDuplicate = payload.allowDuplicate === true
    let entry
    await this.store.withLock(async () => {
      const duplicate = await this.store.findDuplicate(content)
      if (duplicate !== undefined && !allowDuplicate) {
        throw new ConsoleError(`已存在相同内容的记忆 ${duplicate.id}`, 409, 'duplicate-entry')
      }
      entry = await this.store.appendRawEntry({ content, tags, importance })
      await this.store.appendJournal({ op: 'add', id: entry.id, ts: entry.ts, entry })
      const now = isoNow(this.now())
      const provenance = await this.store.readProvenance()
      setProvenance(provenance, entry.id, {
        sourceType: 'manual',
        recordedBy: 'manual',
        evidence: '用户在设置页手动添加',
        createdAt: entry.ts,
        updatedAt: now
      })
      await this.store.writeProvenance(provenance)
    })
    const summary = await this.refreshSummary({ note: entry.content })
    this.requestConsolidation()
    return { ok: true, entry, summary }
  }

  async updateEntry(payload) {
    const id = String(payload.id ?? '').trim()
    if (!/^mem-[A-Za-z0-9_-]{4,64}$/.test(id)) throw new ConsoleError('记忆 ID 格式无效', 400, 'invalid-id')
    const expected = typeof payload.expectedEntryRevision === 'string' ? payload.expectedEntryRevision : ''
    let before
    let beforeSnapshot
    let after
    let revision = ''
    await this.store.withLock(async () => {
      const entries = await this.store.readRawEntries()
      before = entries.find((entry) => entry.id === id)
      if (before === undefined) throw new ConsoleError('找不到这条记忆，可能已被删除', 404, 'not-found')
      revision = memoryEntryRevision(before)
      if (expected.length > 0 && expected !== revision) {
        throw new ConsoleError('这条记忆已被其他操作修改，请刷新后重试。', 409, 'entry-conflict')
      }
      // `updateRawEntry` mutates the entry object it finds. Snapshot the old
      // content first, otherwise the summary scrub is asked to remove the NEW
      // text and the old bullet survives.
      const beforeSnapshotLocal = {
        ...before,
        tags: Array.isArray(before.tags) ? [...before.tags] : []
      }
      beforeSnapshot = beforeSnapshotLocal
      const patch = {}
      if (payload.content !== undefined) {
        patch.content = validateContent(payload.content)
        const secrets = detectSecrets(patch.content)
        if (secrets.length > 0) throw new ConsoleError(`内容看起来包含凭据（${secrets.map((item) => item.type).join(',')}），拒绝写入`, 400, 'credential-rejected')
      }
      if (payload.tags !== undefined) patch.tags = normalizeTags(Array.isArray(payload.tags) ? payload.tags : [])
      if (payload.importance !== undefined) patch.importance = Math.min(3, Math.max(0, Math.trunc(payload.importance)))
      if (patch.content === undefined && patch.tags === undefined && patch.importance === undefined) {
        throw new ConsoleError('没有可更新的字段', 400, 'empty-update')
      }
      after = await this.store.updateRawEntry(id, patch)
      await this.store.appendJournal({ op: 'update', id: after.id, ts: after.ts, entry: after })
      const now = isoNow(this.now())
      const provenance = await this.store.readProvenance()
      setProvenance(provenance, id, {
        sourceType: 'manual',
        recordedBy: 'manual_edit',
        evidence: '用户在设置页手动编辑',
        createdAt: before.ts,
        updatedAt: now
      })
      await this.store.writeProvenance(provenance)
    })
    const summary = await this.refreshSummary({ remove: [beforeSnapshot], note: after.content })
    this.requestConsolidation()
    return { ok: true, entry: after, previousRevision: revision, summary }
  }

  async deleteEntry(payload) {
    if (payload.confirm !== true) throw new ConsoleError('删除需要二次确认', 400, 'confirm-required')
    const id = String(payload.id ?? '').trim()
    if (!/^mem-[A-Za-z0-9_-]{4,64}$/.test(id)) throw new ConsoleError('记忆 ID 格式无效', 400, 'invalid-id')
    const expected = typeof payload.expectedEntryRevision === 'string' ? payload.expectedEntryRevision : ''
    let removed
    await this.store.withLock(async () => {
      const entries = await this.store.readRawEntries()
      const target = entries.find((entry) => entry.id === id)
      if (target === undefined) throw new ConsoleError('找不到这条记忆，可能已被删除', 404, 'not-found')
      if (expected.length > 0 && expected !== memoryEntryRevision(target)) {
        throw new ConsoleError('这条记忆已被其他操作修改，请刷新后重试。', 409, 'entry-conflict')
      }
      removed = await this.store.deleteRawEntry(id)
      await this.store.appendJournal({ op: 'delete', id: removed.id, ts: removed.ts, entry: removed })
      const provenance = await this.store.readProvenance()
      markProvenanceDeleted(provenance, id, isoNow(this.now()))
      await this.store.writeProvenance(provenance)
    })
    const summary = await this.refreshSummary({ remove: [removed] })
    this.requestConsolidation()
    return { ok: true, removed: { id: removed.id, content: removed.content }, summary, restorable: true }
  }

  async restoreEntry(payload) {
    const id = String(payload.id ?? '').trim()
    if (!/^mem-[A-Za-z0-9_-]{4,64}$/.test(id)) throw new ConsoleError('记忆 ID 格式无效', 400, 'invalid-id')
    const { events } = await this.store.readJournal(0)
    const candidates = events.filter((event) => event.id === id && isPlainObject(event.entry) && event.op !== 'delete')
    const snapshot = candidates.length > 0 ? candidates[candidates.length - 1].entry : events.filter((event) => event.id === id && isPlainObject(event.entry)).at(-1)?.entry
    if (snapshot === undefined) throw new ConsoleError('没有可恢复的历史版本', 404, 'no-history')
    let restored
    await this.store.withLock(async () => {
      restored = await this.store.restoreRawEntry(snapshot)
      await this.store.appendJournal({ op: 'add', id: restored.id, ts: restored.ts, entry: restored })
      const provenance = await this.store.readProvenance()
      clearProvenanceDeleted(provenance, id)
      setProvenance(provenance, id, {
        recordedBy: 'manual',
        evidence: '用户从历史记录恢复',
        createdAt: snapshot.ts,
        updatedAt: isoNow(this.now())
      })
      await this.store.writeProvenance(provenance)
    })
    const summary = await this.refreshSummary({ note: restored.content })
    this.requestConsolidation()
    return { ok: true, entry: restored, summary }
  }

  async curateNow() {
    if (typeof this.runCuration !== 'function') throw new ConsoleError('手动整理不可用', 503, 'curator-unavailable')
    const pending = await this.readPendingSafe()
    const owned = Object.entries(pending.sessions ?? {})
      .filter(([id, record]) => pending.owned?.[id] !== undefined && (record.pendingTurns ?? 0) > 0)
      .sort((left, right) => (right[1].pendingTurns ?? 0) - (left[1].pendingTurns ?? 0))
    if (owned.length === 0) return { ok: true, status: 'nothing-pending', message: '当前没有待整理的有效回合。' }
    await this.runCuration(owned[0][0])
    const log = await this.store.readCuratorLog()
    return { ok: true, status: 'ran', run: log.runs[0] ?? null }
  }

  /**
   * Make a mutation visible in the injected summary immediately.
   * @param options - `{remove, note}`.
   */
  async refreshSummary({ remove = [], note = '' } = {}) {
    return refreshInjectedSummary({
      store: this.store,
      runtime: this.runtime,
      resolved: this.resolved,
      remove,
      note,
      now: this.now()
    })
  }

  /** Return the latest curator run after a manual trigger. */
  async lastRun() {
    const log = await this.store.readCuratorLog()
    return log.runs[0] ?? null
  }

  /** Append a curator run through the store lock (used by the host wiring). */
  async recordRun(run) {
    await this.store.withLock(async () => {
      const log = await this.store.readCuratorLog()
      await this.store.writeCuratorLog(appendCuratorRun(log, run, this.runLimit))
    })
  }
}
