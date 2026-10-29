// Acceptance tests for the published invariants.
//
// These use only the package's zero-dependency modules, so they run without a
// DSH Host. They are deliberately about the *published claims* in STATUS.md:
// workspace isolation, deleted-session cleanup, fail-closed auth, empty curator
// batches, and exact-match summary scrubbing.
//
// Run: node --test  (from the `tests/` directory)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isPrivateWorkspace,
  isPrivateSession,
  emptyPendingState,
  markSessionOwned,
  pendingRecord,
  shouldConsolidateAfterCuration,
  validateCuratorOperations
} from '../../plugins/memory/lib/scoped.js'
import {
  MemoryStore,
  scopeKeyForCwd,
  scopeFromSession
} from '../../plugins/memory/lib/store.js'
import { removeSessionFromPendingState } from '../../plugins/memory/lib/session-ledger.js'
import { memoryRequestRejection } from '../../plugins/memory/lib/auth.js'
import { scrubEntriesFromSummary } from '../../plugins/memory/lib/summary-scrub.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const PRIVATE = 'C:\\Workspaces\\private'
const WS_A = 'C:\\Workspaces\\work-a'
const WS_B = 'C:\\Workspaces\\work-b'

test('workspace A and B are not the private workspace', () => {
  assert.equal(isPrivateWorkspace(PRIVATE, PRIVATE), true)
  assert.equal(isPrivateWorkspace(WS_A, PRIVATE), false)
  assert.equal(isPrivateWorkspace(WS_B, PRIVATE), false)
  // a subdirectory of the private workspace is a *different* workspace
  assert.equal(isPrivateWorkspace(`${PRIVATE}\\Documents\\project`, PRIVATE), false)
  // a sibling whose name only shares a prefix must not match
  assert.equal(isPrivateWorkspace(`${PRIVATE}x`, PRIVATE), false)
  // empty configuration disables memory instead of matching everything
  assert.equal(isPrivateWorkspace(PRIVATE, ''), false)
})

test('session cwd matching folds case and separators', () => {
  assert.equal(isPrivateSession({ header: { cwd: 'c:/workspaces/PRIVATE/' } }, PRIVATE), true)
  assert.equal(isPrivateSession({ header: { cwd: WS_A } }, PRIVATE), false)
  assert.equal(isPrivateSession(undefined, PRIVATE), false)
})

// `scopeKeyForCwd` normalizes through the host path resolver. A Windows path
// string is only an absolute path on Windows; on POSIX it is a relative path in
// which the backslashes are ordinary characters, so the two spellings below
// legitimately hash differently. Keep the Windows-specific spellings in a
// Windows-only test and verify the portable contract with real host paths.
test('scope keys are per workspace and never collapse A into the private one (Windows paths)', {
  skip: process.platform === 'win32' ? false : 'Windows path semantics; on POSIX these strings are relative paths'
}, () => {
  const priv = scopeKeyForCwd(PRIVATE)
  const a = scopeKeyForCwd(WS_A)
  const b = scopeKeyForCwd(WS_B)
  assert.match(priv, /^ws-[0-9a-f]{16}$/)
  assert.notEqual(priv, a)
  assert.notEqual(priv, b)
  assert.notEqual(a, b)
  // same path, different spelling -> same scope (IM and desktop share memory)
  assert.equal(scopeKeyForCwd('c:/workspaces/private/'), priv)
  assert.equal(scopeFromSession({ header: { cwd: PRIVATE } }), priv)
  assert.equal(scopeFromSession({ header: {} }), 'global')
})

test('scope keys are stable for real absolute paths on this host', async () => {
  const a = await mkdtemp(join(tmpdir(), 'dsh-scope-a-'))
  const b = await mkdtemp(join(tmpdir(), 'dsh-scope-b-'))
  try {
    const keyA = scopeKeyForCwd(a)
    assert.match(keyA, /^ws-[0-9a-f]{16}$/)
    assert.notEqual(keyA, scopeKeyForCwd(b))
    // A trailing separator names the same directory and must fold to one key.
    assert.equal(scopeKeyForCwd(a + sep), keyA)
    assert.equal(scopeFromSession({ header: { cwd: a } }), keyA)
    assert.equal(scopeFromSession({ header: {} }), 'global')
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})

test('deleting a session clears pending state but keeps long-term entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-accept-memory-'))
  try {
    const store = new MemoryStore(dir)
    await store.restoreRawEntry({ id: 'mem-aaaa1111', content: '第一条长期记忆。', tags: ['test'], importance: 1 })
    await store.restoreRawEntry({ id: 'mem-bbbb2222', content: '第二条长期记忆。', tags: ['test'], importance: 2 })
    const before = await store.readRawEntries()
    assert.equal(before.length, 2)

    const state = emptyPendingState()
    markSessionOwned(state, 'session-deleted', { now: 1 })
    pendingRecord(state, 'session-deleted').pendingTurns = 7
    markSessionOwned(state, 'session-kept', { now: 2 })
    pendingRecord(state, 'session-kept').pendingTurns = 3

    const changed = removeSessionFromPendingState(state, 'session-deleted')
    assert.equal(changed, true)
    assert.equal(state.sessions['session-deleted'], undefined)
    assert.equal(state.owned['session-deleted'], undefined)
    assert.equal(state.sessions['session-kept'].pendingTurns, 3)
    assert.equal(state.owned['session-kept'] !== undefined, true)

    // The cleanup is ledger-only: every memory entry survives.
    const after = await store.readRawEntries()
    assert.deepEqual(after.map((entry) => entry.id), before.map((entry) => entry.id))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('memory management fails closed without a connection service', () => {
  const noService = memoryRequestRejection({ get: () => undefined }, { headers: {} })
  assert.equal(noService.status, 503)
  assert.equal(noService.code, 'auth-unavailable')

  const noMethod = memoryRequestRejection({ get: () => ({}) }, { headers: {} })
  assert.equal(noMethod.status, 503)

  const unauthenticated = memoryRequestRejection({ get: () => ({ requestRejection: () => 401 }) }, { headers: {} })
  assert.equal(unauthenticated.status, 401)

  const crossOrigin = memoryRequestRejection({ get: () => ({ requestRejection: () => 403 }) }, { headers: {} })
  assert.equal(crossOrigin.status, 403)

  const throwing = memoryRequestRejection({ get: () => ({ requestRejection: () => { throw new Error('boom') } }) }, { headers: {} })
  assert.equal(throwing.status, 403)

  const allowed = memoryRequestRejection({ get: () => ({ requestRejection: () => undefined }) }, { headers: {} })
  assert.equal(allowed, undefined)
})

test('an empty curator batch is a normal outcome', () => {
  assert.equal(shouldConsolidateAfterCuration([], []), false)
  assert.equal(shouldConsolidateAfterCuration([{ op: 'add' }], []), false)
  assert.equal(shouldConsolidateAfterCuration([{ op: 'add' }], [{ duplicate: true }]), false)
  assert.equal(shouldConsolidateAfterCuration([{ op: 'add' }], [{ duplicate: false }]), true)

  const validated = validateCuratorOperations([], { knownIds: new Set(), maxOps: 8, maxAdds: 3 })
  assert.equal(validated.ok, true)
  assert.deepEqual(validated.operations, [])
})

test('curator cannot delete and cannot smuggle credentials', () => {
  const deleteAttempt = validateCuratorOperations([{ op: 'delete', id: 'mem-10000000' }], { knownIds: new Set(['mem-10000000']) })
  assert.equal(deleteAttempt.ok, false)
  assert.match(deleteAttempt.error, /delete/)

  const secretAttempt = validateCuratorOperations(
    [{ op: 'add', content: 'API key sk-live-abcdef0123456789abcdef0123456789', evidence: 'x' }],
    { knownIds: new Set() }
  )
  assert.equal(secretAttempt.ok, false)
  assert.match(secretAttempt.error, /凭据|secret|credential/i)
})

test('editing one memory does not scrub a similar summary line', () => {
  const summary = '# DSH memory\n\nv3\n\n## 偏好\n\n- 主人喜欢蓝色。\n- 主人喜欢猫。\n'
  // Changing "猫" must only remove the "猫" bullet, never the "蓝色" one.
  const onlyCat = scrubEntriesFromSummary(summary, [{ id: 'mem-cat', content: '主人喜欢猫。' }])
  assert.equal(onlyCat.changed, true)
  assert.equal(onlyCat.removed.length, 1)
  assert.match(onlyCat.text, /喜欢蓝色/)
  assert.doesNotMatch(onlyCat.text, /喜欢猫/)

  // A paraphrase is not an exact match, so nothing is guessed away.
  const paraphrase = scrubEntriesFromSummary(summary, [{ id: 'mem-blue', content: '主人偏爱深蓝色。' }])
  assert.equal(paraphrase.changed, false)
  assert.match(paraphrase.text, /喜欢蓝色/)
  assert.match(paraphrase.text, /喜欢猫/)
})

test('structural guard: root-session gate and scoped routing stay in the source', async () => {
  const index = await readFile(join(ROOT, 'plugins/memory/lib/index.js'), 'utf8')
  // Root gate: subagents (inherited cwd) must stay excluded.
  assert.match(index, /header\.parentSession === undefined/)
  assert.match(index, /header\.origin !== 'subagent'/)
  // Every tool path re-checks the private root.
  assert.match(index, /assertPrivateExec/)
  // Only the workspace scope is accepted.
  assert.match(index, /requested !== 'workspace'/)
  // Non-private agents get the tools hidden.
  assert.match(index, /tools\.restrict\(\{ deny:/)
  // Deleted-session cleanup is event-driven.
  assert.match(index, /session-delete\/deleted/)

  const web = await readFile(join(ROOT, 'plugins/memory/lib/web.js'), 'utf8')
  const consoleWeb = await readFile(join(ROOT, 'plugins/memory/lib/console-web.js'), 'utf8')
  assert.match(web, /memoryRequestRejection\(ctx, req\)/)
  assert.match(consoleWeb, /memoryRequestRejection\(ctx, req\)/)
  // The removed insecure fallback must not come back.
  // The removed insecure fallback must not come back as code (the comments may
  // still explain why it was removed).
  assert.doesNotMatch(consoleWeb, /sec-fetch-site|settingsSameOriginPost|sameOriginHelper/i)
  assert.doesNotMatch(web, /settingsSameOriginPost|sec-fetch-site/i)
})
