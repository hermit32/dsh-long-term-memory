// Lightweight provenance for memory entries.
//
// Provenance lives in a sidecar JSON file next to the Markdown store instead of
// changing the raw-memory format: older releases, the MCP server, and the
// existing memory_* tools keep reading `raw_memories.md` exactly as before, and
// entries written before this file existed simply have no record (the UI shows
// "来源未知" rather than inventing one).
//
// No module here imports a harness package, so the format and validation logic
// can be unit-tested with plain Node.js.

export const PROVENANCE_FILE = 'provenance.json'
export const PROVENANCE_VERSION = 1

/** Source classes shown in the console. `unknown` is never written by the curator. */
export const SOURCE_TYPES = Object.freeze([
  'user_statement',
  'session_task',
  'file_fact',
  'assistant_claim',
  'model_tool',
  'manual',
  'import',
  'unknown'
])

/** Human labels for source classes. */
export const SOURCE_LABELS = Object.freeze({
  user_statement: { zh: '用户明确陈述', en: 'User statement' },
  session_task: { zh: '真实会话任务', en: 'Completed session task' },
  file_fact: { zh: '文件/工具资料', en: 'File or tool fact' },
  assistant_claim: { zh: '助手说法（未核实）', en: 'Assistant claim (unverified)' },
  model_tool: { zh: '会话内模型写入', en: 'Written by the model in a session' },
  manual: { zh: '手动操作', en: 'Manual action' },
  import: { zh: '导入', en: 'Imported' },
  unknown: { zh: '来源未知', en: 'Source unknown' }
})

/** How the entry was recorded. */
export const RECORDED_BY_LABELS = Object.freeze({
  curator: { zh: '自动整理', en: 'Curator' },
  model_tool: { zh: '模型工具', en: 'Model tool' },
  manual: { zh: '手动新增', en: 'Manual add' },
  manual_edit: { zh: '手动编辑', en: 'Manual edit' },
  import: { zh: '导入', en: 'Import' },
  unknown: { zh: '未知', en: 'Unknown' }
})

const SOURCE_SET = new Set(SOURCE_TYPES)
const RECORDED_SET = new Set(Object.keys(RECORDED_BY_LABELS))
const MAX_EVIDENCE_CHARS = 500
const MAX_ID_CHARS = 128
const MAX_ENTRIES = 2000

function text(value, max) {
  const source = typeof value === 'string' ? value.trim() : ''
  if (source.length === 0) return ''
  return source.length > max ? `${source.slice(0, max)}…` : source
}

function counter(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
}

function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const sourceType = SOURCE_SET.has(raw.sourceType) ? raw.sourceType : 'unknown'
  const recordedBy = RECORDED_SET.has(raw.recordedBy) ? raw.recordedBy : 'unknown'
  const record = {
    sourceType,
    recordedBy,
    updatedAt: text(raw.updatedAt, 40),
    createdAt: text(raw.createdAt, 40),
    evidence: text(raw.evidence, MAX_EVIDENCE_CHARS)
  }
  const sessionId = text(raw.sourceSessionId, MAX_ID_CHARS)
  if (sessionId.length > 0) record.sourceSessionId = sessionId
  const start = counter(raw.sourceEventSeq)
  if (start !== undefined) record.sourceEventSeq = start
  const end = counter(raw.sourceEventEndSeq)
  if (end !== undefined) record.sourceEventEndSeq = end
  const runId = text(raw.curatorRunId, MAX_ID_CHARS)
  if (runId.length > 0) record.curatorRunId = runId
  const firstType = SOURCE_SET.has(raw.firstSourceType) ? raw.firstSourceType : undefined
  if (firstType !== undefined) record.firstSourceType = firstType
  const deletedAt = text(raw.deletedAt, 40)
  if (deletedAt.length > 0) record.deletedAt = deletedAt
  const mergedInto = text(raw.mergedInto, MAX_ID_CHARS)
  if (mergedInto.length > 0) record.mergedInto = mergedInto
  return record
}

/** An empty provenance document. */
export function emptyProvenance() {
  return { version: PROVENANCE_VERSION, entries: {} }
}

/**
 * Tolerate a missing, old, or corrupt sidecar without dropping usable records.
 * @param raw - parsed JSON (or anything).
 * @returns a normalized provenance document.
 */
export function normalizeProvenance(raw) {
  const state = emptyProvenance()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return state
  const entries = raw.entries
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return state
  let seen = 0
  for (const [id, record] of Object.entries(entries)) {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_CHARS) continue
    if (seen >= MAX_ENTRIES) break
    const normalized = normalizeEntry(record)
    if (normalized === undefined) continue
    state.entries[id] = normalized
    seen += 1
  }
  return state
}

/** Read one record without inventing missing fields. */
export function provenanceRecord(state, id) {
  const record = state !== null && typeof state === 'object' && state.entries !== null && typeof state.entries === 'object'
    ? state.entries[id]
    : undefined
  return record === undefined ? { sourceType: 'unknown', recordedBy: 'unknown', evidence: '', createdAt: '', updatedAt: '' } : record
}

/** Whether the record predates provenance support. */
export function provenanceIsUnknown(state, id) {
  return provenanceRecord(state, id).sourceType === 'unknown'
}

/**
 * Apply a patch to one entry, preserving creation facts unless explicitly
 * replaced. Returns the same document object (the caller owns persistence).
 * @param state - normalized provenance document.
 * @param id - memory entry id.
 * @param patch - fields to merge.
 * @returns the merged record.
 */
export function setProvenance(state, id, patch = {}) {
  if (state.entries === undefined) state.entries = {}
  const previous = state.entries[id]
  const merged = normalizeEntry({
    ...previous,
    ...patch,
    createdAt: patch.createdAt !== undefined ? patch.createdAt : previous?.createdAt,
    firstSourceType: previous?.firstSourceType ?? patch.sourceType ?? previous?.sourceType
  })
  state.entries[id] = merged === undefined
    ? { sourceType: 'unknown', recordedBy: 'unknown', evidence: '', createdAt: '', updatedAt: '' }
    : merged
  return state.entries[id]
}

/** Mark an entry deleted without losing its provenance (used for restore). */
export function markProvenanceDeleted(state, id, at, extra = {}) {
  return setProvenance(state, id, { ...extra, deletedAt: at, updatedAt: at })
}

/** Mark an entry merged into another one. */
export function markProvenanceMerged(state, id, survivorId, at) {
  return setProvenance(state, id, { mergedInto: survivorId, deletedAt: at, updatedAt: at })
}

/** Remove a tombstone after a successful restore. */
export function clearProvenanceDeleted(state, id) {
  const record = state.entries[id]
  if (record === undefined) return record
  delete record.deletedAt
  delete record.mergedInto
  return record
}

/** Localized label for a source type. */
export function sourceLabel(sourceType, lang = 'zh') {
  const row = SOURCE_LABELS[sourceType] ?? SOURCE_LABELS.unknown
  return row[lang] ?? row.zh
}

/** Localized label for how an entry was recorded. */
export function recordedByLabel(recordedBy, lang = 'zh') {
  const row = RECORDED_BY_LABELS[recordedBy] ?? RECORDED_BY_LABELS.unknown
  return row[lang] ?? row.zh
}

/** A JSON-safe view for the console API. */
export function provenanceView(state, id) {
  const record = provenanceRecord(state, id)
  return {
    sourceType: record.sourceType,
    sourceTypeLabel: sourceLabel(record.sourceType),
    recordedBy: record.recordedBy,
    recordedByLabel: recordedByLabel(record.recordedBy),
    sourceSessionId: record.sourceSessionId ?? null,
    sourceEventSeq: record.sourceEventSeq ?? null,
    sourceEventEndSeq: record.sourceEventEndSeq ?? null,
    curatorRunId: record.curatorRunId ?? null,
    evidence: record.evidence ?? '',
    createdAt: record.createdAt ?? '',
    updatedAt: record.updatedAt ?? '',
    deletedAt: record.deletedAt ?? null,
    mergedInto: record.mergedInto ?? null
  }
}
