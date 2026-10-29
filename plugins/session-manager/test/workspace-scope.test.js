import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findUniqueWorkspaceByPath,
  findWorkspaceForSession,
  isSameWorkspace,
  normalizeWorkspacePath,
  rootHeaderOf,
  workspaceIdOf,
  workspaceOwners,
  workspaceSessionIds
} from '../src/workspace-scope.js'

const sameId = (left, right) => left === right || left === `session-${right}` || `session-${left}` === right

const workspaces = [
  { id: 'ws-scoped', path: 'C:\\Workspaces\\private', sessionIds: ['session-f1'] },
  { id: 'ws-default', path: 'C:\\Workspaces\\private\\Documents\\deepseek-harness\\default-workspace', sessionIds: ['session-d1'] },
  { id: 'ws-lab', path: 'D:\\Workspaces\\lab', sessionIds: ['session-l1'] }
]

test('workspace ids and session ids are read from entity and record shapes', () => {
  assert.equal(workspaceIdOf({ id: 'a' }), 'a')
  assert.equal(workspaceIdOf({ workspaceId: 'b' }), 'b')
  assert.deepEqual(workspaceSessionIds({ sessionIds: ['s1', 2] }), ['s1', '2'])
  assert.deepEqual(workspaceSessionIds({}), [])
})

test('session ownership is unique and exact', () => {
  assert.equal(findWorkspaceForSession(workspaces, 'session-d1').id, 'ws-default')
  assert.equal(findWorkspaceForSession(workspaces, 'd1', sameId).id, 'ws-default')
  assert.equal(findWorkspaceForSession(workspaces, 'session-f1').id, 'ws-scoped')
  assert.equal(findWorkspaceForSession(workspaces, 'session-unknown'), undefined)
})

test('ambiguous ownership is never guessed', () => {
  const ambiguous = [
    { id: 'a', path: 'C:\\a', sessionIds: ['session-x'] },
    { id: 'b', path: 'C:\\b', sessionIds: ['session-x'] }
  ]
  assert.equal(workspaceOwners(ambiguous, 'session-x').length, 2)
  assert.equal(findWorkspaceForSession(ambiguous, 'session-x'), undefined)
})

test('path matching is exact, never prefix-based', () => {
  assert.equal(normalizeWorkspacePath('C:/Workspaces/private/'), 'c:\\workspaces\\private')
  assert.equal(findUniqueWorkspaceByPath(workspaces, 'C:\\Workspaces\\private').id, 'ws-scoped')
  assert.equal(findUniqueWorkspaceByPath(workspaces, 'c:\\workspaces\\private\\documents\\deepseek-harness\\default-workspace').id, 'ws-default')
  assert.equal(findUniqueWorkspaceByPath(workspaces, 'C:\\Workspaces\\private\\Documents'), undefined)
  assert.equal(findUniqueWorkspaceByPath(workspaces, 'C:\\Workspaces\\private-other'), undefined)
})

test('same-workspace comparison requires non-empty ids', () => {
  assert.equal(isSameWorkspace({ id: 'a' }, { id: 'a' }), true)
  assert.equal(isSameWorkspace({ id: 'a' }, { id: 'b' }), false)
  assert.equal(isSameWorkspace({}, {}), false)
})

test('subagent parent walk resolves the owning root', async () => {
  const headers = new Map([
    ['session-root', { id: 'session-root', origin: undefined, parentSession: undefined }],
    ['session-child', { id: 'session-child', origin: 'subagent', parentSession: 'session-root' }],
    ['session-grand', { id: 'session-grand', origin: 'subagent', parentSession: 'session-child' }]
  ])
  const root = await rootHeaderOf(headers.get('session-grand'), async (id) => headers.get(id))
  assert.equal(root.id, 'session-root')
})

test('a missing parent or a cycle refuses resolution', async () => {
  const missing = await rootHeaderOf(
    { id: 'session-child', origin: 'subagent', parentSession: 'session-missing' },
    async () => undefined
  )
  assert.equal(missing, undefined)
  const cycle = new Map([
    ['session-a', { id: 'session-a', origin: 'subagent', parentSession: 'session-b' }],
    ['session-b', { id: 'session-b', origin: 'subagent', parentSession: 'session-a' }]
  ])
  assert.equal(await rootHeaderOf(cycle.get('session-a'), async (id) => cycle.get(id)), undefined)
})

test('a fork (parentSession without subagent origin) is its own root', async () => {
  const fork = { id: 'session-fork', origin: undefined, parentSession: 'session-source' }
  const root = await rootHeaderOf(fork, async () => ({ id: 'session-source' }))
  assert.equal(root.id, 'session-fork')
})
