// 私人工作区专用：隔离判定、待整理轮次状态、curator 输入与操作校验。
//
// 本模块只依赖 node 内置模块与同目录的纯逻辑模块，方便脱离 DSH 宿主单测。
// 记忆引擎仍由 dsh-memory 的 store / 工具 / consolidation 提供，这里只做策略。

import { byteLength, detectSecrets } from './store.js'
import { extractMessageText, formatToolCall, formatToolResult } from './automation.js'

/** 私人工作区默认路径。生产配置必须显式写入，留空会在启动时拒绝启用自动记忆。 */
export const DEFAULT_PRIVATE_WORKSPACE = ''

/** 每个作用域目录下的待整理状态文件。 */
export const PENDING_FILE = 'pending-turns.json'
export const PENDING_VERSION = 1

/** 默认兜底宽限期：只有“非活跃且最后活动早于该时长”的会话才允许提前整理。 */
export const DEFAULT_ORPHAN_GRACE_MS = 5 * 60 * 1000

/** 统一路径比较：分隔符、尾部分隔符、大小写。 */
export function normalizePath(value) {
  let text = String(value ?? '').trim()
  if (text.length === 0) return ''
  text = text.replace(/\//g, '\\')
  if (text.length > 3 && text.endsWith('\\')) text = text.slice(0, -1)
  return text.toLowerCase()
}

/** 精确匹配：默认工作区是 `C:\Workspaces\private` 的子目录，前缀匹配会泄漏。 */
export function isPrivateWorkspace(cwd, privateWorkspace) {
  const target = normalizePath(privateWorkspace)
  if (target.length === 0) return false
  return normalizePath(cwd) === target
}

/** 从 session.header.cwd 判定是否私人工作区会话。 */
export function isPrivateSession(session, privateWorkspace) {
  return isPrivateWorkspace(session && session.header ? session.header.cwd : '', privateWorkspace)
}

/** 一个空状态。 */
export function emptyPendingState() {
  return { version: PENDING_VERSION, lifetimeTurns: 0, owned: {}, sessions: {} }
}

function counter(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

/** 容忍损坏/旧格式的状态文件。 */
export function normalizePendingState(raw) {
  const state = emptyPendingState()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return state
  state.lifetimeTurns = counter(raw.lifetimeTurns)
  const owned = raw.owned
  if (owned !== null && typeof owned === 'object' && !Array.isArray(owned)) {
    let seen = 0
    for (const [sessionId, record] of Object.entries(owned)) {
      if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) continue
      if (record === null || typeof record !== 'object' || Array.isArray(record)) continue
      if (seen >= MAX_OWNED_SESSIONS) break
      state.owned[sessionId] = {
        firstSeenAt: counter(record.firstSeenAt),
        lastSeenAt: counter(record.lastSeenAt),
        ...(typeof record.cwd === 'string' && record.cwd.length > 0 ? { cwd: record.cwd } : {})
      }
      seen += 1
    }
  }
  const sessions = raw.sessions
  if (sessions === null || typeof sessions !== 'object' || Array.isArray(sessions)) return state
  for (const [sessionId, record] of Object.entries(sessions)) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue
    if (record === null || typeof record !== 'object' || Array.isArray(record)) continue
    state.sessions[sessionId] = {
      pendingTurns: counter(record.pendingTurns),
      cursorSeq: counter(record.cursorSeq),
      countedSeq: counter(record.countedSeq),
      lastTurnAt: counter(record.lastTurnAt),
      lastCuratedAt: counter(record.lastCuratedAt),
      lastAttemptAt: counter(record.lastAttemptAt),
      attempts: counter(record.attempts),
      emptyChecks: counter(record.emptyChecks)
    }
  }
  return state
}

/** Hard cap on the session-ownership ledger. */
export const MAX_OWNED_SESSIONS = 200

/**
 * Record that this plugin itself observed a private root session. Curation may
 * only run for ids in this ledger: cwd equality alone is not proof of
 * ownership, especially for historical sessions from another workspace.
 */
export function markSessionOwned(state, sessionId, options = {}) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return state
  if (state.owned === undefined || state.owned === null || typeof state.owned !== 'object') state.owned = {}
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const previous = state.owned[sessionId]
  const cwd = typeof options.cwd === 'string' && options.cwd.length > 0 ? options.cwd : previous?.cwd
  state.owned[sessionId] = {
    firstSeenAt: previous?.firstSeenAt !== undefined ? previous.firstSeenAt : now,
    lastSeenAt: now,
    ...(cwd !== undefined ? { cwd } : {})
  }
  const ids = Object.keys(state.owned)
  if (ids.length > MAX_OWNED_SESSIONS) {
    ids.sort((left, right) => (state.owned[left].lastSeenAt ?? 0) - (state.owned[right].lastSeenAt ?? 0))
    for (const id of ids.slice(0, ids.length - MAX_OWNED_SESSIONS)) delete state.owned[id]
  }
  return state
}

/** Whether the ledger says this plugin saw the session as a private root turn. */
export function isSessionOwned(state, sessionId) {
  return state !== null && typeof state === 'object' &&
    state.owned !== null && typeof state.owned === 'object' &&
    state.owned[sessionId] !== undefined
}

/**
 * 一次 curator 结束后是否需要 consolidation：
 * 空结果或全部是重复条目时不触发，避免无意义的摘要重写。
 */
export function shouldConsolidateAfterCuration(operations, applied) {
  if (!Array.isArray(operations) || operations.length === 0) return false
  if (!Array.isArray(applied) || applied.length === 0) return false
  return applied.some((item) => item !== null && typeof item === 'object' && item.duplicate !== true)
}

/** 取（必要时创建）一个会话的待整理记录。 */
export function pendingRecord(state, sessionId, now = Date.now()) {
  if (state.sessions[sessionId] === undefined) {
    state.sessions[sessionId] = {
      pendingTurns: 0,
      cursorSeq: 0,
      countedSeq: 0,
      lastTurnAt: now,
      lastCuratedAt: 0,
      lastAttemptAt: 0,
      attempts: 0,
      emptyChecks: 0
    }
  }
  return state.sessions[sessionId]
}

/**
 * 只有“非活跃 + 超过宽限期 + 仍有待整理回合”的会话才允许提前整理。
 * 新建会话绝不能仅凭自身创建就把其他会话判定为已结束。
 */
export function shouldFlushOrphan(record, options = {}) {
  if (record === null || typeof record !== 'object') return false
  if (record.pendingTurns < 1) return false
  if (options.live === true) return false
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const graceMs = Number.isFinite(options.graceMs) ? options.graceMs : DEFAULT_ORPHAN_GRACE_MS
  return now - record.lastTurnAt >= Math.max(0, graceMs)
}

/**
 * 一次 curator 结束后推进游标并扣减已处理回合；curator 运行期间新到的回合保留。
 * 空结果同样推进游标，避免同一批对话被反复分析。
 */
export function advancePendingAfterCuration(record, options = {}) {
  const lastSeq = Number.isFinite(options.lastSeq) ? options.lastSeq : record.cursorSeq
  const processed = Number.isFinite(options.processedTurns) ? options.processedTurns : record.pendingTurns
  record.cursorSeq = Math.max(record.cursorSeq, lastSeq)
  record.pendingTurns = Math.max(0, record.pendingTurns - Math.max(0, processed))
  record.lastCuratedAt = Number.isFinite(options.now) ? options.now : Date.now()
  record.lastAttemptAt = 0
  record.attempts = 0
  if (options.empty === true) record.emptyChecks += 1
  return record
}

/** 不丢待整理记录：只清理由本插件见过、且已无待整理内容的老记录。 */
export function prunePendingState(state, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const maxAgeDays = Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : 30
  const maxSessions = Number.isFinite(options.maxSessions) ? options.maxSessions : 400
  const ownedAgeDays = Number.isFinite(options.ownedAgeDays) ? options.ownedAgeDays : 90
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000
  for (const [sessionId, record] of Object.entries(state.sessions)) {
    if (record.pendingTurns === 0 && record.lastTurnAt > 0 && record.lastTurnAt < cutoff) {
      delete state.sessions[sessionId]
    }
  }
  const entries = Object.entries(state.sessions)
  if (entries.length > maxSessions) {
    entries.sort((a, b) => a[1].lastTurnAt - b[1].lastTurnAt)
    for (const [sessionId, record] of entries.slice(0, entries.length - maxSessions)) {
      // 有未整理回合的记录一律保留，交给后续 curator；只裁掉空记录。
      if (record.pendingTurns === 0) delete state.sessions[sessionId]
    }
  }
  const ownedCutoff = now - ownedAgeDays * 24 * 60 * 60 * 1000
  for (const [sessionId, record] of Object.entries(state.owned ?? {})) {
    const pending = state.sessions[sessionId]?.pendingTurns ?? 0
    if (pending === 0 && record.lastSeenAt > 0 && record.lastSeenAt < ownedCutoff) {
      delete state.owned[sessionId]
    }
  }
  return state
}

/** 是否是真实人类用户消息（排除 schedule、subagent、agent-instructions 等）。 */
export function isHumanUserEvent(event) {
  if (event === null || typeof event !== 'object' || event.type !== 'user/message') return false
  const data = event.data
  const source = data && typeof data === 'object' ? data.source : undefined
  return source !== null && typeof source === 'object' && source.kind === 'user'
}

/** 一批事件里是否至少有一次“用户发话 + 助手答复”。 */
export function hasHumanExchange(events) {
  let human = false
  let assistant = false
  for (const event of events) {
    if (isHumanUserEvent(event)) human = true
    if (event && event.type === 'assistant/message' && extractMessageText(event.data).trim().length > 0) assistant = true
    if (human && assistant) return true
  }
  return false
}

/** 事件里最大的 seq；空数组返回 -1。 */
export function lastEventSeq(events) {
  let seq = -1
  for (const event of events) {
    const value = event && Number.isFinite(event.seq) ? Math.trunc(event.seq) : -1
    if (value > seq) seq = value
  }
  return seq
}

/**
 * 把一段事件压成有界的对话行与文本。
 *
 * 行对象保留 seq、角色、工具名与参数，供 provenance 归属使用；文本严格保持
 * 与旧版 buildBatchTranscript 相同的格式，curator 提示词不需要感知变化。
 */
export function buildTranscriptLines(events, options = {}) {
  const fromSeq = Number.isFinite(options.fromSeq) ? options.fromSeq : 0
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 40000
  const rows = []
  const callNames = new Map()
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const seq = Number.isFinite(event.seq) ? event.seq : -1
    if (seq < fromSeq) continue
    if (event.type === 'turn/start') {
      if (rows.length > 0) rows.push({ seq, kind: 'turn', text: '' })
      continue
    }
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      const value = extractMessageText(event.data).trim()
      if (value.length > 0) {
        rows.push({
          seq,
          kind: event.type === 'user/message' ? 'user' : 'assistant',
          text: `${event.type === 'user/message' ? '用户' : '助手'}：${value}`
        })
      }
      continue
    }
    if (event.type === 'tool/call') {
      const name = typeof event.data?.name === 'string' ? event.data.name : ''
      const callId = typeof event.data?.callId === 'string' ? event.data.callId : ''
      if (callId.length > 0 && name.length > 0) callNames.set(callId, name)
      const line = formatToolCall(event.data).trim()
      if (line.length > 0) rows.push({ seq, kind: 'tool_call', toolName: name, args: event.data?.arguments, text: `[工具] ${line}` })
      continue
    }
    if (event.type === 'tool/result') {
      const callId = typeof event.data?.toolCallId === 'string'
        ? event.data.toolCallId
        : typeof event.data?.message?.toolCallId === 'string' ? event.data.message.toolCallId : ''
      const name = typeof event.data?.name === 'string' && event.data.name.length > 0
        ? event.data.name
        : callNames.get(callId) ?? ''
      const line = formatToolResult(event.data).trim()
      if (line.length > 0) rows.push({ seq, kind: 'tool_result', toolName: name, text: `[结果] ${line}` })
    }
  }
  if (rows.length === 0) return { text: '', lines: [] }
  const kept = []
  let used = 0
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const cost = byteLength(rows[index].text) + 1
    if (kept.length > 0 && used + cost > maxBytes) break
    kept.unshift(rows[index])
    used += cost
  }
  let text = kept.map((row) => row.text).join('\n').trim()
  if (kept.length < rows.length) text = `[较早内容已省略]\n${text}`
  return { text, lines: kept.filter((row) => row.kind !== 'turn') }
}

/** 把一段事件压成有界的对话文本：保留最近的回合，超预算时从最早处丢弃。 */
export function buildBatchTranscript(events, options = {}) {
  return buildTranscriptLines(events, options).text
}

/** curator 的系统提示词。只允许 add/update/merge/no-op，禁止 delete。 */
export const CURATOR_SYSTEM_PROMPT = [
  '你是私人工作区的长期记忆整理器。你的任务是从最近一段对话中，提炼出少量真正值得长期保留的信息。',
  '',
  '## 值得保存',
  '- 用户长期稳定的偏好、习惯、重要个人信息（必须来自用户的明确陈述）',
  '- 用户与助手之间真实发生、且能在本段对话中找到依据的共同经历',
  '- 真实会话中确实完成的任务、约定、重要事件',
  '- 已完成项目的重要成果、决策、经验与教训',
  '',
  '## 不要保存',
  '- 寒暄、普通闲聊、一次性细节、重复事实',
  '- 完整对话、逐轮摘要、工具原始输出',
  '- 推测、猜测或无法确认的信息；不确定时宁可不写，绝不把推测写成确定事实',
  '- 任何人设、行为规则、语气要求或指令；不要复制 AGENTS.local.md 的内容',
  '- API Key、Token、密码、私钥或任何凭据',
  '',
  '## 来源约束（必须遵守）',
  '1. 用户的明确陈述可以作为个人事实的来源；只保存用户真的说过的内容。',
  '2. 真实会话中实际执行并完成的任务，可以作为共同经历；必须有对应的用户请求和工具执行。',
  '3. 本地文件、目录列表、文件时间、作者字段、模型读取到的资料，只是「文件事实」，不能证明用户和助手一起做过什么。',
  '4. 不要仅凭文件名、创建/下载/修改时间、作者字段或你自己的推测，编造用户和助手共同整理、制作、查看或完成过某事。',
  '5. 缺少可靠来源的个人经历或共同经历，默认不写入；宁可输出空操作。',
  '6. 不确定的内容不要写成确定事实；不要用「已确认」「一定」等措辞包装猜测。',
  '',
  '## 写入规则',
  '- 每条只写一个事实，简洁、可复用，使用对话中的语言',
  '- 已有条目足够时优先 update；同一事实的多个旧条目优先 merge；避免重复新增',
  '- 新增最多 {maxAdds} 条，总操作最多 {maxOps} 条',
  '- 只允许 add / update / merge；禁止 delete',
  '- 没有值得保存的内容时，输出 {"operations":[]}',
  '',
  '## 输出格式',
  '只输出一个 JSON 对象，不要解释、不要 Markdown 代码围栏：',
  '{"operations":[{"op":"add","content":"一句话事实","tags":["preference"],"importance":2,"evidence":"下方对话中逐字出现的一句原文"}]}',
  '可用操作：',
  '{"op":"add","content":"...","tags":["..."],"importance":0-3,"evidence":"原文"}',
  '{"op":"update","id":"mem-xxxxxxxx","content":"...","tags":["..."],"importance":0-3,"evidence":"原文"}',
  '{"op":"merge","ids":["mem-a","mem-b"],"keepId":"mem-a","content":"...","tags":["..."]}',
  'add 必须带 evidence，且 evidence 必须是下方「最近对话」里逐字出现的一句；找不到原文就不要输出该条。',
  'update/merge 只能使用下方列出的已有 id。'
].join('\n')

/** 组装一次 curator 的 user 输入。 */
export function buildCuratorInput({ summary, entries, transcript, maxBytes = 40000 } = {}) {
  const shown = Array.isArray(entries) ? entries : []
  const entryLines = shown.map((entry) => {
    const tags = Array.isArray(entry.tags) && entry.tags.length > 0 ? ` tags=${entry.tags.join(',')}` : ''
    const importance = Number.isFinite(entry.importance) ? ` importance=${entry.importance}` : ''
    return `[${entry.id}]${tags}${importance} ${String(entry.content ?? '').replace(/\s+/g, ' ').trim()}`
  })
  const parts = [
    '## 当前长期记忆摘要',
    String(summary ?? '').trim() || '(空)',
    '',
    '## 已有记忆条目（仅这些 id 可用于 update/merge）',
    entryLines.length > 0 ? entryLines.join('\n') : '(无)',
    '',
    '## 最近对话',
    String(transcript ?? '').trim() || '(无)'
  ]
  let text = parts.join('\n')
  if (byteLength(text) > maxBytes) {
    // 摘要和条目优先，对话在 buildBatchTranscript 已经按预算裁过；
    // 这里兜底截断，保留头部结构。
    const ratio = Math.max(0.2, maxBytes / byteLength(text))
    text = text.slice(0, Math.max(1024, Math.floor(text.length * ratio)))
    text += '\n\n[输入已按预算截断]'
  }
  return text
}

/** 从模型输出里提取第一个完整 JSON 对象。 */
export function extractJsonObject(text) {
  const source = String(text ?? '').replace(/```(?:json)?/gi, '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(source.slice(start, end + 1))
  } catch {
    return null
  }
}

function normalizedTags(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .slice(0, 8)
}

function normalizedImportance(value) {
  return Number.isFinite(value) ? Math.min(3, Math.max(0, Math.trunc(value))) : 1
}

function secretTypes(content, detectSecretsFn) {
  const found = detectSecretsFn(content)
  return Array.isArray(found) ? found : []
}

function normalizedEvidence(value) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return undefined
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

/**
 * 校验并规范化 curator 的操作。
 * 任何 delete、越界、未知 id、凭据内容都会拒绝整批，避免半可信写入。
 */
export function validateCuratorOperations(operations, options = {}) {
  const maxOps = Number.isFinite(options.maxOps) ? options.maxOps : 8
  const maxAdds = Number.isFinite(options.maxAdds) ? options.maxAdds : 3
  const knownIds = options.knownIds instanceof Set ? options.knownIds : new Set(options.knownIds ?? [])
  const detectSecretsFn = typeof options.detectSecretsFn === 'function' ? options.detectSecretsFn : detectSecrets
  if (!Array.isArray(operations)) return { ok: false, error: 'operations 不是数组' }
  if (operations.length > maxOps) return { ok: false, error: `操作数 ${operations.length} 超过上限 ${maxOps}` }
  const normalized = []
  let adds = 0
  for (const raw of operations) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '操作不是对象' }
    const op = String(raw.op ?? '').trim().toLowerCase()
    if (op === 'delete') return { ok: false, error: 'curator 不允许 delete' }
    if (op === 'noop' || op === 'none') continue
    if (op === 'add') {
      const content = String(raw.content ?? '').trim()
      if (content.length === 0 || content.length > 500) return { ok: false, error: 'add content 长度无效' }
      const secrets = secretTypes(content, detectSecretsFn)
      if (secrets.length > 0) return { ok: false, error: `add 含疑似凭据: ${secrets.map((item) => item.type).join(',')}` }
      adds += 1
      if (adds > maxAdds) return { ok: false, error: `新增数 ${adds} 超过上限 ${maxAdds}` }
      const evidence = normalizedEvidence(raw.evidence)
      normalized.push({ op: 'add', content, tags: normalizedTags(raw.tags), importance: normalizedImportance(raw.importance), ...(evidence !== undefined ? { evidence } : {}) })
      continue
    }
    if (op === 'update') {
      const id = String(raw.id ?? '').trim()
      if (!knownIds.has(id)) return { ok: false, error: `update 引用了未知 id: ${id}` }
      const content = raw.content === undefined ? undefined : String(raw.content).trim()
      if (content !== undefined && (content.length === 0 || content.length > 500)) return { ok: false, error: 'update content 长度无效' }
      if (content !== undefined) {
        const secrets = secretTypes(content, detectSecretsFn)
        if (secrets.length > 0) return { ok: false, error: `update 含疑似凭据: ${secrets.map((item) => item.type).join(',')}` }
      }
      const tags = raw.tags === undefined ? undefined : normalizedTags(raw.tags)
      const importance = raw.importance === undefined ? undefined : normalizedImportance(raw.importance)
      if (content === undefined && tags === undefined && importance === undefined) return { ok: false, error: `update ${id} 没有可更新字段` }
      const evidence = normalizedEvidence(raw.evidence)
      normalized.push({ op: 'update', id, ...(content !== undefined ? { content } : {}), ...(tags !== undefined ? { tags } : {}), ...(importance !== undefined ? { importance } : {}), ...(evidence !== undefined ? { evidence } : {}) })
      continue
    }
    if (op === 'merge') {
      const ids = Array.isArray(raw.ids) ? [...new Set(raw.ids.map((id) => String(id).trim()).filter(Boolean))] : []
      if (ids.length < 2 || ids.length > 8) return { ok: false, error: 'merge ids 数量无效' }
      const missing = ids.filter((id) => !knownIds.has(id))
      if (missing.length > 0) return { ok: false, error: `merge 引用了未知 id: ${missing.join(',')}` }
      const keepId = String(raw.keepId ?? '').trim()
      if (!ids.includes(keepId)) return { ok: false, error: 'merge keepId 必须在 ids 中' }
      const content = raw.content === undefined ? undefined : String(raw.content).trim()
      if (content !== undefined && (content.length === 0 || content.length > 500)) return { ok: false, error: 'merge content 长度无效' }
      if (content !== undefined) {
        const secrets = secretTypes(content, detectSecretsFn)
        if (secrets.length > 0) return { ok: false, error: `merge 含疑似凭据: ${secrets.map((item) => item.type).join(',')}` }
      }
      const tags = raw.tags === undefined ? undefined : normalizedTags(raw.tags)
      normalized.push({ op: 'merge', ids, keepId, ...(content !== undefined ? { content } : {}), ...(tags !== undefined ? { tags } : {}) })
      continue
    }
    return { ok: false, error: `未知操作: ${op}` }
  }
  return { ok: true, operations: normalized }
}
/** Maximum sessions one workspace curation task may take from the queue. */
export const DEFAULT_WORKSPACE_MAX_SESSIONS = 8

/** Maximum 8-session batches (including the first) one task will chain. */
export const DEFAULT_WORKSPACE_MAX_BATCHES = 8

/**
 * The threshold is a workspace total, not a per-session counter. Only sessions
 * this plugin registered as private root sessions contribute, and
 * `lifetimeTurns` is deliberately not consulted.
 */
export function workspacePendingTotal(state) {
  if (state === null || typeof state !== 'object') return 0
  const owned = state.owned !== null && typeof state.owned === 'object' ? state.owned : {}
  const sessions = state.sessions !== null && typeof state.sessions === 'object' ? state.sessions : {}
  let total = 0
  for (const [sessionId, record] of Object.entries(sessions)) {
    if (owned[sessionId] === undefined) continue
    const pending = Number.isFinite(record?.pendingTurns) ? Math.max(0, Math.trunc(record.pendingTurns)) : 0
    total += pending
  }
  return total
}

/**
 * Select the pending owned sessions for one workspace task. Oldest activity
 * first, so a busy session cannot starve another one forever. The selected and
 * deferred lists are explicit; nothing is silently dropped.
 */
export function workspacePendingSessions(state, options = {}) {
  const owned = state?.owned !== null && typeof state.owned === 'object' ? state.owned : {}
  const sessions = state?.sessions !== null && typeof state.sessions === 'object' ? state.sessions : {}
  const exclude = options.exclude instanceof Set
    ? options.exclude
    : new Set(Array.isArray(options.exclude) ? options.exclude : [])
  const include = options.include instanceof Set
    ? options.include
    : Array.isArray(options.include)
      ? new Set(options.include)
      : null
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.trunc(options.limit))
    : DEFAULT_WORKSPACE_MAX_SESSIONS
  const eligible = Object.entries(sessions)
    .filter(([sessionId, record]) => owned[sessionId] !== undefined && !exclude.has(sessionId) && (include === null || include.has(sessionId)))
    .filter(([, record]) => Number.isFinite(record?.pendingTurns) && record.pendingTurns > 0)
    .map(([sessionId, record]) => ({
      sessionId,
      pendingTurns: Math.max(0, Math.trunc(record.pendingTurns)),
      lastTurnAt: Number.isFinite(record.lastTurnAt) ? record.lastTurnAt : 0
    }))
    .sort((left, right) => left.lastTurnAt - right.lastTurnAt || left.sessionId.localeCompare(right.sessionId))
  const selected = eligible.slice(0, limit)
  const deferred = eligible.slice(limit).map((item) => item.sessionId)
  return {
    total: eligible.reduce((sum, item) => sum + item.pendingTurns, 0),
    selected,
    deferred,
    eligible
  }
}

/** The workspace threshold is reached by the sum, never by one session. */
export function workspaceTriggerDue(total, everyTurns) {
  const every = Number.isFinite(everyTurns) ? Math.max(1, Math.trunc(everyTurns)) : 20
  return Number.isFinite(total) && total >= every
}

/** A fresh (not resumed) private root session is the desktop-new trigger. */
export function isFreshPrivateRootSession(session, source, privateWorkspace) {
  if (source !== 'startup') return false
  if (!isPrivateSession(session, privateWorkspace)) return false
  const header = session?.header
  return header !== undefined && header.parentSession === undefined && header.origin !== 'subagent'
}

/** The WeChat `/new` event only carries a workspace path when available. */
export function isWeixinNewSessionForPrivate(payload, privateWorkspace) {
  if (payload === null || typeof payload !== 'object' || payload.channel !== 'weixin') return false
  if (typeof payload.workspace !== 'string' || payload.workspace.length === 0) return false
  return isPrivateWorkspace(payload.workspace, privateWorkspace)
}

