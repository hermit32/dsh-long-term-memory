import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-scoped-'))
  try {
    const store = new MemoryStore(dir)
    await fn(store, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('curator operations add, update and merge raw entries', async () => {
  await withStore(async (store) => {
    const first = await store.appendRawEntry({ content: '主人喜欢简洁中文', tags: ['preference'], importance: 1 })
    const second = await store.appendRawEntry({ content: '主人喜欢简洁的中文回复', tags: ['preference'], importance: 2 })
    const result = await store.applyCuratorOperations([
      { op: 'merge', ids: [first.id, second.id], keepId: first.id },
      { op: 'update', id: first.id, content: '主人偏好简洁中文', tags: ['preference', 'style'], importance: 3 },
      { op: 'add', content: '共同完成过 DSH 记忆系统', tags: ['shared'], importance: 2 }
    ])
    assert.equal(result.ok, true)
    const entries = await store.readRawEntries()
    assert.equal(entries.length, 2)
    const survivor = entries.find((entry) => entry.id === first.id)
    assert.equal(survivor.content, '主人偏好简洁中文')
    assert.deepEqual(survivor.tags, ['preference', 'style'])
    assert.equal(survivor.importance, 3)
    assert.ok(entries.some((entry) => entry.content.includes('记忆系统')))
  })
})

test('curator operations skip duplicates', async () => {
  await withStore(async (store) => {
    await store.appendRawEntry({ content: '同一条事实', tags: [], importance: 1 })
    const result = await store.applyCuratorOperations([
      { op: 'add', content: '同一条事实', tags: [], importance: 1 }
    ])
    assert.equal(result.ok, true)
    assert.equal(result.applied[0].duplicate, true)
    assert.equal((await store.readRawEntries()).length, 1)
  })
})

test('curator operations reject delete and roll back earlier writes', async () => {
  await withStore(async (store) => {
    const kept = await store.appendRawEntry({ content: '保留的事实', tags: [], importance: 1 })
    const beforeCount = (await store.readRawEntries()).length
    const result = await store.applyCuratorOperations([
      { op: 'add', content: '这次不应留下', tags: [], importance: 2 },
      { op: 'delete', id: kept.id }
    ])
    assert.equal(result.ok, false)
    const after = await store.readRawEntries()
    assert.equal(after.length, beforeCount)
    assert.ok(!after.some((entry) => entry.content === '这次不应留下'))
  })
})

test('pending turn state round-trips without storing conversation text', async () => {
  await withStore(async (store) => {
    const state = {
      version: 1,
      sessions: {
        'session-a': {
          pendingTurns: 9,
          cursorSeq: 41,
          countedSeq: 77,
          lastTurnAt: 1793000000000,
          lastCuratedAt: 0,
          lastAttemptAt: 0,
          attempts: 0,
          emptyChecks: 2
        }
      }
    }
    await store.writePendingTurns(state)
    const loaded = await store.readPendingTurns()
    assert.deepEqual(loaded, state)
    const raw = await store.readText('pending-turns.json')
    assert.doesNotMatch(raw, /用户|助手|conversation/)
  })
})
