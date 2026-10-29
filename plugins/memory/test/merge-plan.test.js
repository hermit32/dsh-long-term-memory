import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, RAW_FILE, normalizeTags, planMergeEntries } from '../lib/store.js'

const GITHUB_SECRET = `ghp_${'a'.repeat(30)}`

test('planMergeEntries is the single deterministic storage-order merge plan', () => {
  const entries = [
    { id: 'keep', ts: 't1', content: 'keep', tags: ['k'], importance: 1 },
    { id: 'secret', ts: 't2', content: `k${GITHUB_SECRET}`, tags: ['s'], importance: 1 },
    { id: 'clean', ts: 't3', content: 'c'.repeat(35), tags: ['c'], importance: 2 }
  ]
  const plan = planMergeEntries(entries, 'keep')
  // Equal normalized length: the earlier entry in storage order wins.
  assert.equal(plan.kept.content, entries[1].content)
  assert.deepEqual(plan.kept.tags, ['k', 's', 'c'])
  assert.equal(plan.kept.importance, 2)
  assert.deepEqual(plan.removed.map((entry) => entry.id), ['secret', 'clean'])
  // Deterministic for identical input.
  assert.deepEqual(planMergeEntries(entries, 'keep'), plan)
  // Order is part of the contract: reversing input changes the tie-break.
  const reversed = planMergeEntries([...entries].reverse(), 'keep')
  assert.equal(reversed.kept.content, entries[2].content)
  assert.deepEqual(reversed.kept.tags, ['c', 's', 'k'])
  // keepId must be one of the targets.
  assert.throws(() => planMergeEntries(entries, 'missing'), /keepId/)
})

test('mergeRawEntries validates the exact plan before writing and never duplicates the rules', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-merge-plan-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new MemoryStore(dir)
  const keep = await store.appendRawEntry({ content: 'keep', tags: ['k'], importance: 1 })
  const other = await store.appendRawEntry({ content: 'a much longer content', tags: ['o'], importance: 2 })
  const before = await readFile(join(dir, RAW_FILE), 'utf8')
  let seen
  await assert.rejects(
    store.mergeRawEntries([keep.id, other.id], keep.id, {
      validate: (plan, targets) => {
        seen = { plan, targets }
        throw new Error('synthetic validator veto')
      }
    }),
    /synthetic validator veto/
  )
  assert.equal(seen.targets.length, 2)
  assert.equal(seen.plan.kept.content, 'a much longer content')
  // A veto must leave the raw file byte-identical.
  assert.equal(await readFile(join(dir, RAW_FILE), 'utf8'), before)
  // The plan handed to the validator is exactly what the successful write returns.
  const expected = planMergeEntries(await store.readRawEntries(), keep.id)
  const result = await store.mergeRawEntries([keep.id, other.id], keep.id)
  assert.deepEqual(result, expected)
  const entries = await store.readRawEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].content, expected.kept.content)
  assert.deepEqual(entries[0].tags, expected.kept.tags)
})

test('normalizeTags errors never include the caller tag value', () => {
  const secretTag = `${GITHUB_SECRET}${'x'.repeat(30)}`
  assert.throws(
    () => normalizeTags([secretTag]),
    (error) => {
      assert.match(error.message, /tag exceeds 48 characters/)
      assert.equal(error.message.includes(GITHUB_SECRET), false)
      assert.equal(error.message.includes('x'.repeat(30)), false)
      return true
    }
  )
})
