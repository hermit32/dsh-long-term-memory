// Pending-ledger cleanup for deleted sessions.
//
// A deleted Session must disappear from `pending-turns.json` (both the
// per-session cursor and the `owned` ledger) without touching any other
// session's counters or any long-term memory entry. The function is pure so
// the destructive part of the cleanup can be tested without a Host.

/** Compare `session-<uuid>` and raw uuid spellings. */
export function sameSessionId(left, right) {
  const strip = (value) => {
    const text = String(value ?? '').trim()
    return text.startsWith('session-') ? text.slice('session-'.length) : text
  }
  const a = strip(left)
  const b = strip(right)
  return a.length > 0 && b.length > 0 && a === b
}

/**
 * Remove one session from a normalized pending state.
 * @param state - state from `normalizePendingState`.
 * @param sessionId - deleted session id (either spelling).
 * @returns whether anything changed.
 */
export function removeSessionFromPendingState(state, sessionId) {
  if (state === null || typeof state !== 'object') return false
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false
  let changed = false
  for (const key of Object.keys(state.sessions ?? {})) {
    if (!sameSessionId(key, sessionId)) continue
    delete state.sessions[key]
    changed = true
  }
  for (const key of Object.keys(state.owned ?? {})) {
    if (!sameSessionId(key, sessionId)) continue
    delete state.owned[key]
    changed = true
  }
  return changed
}
