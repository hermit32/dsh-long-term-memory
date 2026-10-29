import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, SUMMARY_FILE, summaryVersion } from '../lib/store.js'
import {
  CONSOLE_PARAMS,
  ConsoleError,
  MemoryConsoleService,
  RECOMMENDED_PARAMS,
  memoryEntryRevision
} from '../lib/console.js'

function fakeSettings(initial = {}) {
  const state = {
    value: { autoSummarize: true, curateEveryTurns: 20, curateMaxOps: 8, curateMaxAdds: 3, curateMaxBytes: 24000, maxBytes: 3000, injectTokens: 1200, maxActiveSummaries: 1, scopedMemory: true, privateWorkspace: 'C:\\Workspaces\\private', ...initial },
    base: { autoSummarize: true, curateEveryTurns: 20, curateMaxOps: 8, curateMaxAdds: 3, curateMaxBytes: 40000, maxBytes: 3000, injectTokens: 1200, maxActiveSummaries: 1 },
    user: {},
    revision: 3
  }
  const writes = []
  return {
    state,
    writes,
    writable: true,
    describe: () => [{ ns: 'dsh-memory-scoped', value: { ...state.value }, base: { ...state.base }, user: { ...state.user }, revision: state.revision }],
    async mutate(ns, ops, expected) {
      writes.push({ ns, ops, expected })
      if (expected !== undefined && expected !== state.revision) {
        const error = new Error('revision conflict')
        error.code = 'SETTINGS_CONFLICT'
        throw error
      }
      for (const op of ops) {
        const key = op.path[0]
        if (op.op === 'unset') {
          delete state.user[key]
          state.value[key] = state.base[key]
        } else {
          state.user[key] = op.value
          state.value[key] = op.value
        }
      }
      state.revision += 1
    }
  }
}

function makeFixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-console-'))
  const store = new MemoryStore(dir)
  const runtime = {
    key: 'ws-console',
    store,
    state: { version: 1, lastConsolidatedAt: 0, journalCursor: 0, rolloutConsumed: {} },
    consolidating: false
  }
  const pending = {
    version: 1,
    lifetimeTurns: 7,
    owned: { 'session-a': { firstSeenAt: 1, lastSeenAt: Date.now() } },
    sessions: {
      'session-a': { pendingTurns: 4, cursorSeq: 0, countedSeq: 20, lastTurnAt: Date.now(), lastCuratedAt: 0, lastAttemptAt: 0, attempts: 0, emptyChecks: 0 }
    }
  }
  const settings = fakeSettings(options.settings)
  const service = new MemoryConsoleService({
    store,
    runtime,
    resolved: {
      scopedMemory: true,
      privateWorkspace: 'C:\\Workspaces\\private',
      maxBytes: 3000,
      scopeMaxBytes: 1200,
      keepSummaryVersions: 5,
      curateEveryTurns: 20,
      orphanGraceMs: 300000,
      embeddingApiKey: '',
      readOnlyScopes: [],
      memoryDir: dir,
      ...options.resolved
    },
    scopeKey: 'ws-console',
    scopeLabel: '私人工作区（测试）',
    getPending: async () => pending,
    getCurator: () => ({ running: [], consolidating: false, llm: { calls: 2, failures: 0, ms: 120 } }),
    getLiveSessions: () => ['session-a'],
    requestConsolidation: () => {},
    settings,
    readDefaults: () => ({
      autoSummarize: true,
      curateEveryTurns: 20,
      curateMaxOps: 8,
      curateMaxAdds: 3,
      curateMaxBytes: 40000,
      maxBytes: 3000,
      injectTokens: 1200,
      maxActiveSummaries: 1
    }),
    readDiagnostics: options.readDiagnostics,
    now: () => Date.now()
  })
  return { dir, store, runtime, pending, settings, service }
}

async function seed(store, entries, summary) {
  await store.ensure()
  await store.writeAtomic(
    SUMMARY_FILE,
    `# DSH memory\n\nMaintained by the dsh-memory plugin. Use as guidance; more specific instructions take precedence. It does not override system, developer, or direct user instructions.\n\nv1\n\n${summary}\n`
  )
  for (const entry of entries) {
    const saved = await store.appendRawEntry(entry)
    await store.appendJournal({ op: 'add', id: saved.id, ts: saved.ts, entry: saved })
    entry.id = saved.id
    entry.ts = saved.ts
  }
}

test('console parameter defaults match the task baseline and keep 20 turns', () => {
  const byKey = new Map(CONSOLE_PARAMS.map((spec) => [spec.key, spec]))
  assert.equal(CONSOLE_PARAMS.length, 8)
  assert.equal(byKey.get('curateEveryTurns').default, 20)
  assert.equal(byKey.get('curateMaxOps').default, 8)
  assert.equal(byKey.get('curateMaxAdds').default, 3)
  assert.equal(byKey.get('curateMaxBytes').default, 40000)
  assert.equal(byKey.get('maxBytes').default, 3000)
  assert.equal(byKey.get('injectTokens').default, 1200)
  assert.equal(byKey.get('maxActiveSummaries').default, 1)
  assert.equal(RECOMMENDED_PARAMS.curateEveryTurns, 20)
  assert.equal(RECOMMENDED_PARAMS.curateMaxBytes, 40000)
  assert.ok(CONSOLE_PARAMS.every((spec) => spec.live === true))
})

test('console snapshot lists entries, unknown provenance, summary and curator state', async () => {
  const fixture = makeFixture()
  try {
    const first = { content: '用户偏好使用 PowerShell 脚本。', tags: ['preference'], importance: 2 }
    await seed(fixture.store, [first], '## 偏好\n\n- 用户偏好使用 PowerShell 脚本。')
    const provenance = await fixture.store.readProvenance()
    provenance.entries[first.id] = {
      sourceType: 'user_statement',
      recordedBy: 'curator',
      sourceSessionId: 'session-a',
      sourceEventSeq: 12,
      evidence: '用户：以后都用 PowerShell 吧',
      createdAt: first.ts,
      updatedAt: first.ts
    }
    await fixture.store.writeProvenance(provenance)

    const snapshot = await fixture.service.snapshot()
    assert.equal(snapshot.entries.length, 1)
    assert.equal(snapshot.entries[0].provenance.sourceType, 'user_statement')
    assert.equal(snapshot.entries[0].provenance.sourceSessionId, 'session-a')
    assert.match(snapshot.summary.text, /PowerShell/)
    assert.equal(snapshot.summary.version, 1)
    assert.equal(snapshot.curator.everyTurns, 20)
    assert.equal(snapshot.curator.lifetimeTurns, 7)
    assert.equal(snapshot.curator.nextIn, 16)
    assert.equal(snapshot.curator.sessions[0].live, true)
    assert.equal(snapshot.settings.namespace, 'dsh-memory-scoped')
    assert.equal(snapshot.settings.fields.find((field) => field.key === 'curateEveryTurns').value, 20)
    assert.equal(snapshot.locked.find((row) => row.key === 'privateWorkspace').value, 'C:\\Workspaces\\private')
    assert.equal(snapshot.locked.find((row) => row.key === 'embeddingApiKey').configured, false)
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('provenance is honestly unknown for old entries', async () => {
  const fixture = makeFixture()
  try {
    const entry = { content: '旧版本写入的记忆，没有来源记录。', tags: ['old'], importance: 1 }
    await seed(fixture.store, [entry], '## 旧记忆\n\n- 旧版本写入的记忆，没有来源记录。')
    const snapshot = await fixture.service.snapshot()
    assert.equal(snapshot.entries[0].provenance.sourceType, 'unknown')
    assert.equal(snapshot.entries[0].provenance.sourceTypeLabel, '来源未知')
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('delete requires confirmation, removes the summary bullet immediately, and can be restored', async () => {
  const fixture = makeFixture()
  try {
    const entry = { content: '用户偏好使用 PowerShell 脚本。', tags: ['preference'], importance: 2 }
    await seed(fixture.store, [entry], '## 偏好\n\n- 用户偏好使用 PowerShell 脚本。\n\n## Verification notes\n\n- (no active entries)')
    await assert.rejects(
      () => fixture.service.deleteEntry({ id: entry.id }),
      (error) => error instanceof ConsoleError && error.code === 'confirm-required'
    )
    const staleRevision = 'deadbeefdeadbeef'
    await assert.rejects(
      () => fixture.service.deleteEntry({ id: entry.id, confirm: true, expectedEntryRevision: staleRevision }),
      (error) => error.code === 'entry-conflict'
    )
    const result = await fixture.service.deleteEntry({
      id: entry.id,
      confirm: true,
      expectedEntryRevision: memoryEntryRevision(entry)
    })
    assert.equal(result.restorable, true)
    assert.equal(result.summary.changed, true)
    const raw = await fixture.store.readRawEntries()
    assert.equal(raw.length, 0)
    const summary = await fixture.store.readSummary()
    assert.doesNotMatch(summary, /PowerShell/)
    assert.equal(summaryVersion(summary), 2)

    const detail = await fixture.service.entry(entry.id)
    assert.equal(detail.entry, null)
    assert.ok(detail.history.some((row) => row.op === 'delete'))

    const restored = await fixture.service.restoreEntry({ id: entry.id })
    assert.equal(restored.entry.id, entry.id)
    const rawAfter = await fixture.store.readRawEntries()
    assert.equal(rawAfter.length, 1)
    const summaryAfter = await fixture.store.readSummary()
    assert.match(summaryAfter, /PowerShell/)
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('update rejects a stale revision, scrubs the old bullet, and writes a manual note', async () => {
  const fixture = makeFixture()
  try {
    const entry = { content: '用户偏好使用浅色主题。', tags: ['preference'], importance: 1 }
    await seed(fixture.store, [entry], '## 偏好\n\n- 用户偏好使用浅色主题。\n\n## Verification notes\n\n- (no active entries)')
    await assert.rejects(
      () => fixture.service.updateEntry({ id: entry.id, content: '用户偏好使用深色主题。', expectedEntryRevision: 'bad' }),
      (error) => error.code === 'entry-conflict'
    )
    const result = await fixture.service.updateEntry({
      id: entry.id,
      content: '用户偏好使用深色主题。',
      tags: ['preference'],
      importance: 2,
      expectedEntryRevision: memoryEntryRevision(entry)
    })
    assert.equal(result.entry.content, '用户偏好使用深色主题。')
    const summary = await fixture.store.readSummary()
    assert.doesNotMatch(summary, /浅色主题/)
    assert.match(summary, /深色主题/)
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('add rejects credentials and duplicates unless explicitly allowed', async () => {
  const fixture = makeFixture()
  try {
    await assert.rejects(
      () => fixture.service.addEntry({ content: 'key is sk-abcdefghijklmnopqrstuvwx' }),
      (error) => error.code === 'credential-rejected'
    )
    const first = await fixture.service.addEntry({ content: '用户的常用编辑器是 VS Code。', tags: ['preference'] })
    assert.equal(first.ok, true)
    await assert.rejects(
      () => fixture.service.addEntry({ content: '用户的常用编辑器是 VS Code。' }),
      (error) => error.code === 'duplicate-entry'
    )
    const second = await fixture.service.addEntry({ content: '用户的常用编辑器是 VS Code。', allowDuplicate: true })
    assert.equal(second.ok, true)
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('summary history can be listed and restored', async () => {
  const fixture = makeFixture()
  try {
    await seed(fixture.store, [], '## 偏好\n\n- 旧内容。')
    await fixture.store.archiveCurrentSummary(5)
    await fixture.store.writeAtomic(SUMMARY_FILE, '# DSH memory\n\nv2\n\n## 偏好\n\n- 新内容。\n')
    const snapshot = await fixture.service.snapshot()
    assert.ok(snapshot.summary.history.length >= 1)
    const version = snapshot.summary.history[0].version
    await assert.rejects(
      () => fixture.service.restoreSummary(version, false),
      (error) => error.code === 'confirm-required'
    )
    const restored = await fixture.service.restoreSummary(version, true)
    assert.equal(restored.restoredVersion, version)
    const text = await fixture.store.readSummary()
    assert.match(text, /旧内容/)
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('settings save uses a minimal user-layer patch and reports conflicts', async () => {
  const fixture = makeFixture({ settings: { curateMaxBytes: 24000 } })
  try {
    const before = await fixture.service.settingsView()
    const field = before.fields.find((row) => row.key === 'curateEveryTurns')
    assert.equal(field.value, 20)
    const saved = await fixture.service.saveSettings({
      set: { curateEveryTurns: 25 },
      expectedRevision: before.revision
    })
    assert.equal(saved.fields.find((row) => row.key === 'curateEveryTurns').value, 25)
    assert.equal(saved.fields.find((row) => row.key === 'curateEveryTurns').overridden, true)
    const write = fixture.settings.writes.at(-1)
    assert.equal(write.ops[0].op, 'set')
    assert.deepEqual(write.ops[0].path, ['curateEveryTurns'])
    await assert.rejects(
      () => fixture.service.saveSettings({ set: { curateEveryTurns: 30 }, expectedRevision: 0 }),
      (error) => error.code === 'settings-conflict'
    )
    await assert.rejects(
      () => fixture.service.saveSettings({ set: { privateWorkspace: 'D:\\evil' }, expectedRevision: 4 }),
      (error) => error.code === 'param-locked'
    )
    await assert.rejects(
      () => fixture.service.saveSettings({ set: { curateEveryTurns: 0 }, expectedRevision: 4 }),
      (error) => error.code === 'invalid-param'
    )
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('curator run log is bounded and summarized', async () => {
  const fixture = makeFixture()
  try {
    await fixture.service.recordRun({ runId: 'r1', startedAt: 1, endedAt: 2, status: 'ok', adds: 2, updates: 1, llmCalls: 1 })
    await fixture.service.recordRun({ runId: 'r2', startedAt: 3, endedAt: 4, status: 'empty', pendingTurns: 3 })
    const snapshot = await fixture.service.snapshot()
    assert.equal(snapshot.curator.runs.length, 2)
    assert.equal(snapshot.curator.totals.adds, 2)
    assert.equal(snapshot.curator.totals.empty, 1)
    assert.equal(snapshot.curator.lastRun.runId, 'r2')
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('legacy diagnostics are shown when no per-run log exists yet', async () => {
  const fixture = makeFixture({
    readDiagnostics: async () => ({
      curator: {
        calls: 1,
        applied: 3,
        lastAt: 1793187654683,
        lastSessionId: 'session-legacy',
        lastEmpty: false
      }
    })
  })
  try {
    const snapshot = await fixture.service.snapshot()
    assert.equal(snapshot.curator.runs.length, 1)
    assert.equal(snapshot.curator.runs[0].legacy, true)
    assert.equal(snapshot.curator.runs[0].adds, 3)
    assert.equal(snapshot.curator.llm.calls, 1)
    assert.equal(snapshot.curator.lastRun.sessionId, 'session-legacy')
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('console refuses to manage the global scope', async () => {
  const fixture = makeFixture({ resolved: { scopedMemory: false } })
  try {
    await assert.rejects(
      () => fixture.service.snapshot(),
      (error) => error.code === 'scope-disabled'
    )
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})
