import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore, JOURNAL_FILE, RAW_FILE, scopeKeyForCwd, scopedStoreDir } from '../lib/store.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// A credential-shaped value that detectSecrets classifies as an openai-key.
const SECRET = `sk-${'A1b2C3d4E5f6G7h8I9j0'}`
// A credential-shaped value that detectSecrets classifies as a github-token.
const GITHUB_SECRET = `ghp_${'a'.repeat(30)}`
// Same shape, distinct value, used to test the tags write path.
const TAG_GITHUB_SECRET = `ghp_${'c'.repeat(30)}`

async function readTextFile(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function readRawText(scopedDir) {
  return readTextFile(join(scopedDir, RAW_FILE))
}

async function readJournalText(scopedDir) {
  return readTextFile(join(scopedDir, JOURNAL_FILE))
}

function scopedDirFor(memoryDir, workspace) {
  return scopedStoreDir(memoryDir, scopeKeyForCwd(workspace))
}

async function makeDirs(t) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-mcp-security-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const memoryDir = join(base, 'memory')
  const workspace = join(base, 'workspace')
  const other = join(base, 'other')
  await mkdir(memoryDir, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(other, { recursive: true })
  return {
    base,
    memoryDir,
    workspace: await realpath(workspace),
    other: await realpath(other)
  }
}

async function startServer(t, { memoryDir, allowedRoots = '', allowGlobal = false }) {
  const child = spawn(process.execPath, [join(repoRoot, 'bin', 'dsh-memory-mcp.mjs')], {
    env: {
      ...process.env,
      DSH_MEMORY_DIR: memoryDir,
      DSH_MEMORY_ALLOWED_ROOTS: allowedRoots,
      DSH_MEMORY_ALLOW_GLOBAL: allowGlobal ? '1' : '',
      // Must be ignored: write-time credential rejection is not configurable.
      DSH_MEMORY_REDACT: '0'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const pending = new Map()
  let buffer = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.length === 0) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const waiter = pending.get(message.id)
      if (waiter !== undefined) {
        pending.delete(message.id)
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result)
      }
    }
  })
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
  return { child, rpc, getStderr: () => stderr }
}

async function tool(server, name, args) {
  const result = await server.rpc('tools/call', { name, arguments: args })
  const text = result.content[0].text
  if (result.isError === true) return { isError: true, text }
  return { isError: false, text, value: JSON.parse(text) }
}

test('MCP tool schemas do not expose an allowSecret switch', async (t) => {
  const { memoryDir } = await makeDirs(t)
  const server = await startServer(t, { memoryDir, allowGlobal: true })
  const list = await server.rpc('tools/list')
  assert.equal(list.tools.length, 9)
  for (const toolDef of list.tools) {
    const properties = (toolDef.inputSchema && toolDef.inputSchema.properties) || {}
    assert.equal(Object.prototype.hasOwnProperty.call(properties, 'allowSecret'), false, `${toolDef.name} still declares allowSecret`)
  }
})

test('memory_add rejects credential content and stores nothing', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', { content: `store this ${SECRET}`, scope: 'workspace', cwd: workspace })
  assert.equal(added.isError, true)
  assert.match(added.text, /credential/)
  assert.equal(added.text.includes(SECRET), false, 'error message must not echo the secret')
  const read = await tool(server, 'memory_read', { scope: 'workspace', cwd: workspace })
  assert.equal(read.value.rawCount, 0)
})

test('memory_add rejects the removed allowSecret argument even for benign content', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', {
    content: 'benign deployment note',
    allowSecret: true,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(added.isError, true)
  assert.match(added.text, /allowSecret is not supported/)
  const read = await tool(server, 'memory_read', { scope: 'workspace', cwd: workspace })
  assert.equal(read.value.rawCount, 0)
})

test('memory_update rejects credential content and keeps the previous entry', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', { content: 'alpha deployment note', scope: 'workspace', cwd: workspace })
  const updated = await tool(server, 'memory_update', {
    id: added.value.id,
    content: `token=${GITHUB_SECRET}`,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(updated.isError, true)
  assert.match(updated.text, /credential/)
  assert.equal(updated.text.includes(GITHUB_SECRET), false)
  const search = await tool(server, 'memory_search', { query: 'deployment', mode: 'all', scope: 'workspace', cwd: workspace })
  assert.equal(search.value.matches.length, 1)
  assert.equal(search.value.matches[0].content, 'alpha deployment note')
})

test('DSH_MEMORY_REDACT=0 cannot disable write-time credential rejection', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  // startServer always sets DSH_MEMORY_REDACT=0.
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', { content: `store ${GITHUB_SECRET}`, scope: 'workspace', cwd: workspace })
  assert.equal(added.isError, true)
  const read = await tool(server, 'memory_read', { scope: 'workspace', cwd: workspace })
  assert.equal(read.value.rawCount, 0)
})

test('global scope is denied unless explicitly enabled', async (t) => {
  const { memoryDir } = await makeDirs(t)
  const server = await startServer(t, { memoryDir })
  const added = await tool(server, 'memory_add', { content: 'global fact' })
  assert.equal(added.isError, true)
  assert.match(added.text, /global scope is disabled/)
  const stats = await tool(server, 'memory_stats', {})
  assert.equal(stats.isError, true)
})

test('workspace scope outside DSH_MEMORY_ALLOWED_ROOTS is denied', async (t) => {
  const { memoryDir, workspace, other } = await makeDirs(t)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', { content: 'outside fact', scope: 'workspace', cwd: other })
  assert.equal(added.isError, true)
  assert.match(added.text, /DSH_MEMORY_ALLOWED_ROOTS/)
})

test('unknown scope values are rejected instead of falling back to global', async (t) => {
  const { memoryDir } = await makeDirs(t)
  const server = await startServer(t, { memoryDir, allowGlobal: true })
  const added = await tool(server, 'memory_add', { content: 'sneaky fact', scope: 'everything' })
  assert.equal(added.isError, true)
  assert.match(added.text, /unknown scope/)
})

test('allowed workspace scope writes one stable scoped store, not the global root', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  await mkdir(join(workspace, 'nested'), { recursive: true })
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  // A subdirectory resolves to the configured root, so it cannot mint a new scope.
  const added = await tool(server, 'memory_add', {
    content: 'scoped fact alpha',
    scope: 'workspace',
    cwd: join(workspace, 'nested')
  })
  assert.equal(added.isError, false)
  assert.equal(added.value.scope, scopeKeyForCwd(workspace))
  const stats = await tool(server, 'memory_stats', { scope: 'workspace', cwd: workspace })
  assert.equal(stats.value.rawCount, 1)
  assert.equal(basename(stats.value.dir), scopeKeyForCwd(workspace))
  assert.notEqual(stats.value.dir, memoryDir)
})

test('memory_merge refuses to launder a credential stored before this policy', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedStoreDir(memoryDir, scopeKeyForCwd(workspace))
  const seed = new MemoryStore(scopedDir)
  const plain = await seed.appendRawEntry({ content: 'merge alpha note', tags: [], importance: 1 })
  const secret = await seed.appendRawEntry({ content: `deploy key ${GITHUB_SECRET}`, tags: [], importance: 1 })
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const merged = await tool(server, 'memory_merge', {
    ids: [plain.id, secret.id],
    keepId: plain.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(merged.isError, true)
  assert.match(merged.text, /credential/)
  const stats = await tool(server, 'memory_stats', { scope: 'workspace', cwd: workspace })
  assert.equal(stats.value.rawCount, 2)
})

test('memory_merge rejects duplicate ids instead of skipping the credential scan', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const plain = await seed.appendRawEntry({ content: 'merge alpha note', tags: [], importance: 1 })
  const secret = await seed.appendRawEntry({ content: `deploy key ${GITHUB_SECRET}`, tags: [], importance: 1 })
  const before = await readRawText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const duplicatedSecret = await tool(server, 'memory_merge', {
    ids: [plain.id, secret.id, secret.id],
    keepId: plain.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(duplicatedSecret.isError, true)
  assert.match(duplicatedSecret.text, /duplicate/i)
  assert.equal(duplicatedSecret.text.includes(GITHUB_SECRET), false)
  const duplicatedPlain = await tool(server, 'memory_merge', {
    ids: [plain.id, plain.id],
    keepId: plain.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(duplicatedPlain.isError, true)
  // The rejected calls must not touch raw_memories.md at all.
  assert.equal(await readRawText(scopedDir), before)
  const entries = await new MemoryStore(scopedDir).readRawEntries()
  assert.equal(entries.length, 2)
  assert.equal(entries.some((entry) => entry.id === secret.id), true)
  assert.equal(entries.some((entry) => entry.id === plain.id), true)
})

test('memory_add rejects credential tags and writes nothing to disk', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', {
    content: 'benign tag probe',
    tags: ['safe', TAG_GITHUB_SECRET],
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(added.isError, true)
  assert.match(added.text, /tag/i)
  assert.equal(added.text.includes(TAG_GITHUB_SECRET), false)
  assert.equal((await readRawText(scopedDir)).includes('benign tag probe'), false)
  assert.equal((await new MemoryStore(scopedDir).readRawEntries()).length, 0)
})

test('memory_update rejects credential tags and leaves the stored entry untouched', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', {
    content: 'alpha tag note',
    tags: ['alpha'],
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(added.isError, false)
  const before = await readRawText(scopedDir)
  const updated = await tool(server, 'memory_update', {
    id: added.value.id,
    tags: [TAG_GITHUB_SECRET],
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(updated.isError, true)
  assert.match(updated.text, /tag/i)
  assert.equal(await readRawText(scopedDir), before)
  const entry = (await new MemoryStore(scopedDir).readRawEntries()).find((item) => item.id === added.value.id)
  assert.deepEqual(entry.tags, ['alpha'])
})

test('memory_merge rejects credential tags in any target and writes nothing', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const first = await seed.appendRawEntry({ content: 'first merge note', tags: ['alpha'], importance: 1 })
  const second = await seed.appendRawEntry({ content: 'second merge note', tags: [TAG_GITHUB_SECRET], importance: 1 })
  const before = await readRawText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const merged = await tool(server, 'memory_merge', {
    ids: [first.id, second.id],
    keepId: first.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(merged.isError, true)
  assert.match(merged.text, /tag/i)
  assert.equal(merged.text.includes(TAG_GITHUB_SECRET), false)
  assert.equal(await readRawText(scopedDir), before)
  assert.equal((await new MemoryStore(scopedDir).readRawEntries()).length, 2)
})

test('memory_update refuses to preserve legacy credential content on an unrelated edit', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const tainted = await seed.appendRawEntry({ content: `legacy ${GITHUB_SECRET}`, tags: ['legacy'], importance: 1 })
  const before = await readRawText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const updated = await tool(server, 'memory_update', {
    id: tainted.id,
    importance: 2,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(updated.isError, true)
  assert.match(updated.text, /credential/i)
  assert.equal(await readRawText(scopedDir), before)
  const entry = (await new MemoryStore(scopedDir).readRawEntries()).find((item) => item.id === tainted.id)
  assert.equal(entry.importance, 1)
})

test('memory_merge verifies the final merged content and tag union on disk', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const short = await seed.appendRawEntry({ content: 'short', tags: ['alpha'], importance: 1 })
  const long = await seed.appendRawEntry({ content: 'a much longer benign note', tags: ['beta'], importance: 2 })
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const merged = await tool(server, 'memory_merge', {
    ids: [short.id, long.id],
    keepId: short.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(merged.isError, false)
  assert.equal(merged.value.content, 'a much longer benign note')
  assert.deepEqual(merged.value.tags, ['alpha', 'beta'])
  const entries = await new MemoryStore(scopedDir).readRawEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, short.id)
  assert.equal(entries[0].content, 'a much longer benign note')
  assert.deepEqual(entries[0].tags, ['alpha', 'beta'])
})

test('memory_merge follows storage order for equal-length content, not request order', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  // Storage order: keep (short) -> secret (34 normalized chars) -> clean (34).
  // The old MCP pre-check walked the request order, so asking clean-before-secret
  // selected the clean content while the store (storage order) selected secret.
  const keep = await seed.appendRawEntry({ content: 'keep', tags: [], importance: 1 })
  const secret = await seed.appendRawEntry({ content: GITHUB_SECRET, tags: [], importance: 1 })
  const clean = await seed.appendRawEntry({ content: 'd'.repeat(GITHUB_SECRET.length), tags: [], importance: 1 })
  assert.equal(GITHUB_SECRET.length, 'd'.repeat(GITHUB_SECRET.length).length)
  const beforeRaw = await readRawText(scopedDir)
  const beforeJournal = await readJournalText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  for (const ids of [
    [keep.id, clean.id, secret.id],
    [keep.id, secret.id, clean.id]
  ]) {
    const merged = await tool(server, 'memory_merge', { ids, keepId: keep.id, scope: 'workspace', cwd: workspace })
    assert.equal(merged.isError, true)
    assert.match(merged.text, /credential/i)
    assert.equal(merged.text.includes(GITHUB_SECRET), false)
  }
  assert.equal(await readRawText(scopedDir), beforeRaw)
  assert.equal(await readJournalText(scopedDir), beforeJournal)
  assert.equal((await new MemoryStore(scopedDir).readRawEntries()).length, 3)
})

test('memory_merge scans tags past the 16-tag cap regardless of request order', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const normalTags = Array.from({ length: 16 }, (_, index) => `normal-${index}`)
  // Storage order: keep -> secretTag -> normalTags. The union keeps the secret
  // tag because it is early in storage order; a request order that puts the
  // secret entry last used to slice it off during the pre-check.
  const keep = await seed.appendRawEntry({ content: 'keep', tags: [], importance: 1 })
  const secretTag = await seed.appendRawEntry({ content: 'secret tag entry', tags: [TAG_GITHUB_SECRET], importance: 1 })
  const normal = await seed.appendRawEntry({ content: 'normal tags entry', tags: normalTags, importance: 1 })
  const beforeRaw = await readRawText(scopedDir)
  const beforeJournal = await readJournalText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  for (const ids of [
    [keep.id, normal.id, secretTag.id],
    [keep.id, secretTag.id, normal.id]
  ]) {
    const merged = await tool(server, 'memory_merge', { ids, keepId: keep.id, scope: 'workspace', cwd: workspace })
    assert.equal(merged.isError, true)
    assert.match(merged.text, /tag/i)
    assert.equal(merged.text.includes(TAG_GITHUB_SECRET), false)
  }
  assert.equal(await readRawText(scopedDir), beforeRaw)
  assert.equal(await readJournalText(scopedDir), beforeJournal)
  assert.equal((await readJournalText(scopedDir)).includes(TAG_GITHUB_SECRET), false)
  assert.equal((await new MemoryStore(scopedDir).readRawEntries()).length, 3)
})

test('memory_merge rejects a credential in a participant that would lose the content tie', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const keep = await seed.appendRawEntry({ content: 'keep', tags: [], importance: 1 })
  const secret = await seed.appendRawEntry({ content: GITHUB_SECRET, tags: ['legacy'], importance: 1 })
  const longer = await seed.appendRawEntry({ content: 'c'.repeat(60), tags: [], importance: 1 })
  const beforeRaw = await readRawText(scopedDir)
  const beforeJournal = await readJournalText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const merged = await tool(server, 'memory_merge', {
    ids: [keep.id, longer.id, secret.id],
    keepId: keep.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(merged.isError, true)
  assert.match(merged.text, /credential/i)
  // The secret entry would have been removed, and its content copied into the
  // journal delete event; neither file may change.
  assert.equal(await readRawText(scopedDir), beforeRaw)
  assert.equal(await readJournalText(scopedDir), beforeJournal)
  assert.equal((await readJournalText(scopedDir)).includes(GITHUB_SECRET), false)
})

test('oversized tag errors never echo the tag and never reach stderr', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const longSecretTag = `${TAG_GITHUB_SECRET}${'d'.repeat(40)}`
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const added = await tool(server, 'memory_add', {
    content: 'safe entry',
    tags: ['safe'],
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(added.isError, false)
  const beforeRaw = await readRawText(scopedDir)
  const beforeJournal = await readJournalText(scopedDir)
  for (const result of [
    await tool(server, 'memory_update', {
      id: added.value.id,
      tags: [longSecretTag],
      scope: 'workspace',
      cwd: workspace
    }),
    await tool(server, 'memory_add', {
      content: 'another safe entry',
      tags: [longSecretTag],
      scope: 'workspace',
      cwd: workspace
    })
  ]) {
    assert.equal(result.isError, true)
    assert.match(result.text, /tag exceeds 48 characters/)
    assert.equal(result.text.includes(TAG_GITHUB_SECRET), false)
    assert.equal(result.text.includes('d'.repeat(40)), false)
  }
  assert.equal(await readRawText(scopedDir), beforeRaw)
  assert.equal(await readJournalText(scopedDir), beforeJournal)
  const stderr = server.getStderr()
  assert.equal(stderr.includes(TAG_GITHUB_SECRET), false)
  assert.equal(stderr.includes('d'.repeat(40)), false)
})

test('memory_delete never copies credential content into the journal', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const tainted = await seed.appendRawEntry({ content: `legacy ${GITHUB_SECRET}`, tags: ['legacy'], importance: 1 })
  const journalBefore = await readJournalText(scopedDir)
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const deleted = await tool(server, 'memory_delete', { id: tainted.id, scope: 'workspace', cwd: workspace })
  assert.equal(deleted.isError, false)
  assert.equal((await new MemoryStore(scopedDir).readRawEntries()).length, 0)
  const journal = await readJournalText(scopedDir)
  assert.equal(journal.includes(GITHUB_SECRET), false)
  assert.match(journal, /redacted: credential content removed on delete/)
  assert.notEqual(journal, journalBefore)
})

test('memory_merge persists the store plan tag order and 16-tag cap on disk', async (t) => {
  const { memoryDir, workspace } = await makeDirs(t)
  const scopedDir = scopedDirFor(memoryDir, workspace)
  const seed = new MemoryStore(scopedDir)
  const keep = await seed.appendRawEntry({ content: 'k', tags: ['k'], importance: 1 })
  const a = await seed.appendRawEntry({
    content: 'aa',
    tags: Array.from({ length: 10 }, (_, index) => `a${index}`),
    importance: 1
  })
  const b = await seed.appendRawEntry({
    content: 'bbb',
    tags: Array.from({ length: 10 }, (_, index) => `b${index}`),
    importance: 2
  })
  // Request order is deliberately different from storage order: the persisted
  // plan must follow storage order: k, a0..a9, b0..b5.
  const expectedTags = ['k', ...Array.from({ length: 10 }, (_, index) => `a${index}`), ...Array.from({ length: 5 }, (_, index) => `b${index}`)]
  const server = await startServer(t, { memoryDir, allowedRoots: workspace })
  const merged = await tool(server, 'memory_merge', {
    ids: [keep.id, b.id, a.id],
    keepId: keep.id,
    scope: 'workspace',
    cwd: workspace
  })
  assert.equal(merged.isError, false)
  assert.equal(merged.value.content, 'bbb')
  assert.deepEqual(merged.value.tags, expectedTags)
  const entries = await new MemoryStore(scopedDir).readRawEntries()
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].tags, expectedTags)
  const journalEvents = (await readJournalText(scopedDir)).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const updateEvent = journalEvents.filter((event) => event.op === 'update').at(-1)
  assert.deepEqual(updateEvent.entry.tags, expectedTags)
})
