import test from 'node:test'
import assert from 'node:assert/strict'
import { removeSessionFromPendingState, sameSessionId } from '../lib/session-ledger.js'

function state() {
  return {
    version: 1,
    lifetimeTurns: 7,
    owned: {
      'session-a': { firstSeenAt: 1, lastSeenAt: 2, cwd: 'C:\\Workspaces\\private' },
      'session-b': { firstSeenAt: 3, lastSeenAt: 4, cwd: 'D:\\Workspaces\\lab' }
    },
    sessions: {
      'session-a': { pendingTurns: 3, cursorSeq: 10, countedSeq: 20, lastTurnAt: 5, lastCuratedAt: 0, lastAttemptAt: 0, attempts: 0, emptyChecks: 0 },
      'session-b': { pendingTurns: 1, cursorSeq: 0, countedSeq: 4, lastTurnAt: 6, lastCuratedAt: 0, lastAttemptAt: 0, attempts: 0, emptyChecks: 0 }
    }
  }
}

test('deleted session is removed from sessions and owned', () => {
  const pending = state()
  assert.equal(removeSessionFromPendingState(pending, 'session-a'), true)
  assert.equal(pending.sessions['session-a'], undefined)
  assert.equal(pending.owned['session-a'], undefined)
  assert.equal(pending.sessions['session-b'].pendingTurns, 1)
  assert.equal(pending.owned['session-b'].cwd, 'D:\\Workspaces\\lab')
  assert.equal(pending.lifetimeTurns, 7, 'cumulative turns are not rewritten by cleanup')
})

test('raw uuid and session- spelling refer to the same record', () => {
  assert.equal(sameSessionId('session-11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'), true)
  assert.equal(sameSessionId('session-a', 'session-b'), false)
  assert.equal(sameSessionId('', ''), false)
})

test('cleanup for an absent session is a no-op', () => {
  const pending = state()
  assert.equal(removeSessionFromPendingState(pending, 'session-missing'), false)
  assert.equal(Object.keys(pending.sessions).length, 2)
  assert.equal(Object.keys(pending.owned).length, 2)
})

test('malformed state is tolerated', () => {
  assert.equal(removeSessionFromPendingState(null, 'session-a'), false)
  assert.equal(removeSessionFromPendingState({}, 'session-a'), false)
  const pending = { sessions: null, owned: undefined }
  assert.equal(removeSessionFromPendingState(pending, 'session-a'), false)
})
