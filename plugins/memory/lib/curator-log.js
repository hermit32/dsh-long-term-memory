// Bounded curator run log.
//
// This is deliberately a small JSON document (last N runs), not a conversation
// archive: it records what a run changed and why it failed, never the prompt or
// the model output. The injection path and consolidation never read it, so a
// corrupt log can never affect memory.

export const CURATOR_LOG_FILE = 'curator-log.json'
export const CURATOR_LOG_VERSION = 1
export const DEFAULT_CURATOR_RUN_LIMIT = 100

const STATUS = new Set(['ok', 'empty', 'failed', 'skipped'])

function counter(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
}

function stamp(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function strings(value, limit = 32) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.length > 0).slice(0, limit)
    : []
}

function normalizeRun(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const run = {
    runId: typeof raw.runId === 'string' ? raw.runId.slice(0, 80) : '',
    startedAt: stamp(raw.startedAt),
    endedAt: stamp(raw.endedAt),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId.slice(0, 128) : '',
    trigger: typeof raw.trigger === 'string' ? raw.trigger.slice(0, 24) : 'threshold',
    status: STATUS.has(raw.status) ? raw.status : 'skipped',
    pendingTurns: counter(raw.pendingTurns),
    processedTurns: counter(raw.processedTurns),
    llmCalls: counter(raw.llmCalls),
    llmFailures: counter(raw.llmFailures),
    adds: counter(raw.adds),
    updates: counter(raw.updates),
    merges: counter(raw.merges),
    duplicates: counter(raw.duplicates),
    dropped: counter(raw.dropped),
    summaryVersionBefore: counter(raw.summaryVersionBefore),
    summaryVersionAfter: counter(raw.summaryVersionAfter),
    attempts: counter(raw.attempts)
  }
  const addedIds = strings(raw.addedIds)
  const updatedIds = strings(raw.updatedIds)
  const mergedIds = strings(raw.mergedIds)
  const sessionIds = strings(raw.sessionIds, 16)
  const deferredSessionIds = strings(raw.deferredSessionIds, 32)
  if (addedIds.length > 0) run.addedIds = addedIds
  if (updatedIds.length > 0) run.updatedIds = updatedIds
  if (mergedIds.length > 0) run.mergedIds = mergedIds
  if (sessionIds.length > 0) run.sessionIds = sessionIds
  if (deferredSessionIds.length > 0) run.deferredSessionIds = deferredSessionIds
  if (raw.workspace === true) run.workspace = true
  if (typeof raw.error === 'string' && raw.error.length > 0) run.error = raw.error.slice(0, 500)
  return run
}

/** Empty log. */
export function emptyCuratorLog() {
  return { version: CURATOR_LOG_VERSION, runs: [] }
}

/** Tolerate corrupt/old logs. */
export function normalizeCuratorLog(raw) {
  const log = emptyCuratorLog()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return log
  if (!Array.isArray(raw.runs)) return log
  for (const item of raw.runs.slice(0, DEFAULT_CURATOR_RUN_LIMIT)) {
    const run = normalizeRun(item)
    if (run !== undefined) log.runs.push(run)
  }
  return log
}

/** Prepend one run, newest first, capped. */
export function appendCuratorRun(log, run, limit = DEFAULT_CURATOR_RUN_LIMIT) {
  const target = normalizeCuratorLog(log)
  const normalized = normalizeRun(run)
  if (normalized !== undefined) target.runs.unshift(normalized)
  target.runs = target.runs.slice(0, Math.max(1, Math.trunc(limit)))
  return target
}

/** Aggregate counters for the status cards. */
export function summarizeCuratorLog(log) {
  const runs = Array.isArray(log?.runs) ? log.runs : []
  const totals = {
    runs: runs.length,
    ok: 0,
    empty: 0,
    failed: 0,
    skipped: 0,
    adds: 0,
    updates: 0,
    merges: 0,
    duplicates: 0,
    dropped: 0,
    llmCalls: 0,
    llmFailures: 0
  }
  for (const run of runs) {
    if (run.status === 'ok' || run.status === 'empty' || run.status === 'failed' || run.status === 'skipped') totals[run.status] += 1
    totals.adds += counter(run.adds)
    totals.updates += counter(run.updates)
    totals.merges += counter(run.merges)
    totals.duplicates += counter(run.duplicates)
    totals.dropped += counter(run.dropped)
    totals.llmCalls += counter(run.llmCalls)
    totals.llmFailures += counter(run.llmFailures)
  }
  return { totals, lastRun: runs[0] ?? null }
}
