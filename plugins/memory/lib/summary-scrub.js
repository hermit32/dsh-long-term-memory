// Deterministic summary maintenance after a memory mutation.
//
// Consolidation is an LLM call: it is the right way to produce a coherent
// summary, but it can fail, time out, or be unavailable. The one guarantee the
// console must keep is narrower and local: a deleted or corrected entry must
// not stay in the injected summary. This module removes only a bullet whose
// text is an exact (normalized) match for the changed entry, and appends a
// bounded manual note when an edit or addition should be visible immediately.
// The normal consolidation still runs afterwards to restore a properly
// distilled summary.
//
// Exact matching is deliberate. The old fuzzy matcher could delete a different
// but similar fact ("主人喜欢蓝色。" vs "主人喜欢猫。") when one entry changed.
// A summary line that cannot be identified exactly is left alone; the next
// consolidation may rewrite it, but a local mutation never widens the blast
// radius. This is the conservative trade-off required for private memory.

import { ensureVersionLine, summaryVersion, validateMergedSummary } from './store.js'

const BULLET = /^\s*[-*+]\s+/
const SECTION = /^##\s+\S/
const MAX_NOTE_CHARS = 500
const TRAILING_PUNCTUATION = /[。．.!！?？;；]+$/u

/** Whether a line is a summary bullet. */
export function isBulletLine(line) {
  return BULLET.test(String(line ?? ''))
}

/** Strip a Markdown bullet marker and trailing parenthetical tags. */
export function bulletText(line) {
  return String(line ?? '')
    .replace(BULLET, '')
    .replace(/\s*\((?:tags?|标签)[:：][^)]*\)\s*$/i, '')
    .trim()
}

/**
 * Normalize text for exact comparison. Width/case/whitespace and trailing
 * sentence punctuation are folded; internal punctuation is preserved so
 * "蓝色" and "蓝色，但更喜欢深蓝色" never compare equal.
 * @param value - raw text.
 * @returns comparison key.
 */
export function exactTextKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim()
    .toLocaleLowerCase('en-US')
}

/**
 * Remove summary bullets that exactly correspond to the given entries.
 *
 * A bullet is removed only when its normalized text equals the normalized
 * content of one of the supplied entries (tags suffix excluded). No fuzzy
 * similarity is used: a paraphrased or otherwise unidentifiable bullet is
 * kept, because deleting the wrong private fact is worse than leaving a stale
 * line for the next consolidation.
 *
 * @param summary - current summary Markdown.
 * @param entries - entries being deleted or whose old text must disappear.
 * @param options - retained for call-site compatibility; not used.
 * @returns `{text, changed, removed: [{entryId, line, match}]}`.
 */
export function scrubEntriesFromSummary(summary, entries, options = {}) {
  const source = String(summary ?? '')
  const targets = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || typeof entry !== 'object') continue
    const key = exactTextKey(entry.content)
    if (key.length === 0 || targets.has(key)) continue
    targets.set(key, entry)
  }
  if (source.length === 0 || targets.size === 0) return { text: source, changed: false, removed: [] }
  const kept = []
  const removed = []
  for (const line of source.split(/\r?\n/)) {
    if (!isBulletLine(line)) {
      kept.push(line)
      continue
    }
    const candidate = bulletText(line)
    if (candidate.length === 0) {
      kept.push(line)
      continue
    }
    const match = targets.get(exactTextKey(candidate))
    if (match !== undefined) {
      removed.push({ entryId: match.id, line: line.trim(), match: 'exact' })
      continue
    }
    kept.push(line)
  }
  if (removed.length === 0) return { text: source, changed: false, removed: [] }
  return { text: dropEmptySections(kept).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', changed: true, removed }
}

/** Drop `## ` headings whose section body became empty after a scrub. */
export function dropEmptySections(lines) {
  const out = []
  let section = null
  const flush = () => {
    if (section === null) return
    if (section.body.some((line) => line.trim().length > 0)) out.push(section.heading, ...section.body)
    section = null
  }
  for (const line of lines) {
    if (SECTION.test(line)) {
      flush()
      section = { heading: line, body: [] }
      continue
    }
    if (section === null) out.push(line)
    else section.body.push(line)
  }
  flush()
  return out
}

/**
 * Append a bounded manual note under a dedicated section.
 * Duplicate suppression is line-exact; a shorter fact that happens to prefix a
 * longer bullet is not considered a duplicate.
 * @param summary - current summary.
 * @param note - the fact that should be visible immediately.
 * @param sectionTitle - heading text without `## `.
 * @returns `{text, changed}`.
 */
export function appendManualNote(summary, note, sectionTitle = '手动更正') {
  const source = String(summary ?? '')
  const clean = String(note ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return { text: source, changed: false }
  const bounded = clean.length > MAX_NOTE_CHARS ? `${clean.slice(0, MAX_NOTE_CHARS)}…` : clean
  const bullet = `- ${bounded}`
  const lines = source.split(/\r?\n/)
  if (lines.some((line) => isBulletLine(line) && exactTextKey(bulletText(line)) === exactTextKey(bounded))) {
    return { text: source, changed: false }
  }
  const heading = `## ${sectionTitle}`
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start >= 0) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (SECTION.test(lines[index])) {
        end = index
        break
      }
    }
    const body = lines.slice(start + 1, end)
    while (body.length > 0 && body[body.length - 1].trim().length === 0) body.pop()
    const next = [...lines.slice(0, start + 1), ...body, bullet, '', ...lines.slice(end)]
    return { text: next.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', changed: true }
  }
  const base = source.trimEnd()
  const text = `${base}\n\n${heading}\n\n${bullet}\n`
  return { text, changed: true }
}

/**
 * Produce the next summary text for a mutation: scrub exact stale bullets,
 * append an optional note, bump the version, and validate the result.
 * @param summary - current summary.
 * @param options - `{remove, note, sectionTitle}`.
 * @returns `{ok, text, removed, changed, reason}`.
 */
export function rewriteSummaryForMutation(summary, options = {}) {
  const scrubbed = scrubEntriesFromSummary(summary, options.remove)
  let text = scrubbed.text
  let appended = false
  if (typeof options.note === 'string' && options.note.trim().length > 0) {
    const next = appendManualNote(text, options.note, options.sectionTitle)
    text = next.text
    appended = next.changed
  }
  const changed = scrubbed.changed || appended
  if (!changed) return { ok: true, text, removed: scrubbed.removed, changed: false }
  if (!/^##\s+\S/m.test(text)) {
    text = `${text.trimEnd()}\n\n## Verification notes\n\n- (no active entries)\n`
  }
  const version = summaryVersion(text) + 1
  const versioned = ensureVersionLine(text, version)
  const check = validateMergedSummary(versioned)
  if (!check.ok) return { ok: false, text: summary, removed: scrubbed.removed, changed: false, reason: check.reason }
  return { ok: true, text: versioned, removed: scrubbed.removed, changed: true }
}
