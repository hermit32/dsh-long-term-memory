import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advancePendingAfterCuration,
  buildBatchTranscript,
  extractJsonObject,
  hasHumanExchange,
  isPrivateSession,
  isPrivateWorkspace,
  normalizePendingState,
  pendingRecord,
  prunePendingState,
  shouldConsolidateAfterCuration,
  shouldFlushOrphan,
  validateCuratorOperations
} from '../lib/scoped.js'

test('workspace isolation is exact, never prefix-based', () => {
  assert.equal(isPrivateWorkspace('C:\\Workspaces\\private', 'C:\\Workspaces\\private'), true)
  assert.equal(isPrivateWorkspace('C:/Workspaces/private/', 'C:\\Workspaces\\private'), true)
  assert.equal(isPrivateWorkspace('c:\\workspaces\\private', 'C:\\Workspaces\\private'), true)
  assert.equal(isPrivateWorkspace('C:\\Workspaces\\private\\Documents\\deepseek-harness\\default-workspace', 'C:\\Workspaces\\private'), false)
  assert.equal(isPrivateWorkspace('C:\\Workspaces\\privatex', 'C:\\Workspaces\\private'), false)
  assert.equal(isPrivateWorkspace('', 'C:\\Workspaces\\private'), false)
  assert.equal(isPrivateWorkspace('C:\\Workspaces\\private', ''), false)
})

test('session isolation reads session.header.cwd', () => {
  assert.equal(isPrivateSession({ header: { cwd: 'C:\\Workspaces\\private' } }, 'C:\\Workspaces\\private'), true)
  assert.equal(isPrivateSession({ header: { cwd: 'D:\\Workspaces\\lab' } }, 'C:\\Workspaces\\private'), false)
  assert.equal(isPrivateSession(undefined, 'C:\\Workspaces\\private'), false)
})

test('pending state normalizes old or corrupt files without dropping counters', () => {
  const state = normalizePendingState({
    sessions: {
      'session-a': { pendingTurns: 7, cursorSeq: 11, countedSeq: 20, lastTurnAt: 123, attempts: 2 },
      'session-b': { pendingTurns: -1, cursorSeq: 'x' },
      bad: null
    }
  })
  assert.equal(state.sessions['session-a'].pendingTurns, 7)
  assert.equal(state.sessions['session-a'].cursorSeq, 11)
  assert.equal(state.sessions['session-b'].pendingTurns, 0)
  assert.equal(state.sessions.bad, undefined)
  assert.deepEqual(normalizePendingState(null).sessions, {})
  assert.deepEqual(normalizePendingState({ sessions: [] }).sessions, {})
})

test('pruning never drops a session with pending turns', () => {
  const now = 10_000_000_000
  const state = normalizePendingState({
    sessions: {
      oldPending: { pendingTurns: 3, lastTurnAt: 1 },
      oldEmpty: { pendingTurns: 0, lastTurnAt: 1 },
      fresh: { pendingTurns: 0, lastTurnAt: now }
    }
  })
  prunePendingState(state, { now, maxAgeDays: 1 })
  assert.ok(state.sessions.oldPending, 'pending turns must survive pruning')
  assert.equal(state.sessions.oldEmpty, undefined)
  assert.ok(state.sessions.fresh)
})

test('a turn needs both a human message and an assistant reply', () => {
  const assistant = { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的' }] } }
  assert.equal(hasHumanExchange([
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
    assistant
  ]), true)
  assert.equal(hasHumanExchange([
    { type: 'user/message', data: { source: { kind: 'schedule' }, content: [{ type: 'text', text: '定时任务' }] } },
    assistant
  ]), false)
  assert.equal(hasHumanExchange([
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } }
  ]), false)
})

test('transcript keeps recent turns and includes tool activity', () => {
  const events = [
    { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '旧问题' }] } },
    { seq: 2, type: 'assistant/message', data: { content: [{ type: 'text', text: '旧回答' }] } },
    { seq: 3, type: 'turn/start', data: {} },
    { seq: 4, type: 'user/message', data: { content: [{ type: 'text', text: '新问题' }] } },
    { seq: 5, type: 'tool/call', data: { name: 'read', arguments: { file_path: 'C:\\x.txt' } } },
    { seq: 6, type: 'tool/result', data: { name: 'read', isError: false, content: [{ type: 'text', text: 'ok' }] } },
    { seq: 7, type: 'assistant/message', data: { content: [{ type: 'text', text: '新回答' }] } }
  ]
  const text = buildBatchTranscript(events, { fromSeq: 3, maxBytes: 4000 })
  assert.match(text, /新问题/)
  assert.match(text, /新回答/)
  assert.match(text, /\[工具\]/)
  assert.doesNotMatch(text, /旧问题/)
})

test('curator JSON extraction tolerates code fences', () => {
  assert.deepEqual(extractJsonObject('```json\n{"operations":[]}\n```'), { operations: [] })
  assert.equal(extractJsonObject('not json'), null)
})

test('curator validation allows add/update/merge/no-op and caps adds', () => {
  const knownIds = new Set(['mem-a', 'mem-b'])
  const base = { knownIds, maxOps: 8, maxAdds: 3, detectSecretsFn: () => [] }
  assert.deepEqual(validateCuratorOperations([], base), { ok: true, operations: [] })
  assert.equal(validateCuratorOperations([{ op: 'noop' }], base).operations.length, 0)
  assert.equal(validateCuratorOperations([
    { op: 'add', content: '用户喜欢简洁中文', tags: ['Preference'], importance: 2 }
  ], base).operations[0].tags[0], 'preference')
  assert.equal(validateCuratorOperations([
    { op: 'add', content: 'a' }, { op: 'add', content: 'b' }, { op: 'add', content: 'c' }, { op: 'add', content: 'd' }
  ], base).ok, false)
  assert.equal(validateCuratorOperations([{ op: 'update', id: 'mem-a', content: '新内容' }], base).ok, true)
  assert.equal(validateCuratorOperations([{ op: 'update', id: 'mem-zzz', content: '新内容' }], base).ok, false)
  assert.equal(validateCuratorOperations([{ op: 'merge', ids: ['mem-a', 'mem-b'], keepId: 'mem-a' }], base).ok, true)
  assert.equal(validateCuratorOperations([{ op: 'merge', ids: ['mem-a', 'mem-b'], keepId: 'mem-c' }], base).ok, false)
})

test('curator validation forbids delete and credentials', () => {
  const knownIds = new Set(['mem-a'])
  assert.equal(validateCuratorOperations([{ op: 'delete', id: 'mem-a' }], { knownIds }).ok, false)
  assert.equal(validateCuratorOperations([{ op: 'add', content: 'sk-123' }], {
    knownIds,
    detectSecretsFn: () => [{ type: 'api_key' }]
  }).ok, false)
})

test('empty curation never requests consolidation', () => {
  assert.equal(shouldConsolidateAfterCuration([], []), false)
  assert.equal(shouldConsolidateAfterCuration([], [{ op: 'add', id: 'mem-a' }]), false)
  assert.equal(shouldConsolidateAfterCuration([{ op: 'add' }], [{ op: 'add', duplicate: true }]), false)
  assert.equal(shouldConsolidateAfterCuration([{ op: 'add' }], [{ op: 'add', id: 'mem-a' }]), true)
})

test('pendingRecord creates a durable record with zero counters', () => {
  const state = normalizePendingState({})
  const record = pendingRecord(state, 'session-a', 123)
  assert.equal(record.pendingTurns, 0)
  assert.equal(record.cursorSeq, 0)
  assert.equal(record.lastTurnAt, 123)
  assert.equal(state.sessions['session-a'], record)
})

test('orphan flush never treats a live session as ended', () => {
  const now = 10_000_000_000
  const record = { pendingTurns: 5, lastTurnAt: now - 10 * 60 * 1000 }
  assert.equal(shouldFlushOrphan(record, { live: true, now, graceMs: 5 * 60 * 1000 }), false)
  assert.equal(shouldFlushOrphan(record, { live: false, now, graceMs: 5 * 60 * 1000 }), true)
  assert.equal(shouldFlushOrphan(record, { live: false, now, graceMs: 60 * 60 * 1000 }), false)
  assert.equal(shouldFlushOrphan({ ...record, pendingTurns: 0 }, { live: false, now, graceMs: 0 }), false)
})

test('empty curation resets the processed turns but keeps new arrivals', () => {
  const record = { pendingTurns: 20, cursorSeq: 10, countedSeq: 30, lastCuratedAt: 0, lastAttemptAt: 0, attempts: 2, emptyChecks: 0 }
  advancePendingAfterCuration(record, { lastSeq: 30, processedTurns: 20, empty: true, now: 1000 })
  assert.equal(record.pendingTurns, 0)
  assert.equal(record.cursorSeq, 30)
  assert.equal(record.emptyChecks, 1)
  assert.equal(record.attempts, 0)

  record.pendingTurns = 4
  record.countedSeq = 40
  advancePendingAfterCuration(record, { lastSeq: 36, processedTurns: 4, empty: true, now: 2000 })
  assert.equal(record.pendingTurns, 0)
  assert.equal(record.emptyChecks, 2)
})

test('curation in flight preserves turns that arrived after it started', () => {
  const record = { pendingTurns: 22, cursorSeq: 10, countedSeq: 30, lastCuratedAt: 0, lastAttemptAt: 0, attempts: 0, emptyChecks: 0 }
  advancePendingAfterCuration(record, { lastSeq: 30, processedTurns: 20, empty: false, now: 1000 })
  assert.equal(record.pendingTurns, 2)
  assert.equal(record.cursorSeq, 30)
})
