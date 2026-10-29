import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscriptLines } from '../lib/scoped.js'
import { attributeOperation, hasSharedExperienceClaim, textSimilarity } from '../lib/attribution.js'
import { rewriteSummaryForMutation, scrubEntriesFromSummary } from '../lib/summary-scrub.js'

const SUMMARY = `# DSH memory

Maintained by the dsh-memory plugin. Use as guidance; more specific instructions take precedence. It does not override system, developer, or direct user instructions.

v6

## dsh-memory-scoped 插件

- 隔离缺陷（已修复）：子代理会话继承父工作区的 header.cwd，被误判为私人工作区会话。
- 核心验收方式：用 subagent 在 default-workspace 做只读自检。

## Verification notes

- (no active entries)
`

function transcript() {
  const events = [
    { seq: 1, type: 'turn/start', data: {} },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '最近一起做了什么？' }] } },
    { seq: 3, type: 'tool/call', data: { name: 'glob', arguments: '{"path":"C:\\\\Workspaces\\\\private\\\\Downloads","pattern":"*"}' } },
    { seq: 4, type: 'tool/result', data: { name: 'glob', message: { toolCallId: 'c1', content: [{ type: 'text', text: '医学免疫学课程标准.docx\n25检验技术进度.xls' }] } } },
    { seq: 5, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '除了出图，我还顺手整理了三份医学教学资料。' }] } } }
  ]
  return buildTranscriptLines(events, { fromSeq: 1, maxBytes: 40000 })
}

test('transcript lines keep sequence, role and tool name for attribution', () => {
  const built = transcript()
  assert.match(built.text, /\[工具\]/)
  assert.match(built.text, /\[结果\]/)
  const call = built.lines.find((line) => line.kind === 'tool_call')
  assert.equal(call.toolName, 'glob')
  assert.equal(call.seq, 3)
  const result = built.lines.find((line) => line.kind === 'tool_result')
  assert.equal(result.toolName, 'glob')
  assert.ok(built.lines.every((line) => Number.isFinite(line.seq)))
})

test('a directory listing can never become a shared experience', () => {
  const built = transcript()
  const bad = attributeOperation(
    { op: 'add', content: '用户和助手一起整理过 Downloads 里的医学教学资料。' },
    { lines: built.lines, hasHumanExchange: true, sessionId: 'session-a', endSeq: 5 }
  )
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /共同|文件|来源/)
  assert.equal(hasSharedExperienceClaim('用户和助手一起整理过医学资料'), true)
})

test('a file fact is allowed but is labelled as file/tool evidence', () => {
  const built = transcript()
  const good = attributeOperation(
    { op: 'add', content: 'Downloads 中存在《医学免疫学》课程标准 docx 和 25 检验技术进度 xls。' },
    { lines: built.lines, hasHumanExchange: true, sessionId: 'session-a', endSeq: 5 }
  )
  assert.equal(good.ok, true)
  assert.equal(good.sourceType, 'file_fact')
  assert.equal(good.sourceSessionId ?? 'session-a', 'session-a')
  assert.match(good.evidence, /医学免疫学/)
})

test('a user statement is the reliable source for personal facts', () => {
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '以后都用中文回复我，我习惯中文。' }] } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的。' }] } } }
  ]
  const built = buildTranscriptLines(events, { fromSeq: 1, maxBytes: 4000 })
  const good = attributeOperation(
    { op: 'add', content: '用户希望以后都用中文回复。' },
    { lines: built.lines, hasHumanExchange: true, sessionId: 'session-a', endSeq: 2 }
  )
  assert.equal(good.ok, true)
  assert.equal(good.sourceType, 'user_statement')
  assert.match(good.evidence, /中文/)
})

test('an assistant claim alone is not a memory source', () => {
  const events = [
    { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '我记得用户喜欢蓝色。' }] } } }
  ]
  const built = buildTranscriptLines(events, { fromSeq: 1, maxBytes: 4000 })
  const bad = attributeOperation(
    { op: 'add', content: '用户喜欢蓝色。' },
    { lines: built.lines, hasHumanExchange: false, sessionId: 'session-a', endSeq: 1 }
  )
  assert.equal(bad.ok, false)
})

test('a real completed session task can support a shared experience', () => {
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我把这个脚本改成可重试的。' }] } },
    { seq: 2, type: 'tool/call', data: { name: 'edit', arguments: '{"file_path":"C:\\\\脚本.ps1","patch":"可重试"}' } },
    { seq: 3, type: 'tool/result', data: { name: 'edit', message: { toolCallId: 'c1', content: [{ type: 'text', text: 'edited' }] } } },
    { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已经加上了重试。' }] } } }
  ]
  const built = buildTranscriptLines(events, { fromSeq: 1, maxBytes: 4000 })
  const good = attributeOperation(
    { op: 'add', content: '用户和我一起把这个脚本改成可重试的。' },
    { lines: built.lines, hasHumanExchange: true, sessionId: 'session-a', endSeq: 4 }
  )
  assert.equal(good.ok, true)
  assert.equal(good.sourceType, 'session_task')
})

test('summary scrub removes only the bullet that came from the deleted entry', () => {
  const entry = {
    id: 'mem-1111',
    content: '隔离缺陷（已修复）：子代理会话继承父工作区的 header.cwd，被误判为私人工作区会话。'
  }
  const result = scrubEntriesFromSummary(SUMMARY, [entry], { threshold: 0.5 })
  assert.equal(result.changed, true)
  assert.equal(result.removed.length, 1)
  assert.doesNotMatch(result.text, /子代理会话继承父工作区/)
  assert.match(result.text, /核心验收方式/)
  assert.match(result.text, /Verification notes/)
})

test('summary scrub also removes a short exact bullet', () => {
  const shortSummary = `# DSH memory\n\nv2\n\n## 偏好\n\n- 用户喜欢蓝色。\n\n## Verification notes\n\n- (no active entries)\n`
  const result = scrubEntriesFromSummary(shortSummary, [{ id: 'mem-short', content: '用户喜欢蓝色。' }], { threshold: 0.5 })
  assert.equal(result.changed, true)
  assert.doesNotMatch(result.text, /喜欢蓝色/)
  assert.match(result.text, /Verification notes/)
})

test('summary rewrite bumps the version and keeps a valid section structure', () => {
  const entry = { id: 'mem-2222', content: '核心验收方式：用 subagent 在 default-workspace 做只读自检。' }
  const result = rewriteSummaryForMutation(SUMMARY, { remove: [entry], note: '新的验收结论。' })
  assert.equal(result.ok, true)
  assert.match(result.text, /^v7$/m)
  assert.doesNotMatch(result.text, /核心验收方式/)
  assert.match(result.text, /新的验收结论/)
  assert.match(result.text, /## 手动更正/)
})

test('text similarity is symmetric enough to catch a paraphrased summary bullet', () => {
  const a = '隔离缺陷（已修复）：子代理会话继承父工作区的 header.cwd，被误判为私人工作区会话。'
  const b = '隔离缺陷（已修复）：子代理会话继承父工作区的 header.cwd，被误判为私人工作区会话；现仅对私人工作区根会话开放。'
  assert.ok(textSimilarity(a, b) >= 0.6)
})
