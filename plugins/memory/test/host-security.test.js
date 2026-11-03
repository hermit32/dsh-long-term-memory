import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryStore,
  RAW_FILE,
  assertNoSecretTags,
  assertNoSecrets,
  journalEntrySnapshot
} from '../lib/store.js'

// The host Cordis tools (lib/index.js) and the standalone MCP server
// (bin/dsh-memory-mcp.mjs) are two write paths into the same memory files. These
// guards live in lib/store.js so both entry points reject the same credentials,
// redact the same journal snapshots and share the single merge plan.

const GITHUB_SECRET = `ghp_${'b'.repeat(30)}`
const SECRET_TAG = `sk-${'c'.repeat(24)}`

test('assertNoSecrets rejects credential content and names the calling tool', () => {
  assert.throws(
    () => assertNoSecrets(`token ${GITHUB_SECRET}`, 'memory_add'),
    (error) => {
      assert.match(error.message, /^memory_add: content looks like a credential \(github-token\)/)
      assert.equal(error.message.includes(GITHUB_SECRET), false, 'the rejected value must never be echoed')
      return true
    }
  )
  assert.doesNotThrow(() => assertNoSecrets('user prefers a structured outline first', 'memory_add'))
})

test('assertNoSecretTags rejects a tainted tag without echoing it', () => {
  assert.throws(
    () => assertNoSecretTags(['preference', SECRET_TAG], 'memory_merge'),
    (error) => {
      assert.match(error.message, /^memory_merge: tag looks like a credential \(openai-key\)/)
      assert.equal(error.message.includes(SECRET_TAG), false)
      return true
    }
  )
  assert.doesNotThrow(() => assertNoSecretTags(['preference'], 'memory_add'))
  assert.doesNotThrow(() => assertNoSecretTags(undefined, 'memory_add'))
})

test('journalEntrySnapshot keeps clean deletes verbatim and redacts only tainted fields', () => {
  const clean = { id: 'mem-1', ts: 't1', content: 'plain fact', tags: ['a'] }
  assert.equal(journalEntrySnapshot(clean), clean, 'a clean entry must be journaled as the same object')

  const tainted = { id: 'mem-2', ts: 't2', content: `key ${GITHUB_SECRET}`, tags: ['ok', SECRET_TAG] }
  const snapshot = journalEntrySnapshot(tainted)
  assert.equal(snapshot.content, '[redacted: credential content removed on delete]')
  assert.deepEqual(snapshot.tags, ['ok', '[redacted]'])
  assert.equal(snapshot.id, 'mem-2')
  assert.equal(snapshot.ts, 't2')
  const serialized = JSON.stringify(snapshot)
  assert.equal(serialized.includes(GITHUB_SECRET), false)
  assert.equal(serialized.includes(SECRET_TAG), false)
})

test('the shared merge validator vetoes a legacy tainted participant before any write', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-host-merge-guard-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new MemoryStore(dir)
  const clean = await store.appendRawEntry({ content: 'clean fact', tags: ['a'], importance: 1 })
  const tainted = await store.appendRawEntry({ content: `leaked ${GITHUB_SECRET} value`, tags: ['b'], importance: 1 })
  const before = await readFile(join(dir, RAW_FILE), 'utf8')

  // Exactly the validator the host tool passes to mergeRawEntries.
  const hostValidator = (plan, targets) => {
    for (const entry of targets) {
      assertNoSecrets(entry.content, 'memory_merge')
      assertNoSecretTags(Array.isArray(entry.tags) ? entry.tags : [], 'memory_merge')
    }
    assertNoSecrets(plan.kept.content, 'memory_merge')
    assertNoSecretTags(plan.kept.tags, 'memory_merge')
  }

  await assert.rejects(
    store.mergeRawEntries([clean.id, tainted.id], clean.id, { validate: hostValidator }),
    /memory_merge: content looks like a credential/
  )
  assert.equal(await readFile(join(dir, RAW_FILE), 'utf8'), before, 'a veto must not write raw memory')
  assert.equal((await store.readRawEntries()).length, 2)
})

test('host tools reuse the MCP guards instead of re-implementing them', async () => {
  const index = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  const mcp = await readFile(new URL('../bin/dsh-memory-mcp.mjs', import.meta.url), 'utf8')

  // Memory add scans content and tags; update scans the final stored state;
  // merge scans every participant and the plan; delete redacts the journal.
  assert.match(index, /assertNoSecrets\(content, 'memory_add'\)/)
  assert.match(index, /assertNoSecretTags\(tags, 'memory_add'\)/)
  assert.match(index, /assertNoSecretTags\(patch\.tags !== undefined \? patch\.tags : before\.tags, 'memory_update'\)/)
  assert.match(index, /journalEntrySnapshot\(entry\)/)
  assert.match(index, /validate: \(plan, targets\) =>/)

  // Both entry points import the single implementation from lib/store.js.
  assert.match(mcp, /assertNoSecretTags,/)
  assert.match(mcp, /journalEntrySnapshot,/)
  assert.doesNotMatch(mcp, /function assertNoSecrets/)
  assert.doesNotMatch(mcp, /function journalEntrySnapshot/)
})
