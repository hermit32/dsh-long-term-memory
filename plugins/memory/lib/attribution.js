// Deterministic source attribution for curator output.
//
// The curator is an LLM: it can paraphrase, merge, and — as one real incident
// showed — turn a directory listing into "we organized these files together".
// Asking the same model to certify its own source would not fix that. Instead
// this module matches each proposed memory against the transcript lines the
// curator actually received, derives a source class from the matched line, and
// refuses entries that assert a shared experience without a user statement or a
// real (write/execute) session task behind them.
//
// Pure Node.js: no harness imports, trivially unit-testable.

const READ_ONLY_TOOLS = new Set([
  'read',
  'read_image',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'search',
  'list',
  'skill',
  'todo_write',
  'memory_read',
  'memory_search',
  'memory_review',
  'memory_stats',
  'memory_history',
  'memory_browse',
  'present'
])

const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'str_replace_editor',
  'apply_patch',
  'office',
  'subagent',
  'workflow',
  'bash',
  'terminal',
  'pwsh',
  'job',
  'memory_add',
  'memory_update',
  'memory_delete',
  'memory_merge',
  'schedule_create',
  'session_delete'
])

// Commands that only inspect state. A `pwsh` call that merely lists a folder is
// file evidence, not proof that a task was performed.
const READ_ONLY_COMMAND = /^\s*(get-childitem|gci|dir\b|ls\b|get-item|gi\b|get-content|gc\b|cat\b|type\b|get-filehash|test-path|resolve-path|select-string|findstr|where\b|rg\b|find\b|stat\b|head\b|tail\b|wc\b)/i
const WRITE_COMMAND = /(\bset-content\b|\badd-content\b|\bout-file\b|\bnew-item\b|\bremove-item\b|\bmove-item\b|\bcopy-item\b|\brename-item\b|\bstart-process\b|\bgit\s+(commit|push|checkout|merge|add)\b|>>?\s*[^&\s]|\brm\b|\bdel\b|\bmkdir\b|\bmd\b|\bnew-object\b|\bwrite\b|\bset-itemproperty\b)/i

const SHARED_EXPERIENCE_PATTERNS = [
  /(一起|共同|一同|一块儿?).{0,24}(做|整理|完成|看|读|写|改|弄|搞|选|买|去|玩|学|讨论|研究|检查|处理|搭建|配置|调试|测试|安装|准备)/,
  /(我|助手).{0,16}(帮|替|陪|和|与|跟).{0,16}用户.{0,24}(做|整理|完成|看|读|写|改|弄|搞|查|处理|搭建|配置|调试|测试|安装|准备)/,
  /用户.{0,16}(和|与|跟|让|叫|请|找).{0,16}(我|助手).{0,24}(做|整理|完成|看|读|写|改|弄|搞|查|处理|搭建|配置|调试|测试|安装|准备)/,
  /(上次|之前|曾经|那天|当时|刚刚|刚才).{0,24}(一起|共同|陪用户|帮用户|和用户|与用户)/,
  /(我们|咱).{0,24}(做过|整理过|弄过|看过|写过|改过|一起)/
]

const PERSONAL_FACT_PATTERN = /(用户|用户).{0,20}(喜欢|偏好|习惯|讨厌|不喜欢|生日|名字|住在|工作|职业|年龄|家人|朋友|电话|地址|邮箱|常用|总是|从来不|希望|要求)/

/**
 * Normalize punctuation and width so a quote and a paraphrase compare sanely.
 * @param value - raw text.
 * @returns lowercase text with punctuation collapsed to spaces.
 */
export function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`*_>#~]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tokenize mixed CJK/Latin text. CJK runs become character bigrams (single
 * characters when the run is one character), Latin runs become words.
 * @param value - raw text.
 * @returns token set.
 */
export function matchTokens(value) {
  const tokens = new Set()
  const normalized = normalizeForMatch(value)
  if (normalized.length === 0) return tokens
  for (const part of normalized.split(' ')) {
    if (part.length === 0) continue
    if (/^[\x00-\x7f]+$/.test(part)) {
      if (part.length >= 2) tokens.add(part)
      continue
    }
    const chars = [...part]
    if (chars.length === 1) {
      tokens.add(chars[0])
      continue
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.add(chars[index] + chars[index + 1])
    }
  }
  return tokens
}

function overlap(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared
}

/**
 * How much of one text's vocabulary appears in another (0..1).
 * @param source - text whose tokens are counted.
 * @param target - text searched for those tokens.
 * @returns coverage in [0, 1].
 */
export function coverage(source, target) {
  const a = matchTokens(source)
  const b = matchTokens(target)
  if (a.size === 0 || b.size === 0) return 0
  return overlap(a, b) / a.size
}

/** Dice coefficient over token sets. */
export function dice(left, right) {
  const a = matchTokens(left)
  const b = matchTokens(right)
  if (a.size === 0 || b.size === 0) return 0
  return (2 * overlap(a, b)) / (a.size + b.size)
}

/** Similarity used to scrub a stale summary bullet: either direction counts. */
export function textSimilarity(left, right) {
  return Math.max(coverage(left, right), coverage(right, left))
}

/**
 * Classify a tool call as read-only, mutating, or unknown.
 * @param toolName - tool name from the transcript line.
 * @param args - raw argument string (may be a JSON string).
 * @returns 'read' | 'write' | 'unknown'.
 */
export function classifyTool(toolName, args = '') {
  const name = String(toolName ?? '').trim().toLowerCase()
  const raw = String(args ?? '')
  if (name.length === 0) return 'unknown'
  if (name === 'pwsh' || name === 'bash' || name === 'terminal') {
    if (WRITE_COMMAND.test(raw)) return 'write'
    if (READ_ONLY_COMMAND.test(raw)) return 'read'
    return 'read'
  }
  if (name === 'present') return 'read'
  if (READ_ONLY_TOOLS.has(name)) return 'read'
  if (WRITE_TOOLS.has(name)) return 'write'
  return 'unknown'
}

/** Source class implied by a transcript line. */
export function sourceClassOfLine(line, context = {}) {
  if (line === null || typeof line !== 'object') return 'unknown'
  if (line.kind === 'user') return 'user_statement'
  if (line.kind === 'assistant') return 'assistant_claim'
  if (line.kind === 'tool_call' || line.kind === 'tool_result') {
    const shape = classifyTool(line.toolName, line.args ?? '')
    if (shape === 'write' && context.hasHumanExchange === true) return 'session_task'
    return 'file_fact'
  }
  return 'unknown'
}

/** Whether the content asserts that the user and the assistant did something together. */
export function hasSharedExperienceClaim(content) {
  const text = String(content ?? '')
  return SHARED_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(text))
}

/** Whether the content asserts a personal attribute of the user. */
export function hasPersonalFactClaim(content) {
  return PERSONAL_FACT_PATTERN.test(String(content ?? ''))
}

/**
 * Pick the transcript line that best supports a proposed memory.
 * @param content - proposed memory text.
 * @param lines - transcript lines (`{seq, kind, toolName, args, text}`).
 * @returns `{line, score, coverage}`; line is undefined when nothing matches.
 */
export function bestEvidenceLine(content, lines) {
  const list = Array.isArray(lines) ? lines : []
  let best
  let bestScore = 0
  let bestCoverage = 0
  for (const line of list) {
    if (line === null || typeof line !== 'object' || typeof line.text !== 'string' || line.text.length === 0) continue
    const lineCoverage = coverage(content, line.text)
    const score = Math.max(lineCoverage, dice(content, line.text))
    if (score > bestScore) {
      best = line
      bestScore = score
      bestCoverage = lineCoverage
    }
  }
  return { line: best, score: bestScore, coverage: bestCoverage }
}

/**
 * Attribute one curator proposal to a transcript.
 *
 * Rules (matching the task's provenance constraints):
 * - personal facts about the user need a user statement;
 * - shared experiences need a user statement or a real completed session task;
 * - a file/tool listing alone can never prove a shared experience;
 * - an assistant claim alone is not a source and is refused.
 *
 * @param operation - `{op, content}` from the validated curator batch.
 * @param context - `{lines, hasHumanExchange, sessionId, endSeq}`.
 * @returns `{ok, sourceType, sourceEventSeq, sourceEventEndSeq, evidence, reason}`.
 */
export function attributeOperation(operation, context = {}) {
  const content = typeof operation.content === 'string' ? operation.content.trim() : ''
  if (content.length === 0) return { ok: true, skip: true }
  const lines = Array.isArray(context.lines) ? context.lines : []
  const joined = lines.map((line) => line.text).join('\n')
  const overall = coverage(content, joined)
  if (overall < 0.34) {
    return { ok: false, reason: '内容与本次对话没有足够重合，无法确定来源' }
  }
  const best = bestEvidenceLine(content, lines)
  const shared = hasSharedExperienceClaim(content)
  const personal = hasPersonalFactClaim(content)
  let selected = best
  if (shared || personal) {
    const kinds = shared ? ['tool_call', 'tool_result'] : ['user']
    const preferred = bestEvidenceLine(content, lines.filter((line) => kinds.includes(line.kind)))
    if (preferred.line !== undefined) selected = preferred
  }
  if (selected.line === undefined || selected.score < 0.2) {
    return { ok: false, reason: '找不到支持该内容的原文，无法确定来源' }
  }
  const sourceType = sourceClassOfLine(selected.line, context)
  if (sourceType === 'assistant_claim') {
    return { ok: false, reason: '只有助手自己的说法，不能单独作为长期记忆来源' }
  }
  if (personal && sourceType !== 'user_statement') {
    return { ok: false, reason: '关于用户的个人事实必须来自用户的明确陈述' }
  }
  if (shared) {
    if (sourceType !== 'user_statement' && sourceType !== 'session_task') {
      return { ok: false, reason: '只有文件/工具资料，不能证明用户和助手共同做过什么' }
    }
    if (sourceType === 'session_task' && context.hasHumanExchange !== true) {
      return { ok: false, reason: '会话中没有真实的人类交互，不能作为共同经历' }
    }
  }
  const seq = Number.isFinite(selected.line.seq) ? selected.line.seq : undefined
  return {
    ok: true,
    sourceType,
    sourceEventSeq: seq,
    sourceEventEndSeq: Number.isFinite(context.endSeq) ? context.endSeq : seq,
    evidence: clipEvidence(selected.line.text),
    toolName: selected.line.toolName ?? null
  }
}

function clipEvidence(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}
