import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advancePendingAfterCuration,
  DEFAULT_WORKSPACE_MAX_SESSIONS,
  isFreshPrivateRootSession,
  isWeixinNewSessionForPrivate,
  workspacePendingSessions,
  workspacePendingTotal,
  workspaceTriggerDue
} from '../lib/scoped.js'
import { normalizeCuratorLog, appendCuratorRun } from '../lib/curator-log.js'
import { MemoryConsoleService } from '../lib/console.js'

const PRIVATE = 'C:\\Users\\example'

function state(sessions, owned = Object.keys(sessions)) {
  return {
    version: 1,
    lifetimeTurns: 9999,
    owned: Object.fromEntries(owned.map((id) => [id, { firstSeenAt: 1, lastSeenAt: 2 }])),
    sessions: Object.fromEntries(Object.entries(sessions).map(([id, pendingTurns], index) => [
      id,
      {
        pendingTurns,
        cursorSeq: 10 + index,
        countedSeq: 20 + index,
        lastTurnAt: 1000 + index,
        lastCuratedAt: 0,
        lastAttemptAt: 0,
        attempts: 0,
        emptyChecks: 0
      }
    ]))
  }
}

test('workspace total is the sum of owned session pending, not lifetimeTurns', () => {
  const pending = state({ a: 8, b: 6, c: 6 })
  assert.equal(workspacePendingTotal(pending), 20)
  assert.equal(workspaceTriggerDue(workspacePendingTotal(pending), 20), true)
  assert.equal(workspaceTriggerDue(12, 20), false)
  assert.equal(workspaceTriggerDue(19, 20), false)

  const withForeign = state({ a: 8, b: 6, c: 6, foreign: 100 }, ['a', 'b', 'c'])
  assert.equal(workspacePendingTotal(withForeign), 20)
  assert.equal(workspacePendingTotal({ ...pending, lifetimeTurns: 100000 }), 20)
})

test('cross-session examples A, B and C enter one selection', () => {
  const a = state({ A: 8, B: 6, C: 6 })
  const selected = workspacePendingSessions(a)
  assert.equal(selected.total, 20)
  assert.deepEqual(selected.selected.map((item) => item.sessionId), ['A', 'B', 'C'])
  assert.deepEqual(selected.deferred, [])

  const b = state({ A: 3, B: 4, C: 5 })
  assert.equal(workspacePendingSessions(b).total, 12)
  assert.equal(workspacePendingSessions(b).selected.length, 3)

  const c = state({ A: 3, B: 4, C: 6 })
  assert.equal(workspacePendingSessions(c).total, 13)
  assert.equal(workspacePendingSessions(c).selected.length, 3)
})

test('batch cap is explicit and never silently drops a session', () => {
  const pending = state({ a: 1, b: 2, c: 3, d: 4 })
  const selected = workspacePendingSessions(pending, { limit: 2 })
  assert.equal(selected.selected.length, 2)
  assert.deepEqual(selected.deferred, ['c', 'd'])
  assert.equal(selected.total, 10)

  const all = workspacePendingSessions(pending, { limit: DEFAULT_WORKSPACE_MAX_SESSIONS })
  assert.equal(all.selected.length, 4)
  assert.deepEqual(all.deferred, [])

  const many = state(Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`s${index}`, 1])))
  const first = workspacePendingSessions(many)
  assert.equal(first.selected.length, 8)
  assert.equal(first.deferred.length, 9)
  const second = workspacePendingSessions({ ...many, owned: Object.fromEntries(first.deferred.map((id) => [id, many.owned[id]])) })
  assert.equal(second.selected.length, 8)
  assert.equal(second.deferred.length, 1)
  const third = workspacePendingSessions({ ...many, owned: Object.fromEntries(second.deferred.map((id) => [id, many.owned[id]])) })
  assert.equal(third.selected.length, 1)
  assert.equal(third.deferred.length, 0)
})

test('only fresh startup private roots are desktop-new triggers', () => {
  const root = { header: { cwd: PRIVATE } }
  const lab = { header: { cwd: 'C:\\Users\\example\\lab' } }
  const subagent = { header: { cwd: PRIVATE, parentSession: 'session-parent', origin: 'subagent' } }
  const childByOrigin = { header: { cwd: PRIVATE, origin: 'subagent' } }
  assert.equal(isFreshPrivateRootSession(root, 'startup', PRIVATE), true)
  assert.equal(isFreshPrivateRootSession(root, 'resume', PRIVATE), false)
  assert.equal(isFreshPrivateRootSession(root, undefined, PRIVATE), false)
  assert.equal(isFreshPrivateRootSession(lab, 'startup', PRIVATE), false)
  assert.equal(isFreshPrivateRootSession(subagent, 'startup', PRIVATE), false)
  assert.equal(isFreshPrivateRootSession(childByOrigin, 'startup', PRIVATE), false)
})

test('WeChat /new events are accepted only for the private workspace', () => {
  assert.equal(isWeixinNewSessionForPrivate({ channel: 'weixin', workspace: PRIVATE }, PRIVATE), true)
  assert.equal(isWeixinNewSessionForPrivate({ channel: 'weixin', workspace: 'C:\\Users\\example\\lab' }, PRIVATE), false)
  assert.equal(isWeixinNewSessionForPrivate({ channel: 'weixin', workspace: 'C:\\Users\\example\\Documents' }, PRIVATE), false)
  assert.equal(isWeixinNewSessionForPrivate({ channel: 'dingtalk', workspace: PRIVATE }, PRIVATE), false)
  assert.equal(isWeixinNewSessionForPrivate({ channel: 'weixin' }, PRIVATE), false)
})

test('workspace curator log keeps session ids and deferred ids', () => {
  const log = appendCuratorRun(
    { version: 1, runs: [] },
    {
      runId: 'cur-workspace-1',
      startedAt: 1,
      endedAt: 2,
      sessionId: 'session-a',
      sessionIds: ['session-a', 'session-b'],
      deferredSessionIds: ['session-c'],
      workspace: true,
      trigger: 'wechat-new',
      status: 'ok',
      pendingTurns: 20,
      processedTurns: 20,
      adds: 1
    }
  )
  const run = normalizeCuratorLog(log).runs[0]
  assert.deepEqual(run.sessionIds, ['session-a', 'session-b'])
  assert.deepEqual(run.deferredSessionIds, ['session-c'])
  assert.equal(run.workspace, true)
  assert.equal(run.trigger, 'wechat-new')
})

test('console countdown uses the workspace sum, not the nearest single session', () => {
  const service = Object.create(MemoryConsoleService.prototype)
  service.now = () => 1000
  service.getLiveSessions = () => []
  service.resolved = { curateEveryTurns: 20, orphanGraceMs: 300000 }
  service.getCurator = () => ({ running: [] })
  service.runtime = { state: { version: 7 } }
  const pending = state({ A: 8, B: 6, C: 6 })
  const status = service.curatorStatus(pending, { version: 1, runs: [] }, {})
  assert.equal(status.pendingTurns, 20)
  assert.equal(status.nextIn, 0)
  assert.equal(status.everyTurns, 20)
  assert.equal(status.lifetimeTurns, 9999)
})

test('a failed batch stays pending while a successful batch is not replayed', () => {
  const pending = state({ A: 8, B: 6 })
  // Simulate B succeeding: only B's cursor is advanced; A failed and keeps 8.
  advancePendingAfterCuration(pending.sessions.B, {
    lastSeq: pending.sessions.B.countedSeq,
    processedTurns: 6,
    empty: false,
    now: 5000
  })
  const next = workspacePendingSessions(pending)
  assert.equal(next.total, 8)
  assert.deepEqual(next.selected.map((item) => item.sessionId), ['A'])
  assert.equal(workspacePendingTotal(pending), 8)
})

test('a successful batch advances only the turns it processed and keeps new arrivals', () => {
  const record = {
    pendingTurns: 6,
    cursorSeq: 10,
    countedSeq: 12,
    lastTurnAt: 1000,
    lastCuratedAt: 0,
    lastAttemptAt: 0,
    attempts: 2,
    emptyChecks: 0
  }
  advancePendingAfterCuration(record, {
    lastSeq: 12,
    processedTurns: 6,
    empty: false,
    now: 2000
  })
  assert.equal(record.pendingTurns, 0)
  assert.equal(record.cursorSeq, 12)
  assert.equal(record.attempts, 0)

  const during = {
    pendingTurns: 9,
    cursorSeq: 10,
    countedSeq: 15,
    lastTurnAt: 1000,
    lastCuratedAt: 0,
    lastAttemptAt: 0,
    attempts: 0,
    emptyChecks: 0
  }
  advancePendingAfterCuration(during, {
    lastSeq: 15,
    processedTurns: 6,
    empty: false,
    now: 2000
  })
  assert.equal(during.pendingTurns, 3, 'turns arriving during the model call remain pending')
})

