import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

const workspaces = [
  { id: 'ws-scoped', path: 'C:\\Workspaces\\private', sessionIds: ['session-f1', 'session-f2'] },
  { id: 'ws-default', path: 'C:\\Workspaces\\private\\Documents\\deepseek-harness\\default-workspace', sessionIds: ['session-d1', 'session-d2'] },
  { id: 'ws-lab', path: 'D:\\Workspaces\\lab', sessionIds: ['session-l1'] }
]

const headers = new Map([
  ['session-d1', { id: 'session-d1', cwd: 'C:\\Workspaces\\private\\Documents\\deepseek-harness\\default-workspace', title: 'default one' }],
  ['session-d2', { id: 'session-d2', cwd: 'C:\\Workspaces\\private\\Documents\\deepseek-harness\\default-workspace', title: 'default two' }],
  ['session-f1', { id: 'session-f1', cwd: 'C:\\Workspaces\\private', title: 'scoped one' }],
  ['session-f2', { id: 'session-f2', cwd: 'C:\\Workspaces\\private', title: 'scoped two' }],
  ['session-l1', { id: 'session-l1', cwd: 'D:\\Workspaces\\lab', title: 'lab one' }],
  ['session-sub', { id: 'session-sub', cwd: 'C:\\Workspaces\\private\\Documents\\deepseek-harness\\default-workspace', title: 'default sub', origin: 'subagent', parentSession: 'session-d1' }]
])

function fakeHost(callerId) {
  const registered = []
  const caller = headers.get(callerId)
  const ctx = {
    logger: { warn() {}, info() {} },
    inject() {},
    effect(fn) { if (typeof fn === 'function') return fn() },
    tools: { register(definition) { registered.push(definition); return () => {} } },
    get(name) {
      if (name === 'workspaceRegistry') return { list: () => workspaces }
      if (name === 'sessionQuery') return { listSessions: async () => [...headers.values()].map((header) => ({ header })) }
      if (name === 'sessions') return {
        list: () => [...headers.values()].map((header) => ({ id: header.id, header })),
        get: () => undefined
      }
      if (name === 'agents') return {
        currentInitiator: () => ({ id: callerId, session: { header: caller } }),
        get: () => undefined,
        list: () => []
      }
      return undefined
    }
  }
  apply(ctx, {})
  const tool = registered.find((definition) => definition.name === 'session_delete')
  return { tool, ctx }
}

test('discover is scoped to the caller workspace', async () => {
  const { tool } = fakeHost('session-d1')
  const out = await tool.execute({ discover: true }, { agent: { session: { header: headers.get('session-d1') } } })
  assert.match(out, /session-d1/)
  assert.match(out, /session-d2/)
  assert.doesNotMatch(out, /session-f1/)
  assert.doesNotMatch(out, /scoped one/)
  assert.doesNotMatch(out, /session-l1/)
})

test('a scoped caller sees only scoped sessions', async () => {
  const { tool } = fakeHost('session-f1')
  const out = await tool.execute({ discover: true }, { agent: { session: { header: headers.get('session-f1') } } })
  assert.match(out, /session-f1/)
  assert.match(out, /session-f2/)
  assert.doesNotMatch(out, /session-d1/)
  assert.doesNotMatch(out, /default one/)
  assert.doesNotMatch(out, /session-l1/)
})

test('cross-workspace delete is refused before any filesystem work', async () => {
  const { tool } = fakeHost('session-d1')
  const out = await tool.execute(
    { sessionId: 'session-f1' },
    { agent: { session: { header: headers.get('session-d1') } } }
  )
  assert.match(out, /refused:/)
  assert.match(out, /different workspace|no unambiguous workspace owner/)
})

test('an unresolved caller workspace refuses discover', async () => {
  const { tool } = fakeHost('session-d1')
  // Break ownership AND the exact-path fallback: no workspace claims d1 and no
  // workspace path matches its cwd.
  const originalPath = workspaces[1].path
  workspaces[1].sessionIds = []
  workspaces[1].path = 'C:\\different-workspace'
  try {
    const out = await tool.execute({ discover: true }, { agent: { session: { header: headers.get('session-d1') } } })
    assert.match(out, /refused: cannot confirm the current session workspace/)
  } finally {
    workspaces[1].sessionIds = ['session-d1', 'session-d2']
    workspaces[1].path = originalPath
  }
})

test('a subagent inherits only its root parent workspace', async () => {
  const { tool } = fakeHost('session-sub')
  const out = await tool.execute(
    { discover: true },
    { agent: { session: { header: headers.get('session-sub') } } }
  )
  assert.match(out, /session-d1/)
  assert.doesNotMatch(out, /session-f1/)
  assert.doesNotMatch(out, /session-l1/)
})

test('tree discovery refuses a foreign root', async () => {
  const { tool } = fakeHost('session-d1')
  const out = await tool.execute(
    { discoverTree: 'session-11111111-1111-4111-8111-111111111111' },
    { agent: { session: { header: headers.get('session-d1') } } }
  )
  assert.match(out, /refused:/)
})
