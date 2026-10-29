import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendManualNote,
  bulletText,
  exactTextKey,
  rewriteSummaryForMutation,
  scrubEntriesFromSummary
} from '../lib/summary-scrub.js'

const A = { id: 'mem-a', content: '用户喜欢蓝色。' }
const B = { id: 'mem-b', content: '用户喜欢蓝色，但更喜欢深蓝色。' }
const C = { id: 'mem-c', content: '用户喜欢猫。' }

function summary(...bullets) {
  return `# DSH memory\n\nv1\n\n## 偏好\n\n${bullets.map((line) => `- ${line}`).join('\n')}\n`
}

test('deleting A removes only A; B and C stay', () => {
  const result = scrubEntriesFromSummary(summary(A.content, B.content, C.content), [A])
  assert.equal(result.changed, true)
  assert.equal(result.removed.length, 1)
  assert.equal(result.removed[0].entryId, A.id)
  assert.doesNotMatch(result.text, /^- 用户喜欢蓝色。$/m)
  assert.match(result.text, /用户喜欢蓝色，但更喜欢深蓝色。/)
  assert.match(result.text, /用户喜欢猫。/)
})

test('deleting B removes only B; A and C stay', () => {
  const result = scrubEntriesFromSummary(summary(A.content, B.content, C.content), [B])
  assert.equal(result.changed, true)
  assert.equal(result.removed.length, 1)
  assert.equal(result.removed[0].entryId, B.id)
  assert.match(result.text, /^- 用户喜欢蓝色。$/m)
  assert.doesNotMatch(result.text, /更喜欢深蓝色/)
  assert.match(result.text, /用户喜欢猫。/)
})

test('updating A leaves B and C alone and records the new A as a note', () => {
  const result = rewriteSummaryForMutation(summary(A.content, B.content, C.content), {
    remove: [A],
    note: '用户喜欢蓝色，最近更常穿深蓝色。'
  })
  assert.equal(result.ok, true)
  assert.match(result.text, /用户喜欢蓝色，但更喜欢深蓝色。/)
  assert.match(result.text, /用户喜欢猫。/)
  assert.match(result.text, /最近更常穿深蓝色/)
  assert.doesNotMatch(result.text, /^- 用户喜欢蓝色。$/m)
})

test('restoring A adds it back without deleting B or C', () => {
  const before = summary(B.content, C.content)
  const after = appendManualNote(before, A.content)
  assert.equal(after.changed, true)
  assert.match(after.text, /^- 用户喜欢蓝色。$/m)
  assert.match(after.text, /用户喜欢蓝色，但更喜欢深蓝色。/)
  assert.match(after.text, /用户喜欢猫。/)
})

test('a shorter fact is not treated as a duplicate of a longer prefix bullet', () => {
  const before = summary(B.content, C.content)
  const after = appendManualNote(before, A.content)
  assert.equal(after.changed, true)
  const aLines = after.text.split('\n').filter((line) => bulletText(line) === A.content)
  assert.equal(aLines.length, 1)
})

test('paraphrased summary bullets are left alone rather than guessed', () => {
  const result = scrubEntriesFromSummary(summary('用户偏爱蓝色。', C.content), [A])
  assert.equal(result.changed, false)
  assert.match(result.text, /用户偏爱蓝色。/)
  assert.match(result.text, /用户喜欢猫。/)
})

test('exactTextKey folds width/case/trailing punctuation but not internal text', () => {
  assert.equal(exactTextKey(' 用户喜欢蓝色。 '), exactTextKey('用户喜欢蓝色'))
  assert.equal(exactTextKey('API Key'), exactTextKey('api key'))
  assert.notEqual(exactTextKey(A.content), exactTextKey(B.content))
  assert.notEqual(exactTextKey('用户喜欢蓝色'), exactTextKey('用户喜欢猫'))
})
