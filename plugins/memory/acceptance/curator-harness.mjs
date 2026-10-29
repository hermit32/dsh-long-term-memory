#!/usr/bin/env node
/**
 * Isolated real-Curator acceptance harness. It uses temporary directories,
 * synthetic session events, and a deterministic LLM stream, and never reads
 * the real memory directory or calls an external model.
 *
 * Usage (from the plugin package; requires DSH peer packages on the module path):
 *   node acceptance/curator-harness.mjs all
 *   node acceptance/curator-harness.mjs abc
 *   node acceptance/curator-harness.mjs wechat
 *   node acceptance/curator-harness.mjs partial
 *   node acceptance/curator-harness.mjs deferred
 *   node acceptance/curator-harness.mjs fault
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { MemoryStore, scopeKeyForCwd } from '../lib/store.js'

const MODE = process.argv[2] ?? 'all'
const results = []
let current = null
let disposers = []
let originalWritePending = null

function makeFixture({ count = 3, pending = 1, seedRaw = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-integration-'))
  const workspace = path.join(base, 'workspace')
  const memoryDir = path.join(base, 'memory')
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(memoryDir, { recursive: true })
  const scopeKey = scopeKeyForCwd(workspace)
  const scopeDir = path.join(memoryDir, 'scopes', scopeKey)
  fs.mkdirSync(scopeDir, { recursive: true })
  const events = {}
  const sessions = []
  const state = { version: 1, lifetimeTurns: 0, owned: {}, sessions: {} }
  for (let i = 0; i < count; i += 1) {
    const id = `session-synthetic-${i}`
    const marker = `SYNTHETIC_${i}_FACT`
    sessions.push({ id, header: { id, cwd: workspace } })
    const list = []
    let seq = 1
    for (let j = 0; j < 3; j += 1) {
      list.push({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `${marker} 这是第 ${i} 个合成会话的验收事实 ${j}，用于临时记忆库。` }] } })
      seq += 1
      list.push({ type: 'assistant/message', seq, data: { content: [{ type: 'text', text: `收到 ${marker} 第 ${j} 条。` }] } })
      seq += 1
    }
    events[id] = list
    state.owned[id] = { firstSeenAt: 1, lastSeenAt: 2, cwd: workspace }
    state.sessions[id] = { pendingTurns: pending, cursorSeq: 0, countedSeq: list.length, lastTurnAt: Date.now() - (count - i) * 1000, lastCuratedAt: 0, lastAttemptAt: 0, attempts: 0, emptyChecks: 0 }
    state.lifetimeTurns += pending
  }
  const newSession = { id: 'session-synthetic-new', header: { id: 'session-synthetic-new', cwd: workspace } }
  sessions.push(newSession)
  fs.writeFileSync(path.join(scopeDir, 'pending-turns.json'), JSON.stringify(state, null, 2))
  if (seedRaw) {
    const store = new MemoryStore(scopeDir)
    // Seeding is synchronous enough for the fixture; the harness awaits the
    // actual curator later.
    fs.writeFileSync(path.join(scopeDir, 'raw_memories.md'), '# Raw memories\n\nEntries: 1\n\n### 2026-01-01 00:00\n**id:** mem-seeded\n**tags:** synthetic\n**importance:** 1\n\nSYNTHETIC_0_FACT\n')
  }
  return { base, workspace, memoryDir, scopeKey, scopeDir, events, sessions, newSession, markerCount: count }
}

function makeHarness(fixture, { failPendingWrite = false } = {}) {
  let llmCalls = 0
  const llm = {
    async *stream(options) {
      llmCalls += 1
      const body = JSON.stringify(options.messages ?? [])
      if (String(options.system ?? '').includes('Merge the existing memory summary')) {
        yield { type: 'text-delta', index: 0, text: '# DSH memory\n\nSynthetic acceptance summary.\n\nv1\n\n## Synthetic\n\n- fixture\n' }
        return
      }
      const markers = [...Array(fixture.markerCount).keys()].map((i) => `SYNTHETIC_${i}_FACT`)
      const marker = markers.map((value) => ({ value, at: body.lastIndexOf(value) })).sort((a, b) => b.at - a.at)[0]?.value ?? 'SYNTHETIC_0_FACT'
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ operations: [{ op: 'add', content: marker, tags: ['synthetic'], importance: 1, evidence: marker }] }) }
    }
  }
  const settings = { describe: () => [{ ns: 'dsh-memory', value: {}, base: {}, user: {}, revision: 0 }], writable: true, mutate: async () => {} }
  const sessionQuery = {
    observeSession: async (id) => ({ events: fixture.events[id] ?? [], dispose: () => {} }),
    listSessions: async () => fixture.sessions.map((s) => ({ header: s.header }))
  }
  const hook = { events: {} }
  disposers = []
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    get(name) {
      if (name === 'sessions') return { list: () => fixture.sessions }
      if (name === 'sessionQuery') return sessionQuery
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'systemPrompt') return { context: () => () => {} }
      if (name === 'webServer') return { register: () => () => {} }
      return undefined
    },
    inject(names, callback) {
      if (names.includes('settings')) this.settings = settings
      if (names.includes('tools')) this.tools = { register: () => () => {} }
      if (names.includes('skills')) this.skills = { register: () => () => {} }
      if (names.includes('webServer')) this.webServer = { register: () => () => {} }
      if (names.includes('llm')) this.llm = llm
      if (names.includes('sessionQuery')) this.sessionQuery = sessionQuery
      callback(this)
    },
    on(event, handler) { hook.events[event] = handler; return () => {} },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose }
  }
  if (failPendingWrite) {
    originalWritePending = MemoryStore.prototype.writePendingTurns
    let failed = false
    MemoryStore.prototype.writePendingTurns = async function (state) {
      // Fail only the post-raw cursor write (pending has already been advanced
      // to zero), not an earlier/retry save. This is the exact crash window.
      if (!failed && Object.values(state.sessions ?? {}).some((record) => record.pendingTurns === 0)) {
        failed = true
        throw new Error('synthetic pending cursor write interruption')
      }
      return originalWritePending.call(this, state)
    }
  }
  apply(ctx, {
    privateWorkspace: fixture.workspace, memoryDir: fixture.memoryDir, scopedMemory: true,
    seedFromAgentsMd: false, autoSummarize: true, summarizeProvider: 'synthetic', summarizeModel: 'synthetic',
    curateEveryTurns: 20, curateMaxOps: 8, curateMaxAdds: 3, curateMaxBytes: 24000, curateEntriesShown: 80,
    curateMaxTokens: 2000, flushOrphansOnStart: false, flushOrphansOnNewSession: false,
    consolidateEvery: 100, maxActiveSummaries: 1, redactSecrets: true
  })
  return { ctx, hook, llm, getCalls: () => llmCalls }
}

async function waitFor(check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
function raw(fixture) {
  const p = path.join(fixture.scopeDir, 'raw_memories.md')
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}
function pending(fixture) {
  return JSON.parse(fs.readFileSync(path.join(fixture.scopeDir, 'pending-turns.json'), 'utf8'))
}
function log(fixture) {
  const p = path.join(fixture.scopeDir, 'curator-log.json')
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}
async function cleanup() {
  if (originalWritePending !== null) {
    MemoryStore.prototype.writePendingTurns = originalWritePending
    originalWritePending = null
  }
  for (const dispose of disposers.reverse()) { try { await dispose() } catch { /* ignore */ } }
  disposers = []
  if (current !== null) {
    try { fs.rmSync(current.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* Windows may keep a lock briefly; the temp path is test-only */ }
  }
  current = null
}
async function run(name, fn) {
  current = makeFixture({ count: name === 'deferred' ? 17 : name === 'partial' || name === 'fault' ? 1 : 3, pending: name === 'deferred' ? 1 : name === 'partial' || name === 'fault' ? 6 : name === 'abc' ? 0 : 0, seedRaw: name === 'partial' || name === 'fault' })
  // For A/B/C we need the explicit 8/6/6 distribution instead of the count loop.
  if (name === 'abc' || name === 'wechat') {
    const p = pending(current)
    const ids = Object.keys(p.sessions)
    const values = [8, 6, 6]
    ids.forEach((id, index) => { p.sessions[id].pendingTurns = values[index]; p.lifetimeTurns += values[index] })
    fs.writeFileSync(path.join(current.scopeDir, 'pending-turns.json'), JSON.stringify(p, null, 2))
  }
  try {
    await fn(current)
    results.push({ name, ok: true, ...(current?.detail !== undefined ? { detail: current.detail } : {}) })
    console.log(`ok ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
    console.error(`FAIL ${name}: ${error.message}`)
    process.exitCode = 1
  } finally {
    await cleanup()
  }
}

async function abc(fixture) {
  const harness = makeHarness(fixture)
  if (MODE === 'wechat') {
    process.emit('dsh-im/new-session', { channel: 'weixin', workspace: 'C:\\Users\\example\\other', at: Date.now() })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(raw(fixture).includes('SYNTHETIC_'), false, 'foreign /new must not write')
    process.emit('dsh-im/new-session', { channel: 'weixin', workspace: fixture.workspace, at: Date.now() })
  } else {
    harness.hook.events['agent/created']({ agent: { session: fixture.newSession }, source: 'resume' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(raw(fixture).includes('SYNTHETIC_'), false, 'resume must not write')
    harness.hook.events['agent/created']({ agent: { session: fixture.newSession }, source: 'startup' })
  }
  assert.ok(await waitFor(() => ['SYNTHETIC_0_FACT', 'SYNTHETIC_1_FACT', 'SYNTHETIC_2_FACT'].every((m) => raw(fixture).includes(m)) && log(fixture) !== null), 'A/B/C curation did not finish')
  const p = pending(fixture)
  assert.equal(p.sessions['session-synthetic-0'].pendingTurns, 0)
  assert.equal(p.sessions['session-synthetic-1'].pendingTurns, 0)
  assert.equal(p.sessions['session-synthetic-2'].pendingTurns, 0)
  assert.equal(log(fixture).runs[0].status, 'ok')
  fixture.detail = { rawMarkers: ['SYNTHETIC_0_FACT', 'SYNTHETIC_1_FACT', 'SYNTHETIC_2_FACT'].filter((m) => raw(fixture).includes(m)), pending: Object.fromEntries(Object.entries(p.sessions).map(([id, record]) => [id, record.pendingTurns])), runStatus: log(fixture).runs[0].status }
}

async function partial(fixture) {
  const harness = makeHarness(fixture)
  harness.hook.events['agent/created']({ agent: { session: fixture.newSession }, source: 'startup' })
  assert.ok(await waitFor(() => pending(fixture).sessions['session-synthetic-0'].pendingTurns === 0), 'partial retry cursor not advanced')
  assert.equal((raw(fixture).match(/SYNTHETIC_0_FACT/g) ?? []).length, 1, 'partial retry duplicated the entry')
  fixture.detail = { rawCount: (raw(fixture).match(/SYNTHETIC_0_FACT/g) ?? []).length, pending: pending(fixture).sessions['session-synthetic-0'] }
}

async function deferred(fixture) {
  const harness = makeHarness(fixture)
  harness.hook.events['agent/created']({ agent: { session: fixture.newSession }, source: 'startup' })
  assert.ok(await waitFor(() => {
    const p = pending(fixture)
    return Object.values(p.sessions).every((record) => record.pendingTurns === 0) && (log(fixture)?.runs?.length ?? 0) >= 3
  }, 30000), '17-session queue did not drain')
  assert.equal((raw(fixture).match(/SYNTHETIC_\d+_FACT/g) ?? []).length, 17, 'expected 17 synthetic memories')
  assert.ok(log(fixture).runs.length >= 3, 'expected multiple batches')
  fixture.detail = { rawCount: (raw(fixture).match(/SYNTHETIC_\d+_FACT/g) ?? []).length, pending: Object.fromEntries(Object.entries(pending(fixture).sessions).map(([id, record]) => [id, record.pendingTurns])), runs: log(fixture).runs.length }
}

async function fault(fixture) {
  const harness = makeHarness(fixture, { failPendingWrite: true })
  harness.hook.events['agent/created']({ agent: { session: fixture.newSession }, source: 'startup' })
  assert.ok(await waitFor(() => log(fixture)?.runs?.some((run) => run.status === 'failed')), 'fault run did not fail')
  assert.equal((raw(fixture).match(/SYNTHETIC_0_FACT/g) ?? []).length, 1, 'raw write should have succeeded before cursor failure')
  let p = pending(fixture)
  assert.equal(p.sessions['session-synthetic-0'].pendingTurns, 6, 'failed cursor save must not advance pending')
  assert.equal(p.sessions['session-synthetic-0'].cursorSeq, 0, 'failed cursor save must not advance cursor')
  MemoryStore.prototype.writePendingTurns = originalWritePending
  originalWritePending = null
  harness.hook.events['agent/created']({ agent: { session: fixture.newSession }, source: 'startup' })
  assert.ok(await waitFor(() => pending(fixture).sessions['session-synthetic-0'].pendingTurns === 0), 'retry did not finish')
  assert.equal((raw(fixture).match(/SYNTHETIC_0_FACT/g) ?? []).length, 1, 'retry duplicated the already-written entry')
  assert.equal(pending(fixture).sessions['session-synthetic-0'].cursorSeq, 6, 'retry cursor')
  fixture.detail = { rawCount: (raw(fixture).match(/SYNTHETIC_0_FACT/g) ?? []).length, cursor: pending(fixture).sessions['session-synthetic-0'].cursorSeq, pendingTurns: pending(fixture).sessions['session-synthetic-0'].pendingTurns }
}

const modes = {
  abc: () => run('abc', abc),
  wechat: () => run('wechat', abc),
  partial: () => run('partial', partial),
  deferred: () => run('deferred', deferred),
  fault: () => run('fault', fault)
}
try {
  if (MODE === 'all') {
    for (const name of Object.keys(modes)) await modes[name]()
  } else if (modes[MODE] !== undefined) {
    await modes[MODE]()
  } else {
    throw new Error(`unknown mode: ${MODE}`)
  }
  if (process.exitCode === undefined && results.every((result) => result.ok)) {
    console.log(JSON.stringify({ ok: true, mode: MODE, results }, null, 2))
  }
} catch (error) {
  console.error(error.stack ?? String(error))
  process.exitCode = 1
}


