#!/usr/bin/env node
/**
 * Reapply the local dsh-im `/new` lifecycle bridge after installing or
 * upgrading @xmanrui/dsh-im.
 *
 * dsh-im 5.6.0 implements WeChat `/new` as `state.clearSession(key)` and does
 * not emit a host lifecycle event. The memory plugin therefore needs one extra
 * process event. This script patches the installed package (source + runtime
 * bundle), never the upstream repo.
 *
 * Safety contract:
 *   - `--check` succeeds only when BOTH the source and runtime bundle on disk
 *     contain a complete patch. Uninstalled or half-installed packages fail.
 *   - an apply preflights both files and both exact old blocks before writing;
 *     a version mismatch or half-install fails before any write.
 *   - both files are written through same-directory temp files, then swapped;
 *     if the second swap fails, the first file is restored from backup.
 *
 * Usage:
 *   node apply-dsh-im-patch.mjs [--dsh-im <package-dir>] [--check]
 *
 * Default package dir:
 *   %USERPROFILE%/.dsh/profiles/desktop/node_modules/@xmanrui/dsh-im
 */
import fs from 'node:fs'
import path from 'node:path'

const EVENT = 'dsh-im/new-session'
const args = process.argv.slice(2)
let dshIm = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', '@xmanrui', 'dsh-im')
let check = false
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--dsh-im') dshIm = args[++i]
  else if (args[i] === '--check') check = true
  else {
    console.error(`unknown argument: ${args[i]}`)
    process.exit(2)
  }
}
dshIm = path.resolve(dshIm)
const sourcePath = path.join(dshIm, 'src', 'channels', 'weixin', 'weixin-bridge.mjs')
const bundlePath = path.join(dshIm, 'lib', 'index.js')

const sourceOld = [
  "      if (!hasImages && !hasFiles && command === '/new') {",
  '        await this.#state.clearSession(key);',
  "        await this.#send(sender, t('已开启新会话。请发送你的问题。'), contextToken, runId);",
  '        await this.#state.markSeen(messageId);',
  '        return;',
  '      }'
].join('\n')
const sourceNew = [
  "      if (!hasImages && !hasFiles && command === '/new') {",
  '        // dsh-memory-scoped listens for this local process event. `/new` only',
  '        // clears the conversation binding; it does not create a DSH session,',
  '        // so this is the earliest reliable workspace-level cue.',
  '        const previousSessionId = this.#state.sessionFor(key);',
  "        const workspace = typeof this.#harness.currentConversationWorkspace === 'function'",
  '          ? this.#harness.currentConversationWorkspace(key)',
  "          : typeof this.#harness.currentWorkspace === 'function'",
  '            ? this.#harness.currentWorkspace()',
  '            : null;',
  '        await this.#state.clearSession(key);',
  '        try {',
  "          globalThis.process?.emit?.('" + EVENT + "', {",
  "            channel: 'weixin', key, previousSessionId, workspace, at: Date.now(),",
  '          });',
  "        } catch { /* a listener must never break /new */ }",
  "        await this.#send(sender, t('已开启新会话。请发送你的问题。'), contextToken, runId);",
  '        await this.#state.markSeen(messageId);',
  '        return;',
  '      }'
].join('\n')
const bundleOld = 'if(!y&&!Q&&D==="/new"){await this.#g.clearSession(n),await this.#q(s,S("\\u5DF2\\u5F00\\u542F\\u65B0\\u4F1A\\u8BDD\\u3002\\u8BF7\\u53D1\\u9001\\u4F60\\u7684\\u95EE\\u9898\\u3002"),c,g),await this.#g.markSeen(r);return}'
const bundleNew = 'if(!y&&!Q&&D==="/new"){let _prev=this.#g.sessionFor(n),_ws=typeof this.#a.currentConversationWorkspace=="function"?this.#a.currentConversationWorkspace(n):typeof this.#a.currentWorkspace=="function"?this.#a.currentWorkspace():null;await this.#g.clearSession(n);try{process.emit("' + EVENT + '",{channel:"weixin",key:n,previousSessionId:_prev,workspace:_ws,at:Date.now()})}catch(_err){}await this.#q(s,S("\\u5DF2\\u5F00\\u542F\\u65B0\\u4F1A\\u8BDD\\u3002\\u8BF7\\u53D1\\u9001\\u4F60\\u7684\\u95EE\\u9898\\u3002"),c,g),await this.#g.markSeen(r);return}'

function read(p) {
  if (!fs.existsSync(p)) throw new Error(`missing ${p}`)
  return fs.readFileSync(p, 'utf8')
}
function count(text, needle) {
  return text.split(needle).length - 1
}
function normalizeSource(text) {
  return text.replace(/\r\n/g, '\n')
}
function stateOf(sourceText, bundleText) {
  const source = normalizeSource(sourceText)
  // Count full blocks. A marker in a comment is not a block; a duplicated or
  // mixed old/new state must not look installed or clean.
  const sourceNewCount = count(source, sourceNew)
  const sourceOldCount = count(source, sourceOld)
  const bundleNewCount = count(bundleText, bundleNew)
  const bundleOldCount = count(bundleText, bundleOld)
  const sourceInstalled = sourceNewCount === 1 && sourceOldCount === 0
  const bundleInstalled = bundleNewCount === 1 && bundleOldCount === 0
  const sourceClean = sourceOldCount === 1 && sourceNewCount === 0
  const bundleClean = bundleOldCount === 1 && bundleNewCount === 0
  return {
    source,
    sourceInstalled,
    bundleInstalled,
    sourceClean,
    bundleClean,
    counts: { sourceNewCount, sourceOldCount, bundleNewCount, bundleOldCount }
  }
}
function replaceFile(temp, target) {
  try {
    fs.renameSync(temp, target)
  } catch (error) {
    // Windows can refuse rename-over-existing. Remove the target only after the
    // complete new content is already in the same-directory temp file, and keep
    // the caller's backup so it can restore on failure.
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
    fs.rmSync(target, { force: true })
    fs.renameSync(temp, target)
  }
}
function applyAtomically(sourceText, bundleText, sourceNext, bundleNext) {
  const sourceTemp = `${sourcePath}.dsh-new-session.tmp.${process.pid}`
  const bundleTemp = `${bundlePath}.dsh-new-session.tmp.${process.pid}`
  const sourceBackupPath = `${sourcePath}.dsh-new-session.bak`
  const bundleBackupPath = `${bundlePath}.dsh-new-session.bak`
  let sourceBackedUp = false
  let bundleBackedUp = false
  try {
    if (!fs.existsSync(sourceBackupPath)) {
      fs.copyFileSync(sourcePath, sourceBackupPath)
      sourceBackedUp = true
    }
    if (!fs.existsSync(bundleBackupPath)) {
      fs.copyFileSync(bundlePath, bundleBackupPath)
      bundleBackedUp = true
    }
    fs.writeFileSync(sourceTemp, sourceNext, 'utf8')
    fs.writeFileSync(bundleTemp, bundleNext, 'utf8')
    replaceFile(sourceTemp, sourcePath)
    replaceFile(bundleTemp, bundlePath)
  } catch (error) {
    // Best-effort rollback to the exact in-memory originals.
    try { fs.writeFileSync(sourcePath, sourceText, 'utf8') } catch { /* ignore */ }
    try { fs.writeFileSync(bundlePath, bundleText, 'utf8') } catch { /* ignore */ }
    // Keep backups if they were created; only remove temp files.
    for (const temp of [sourceTemp, bundleTemp]) {
      try { fs.rmSync(temp, { force: true }) } catch { /* ignore */ }
    }
    throw new Error(`atomic patch failed and was rolled back: ${error.message}`)
  }
  return { sourceBackupPath, bundleBackupPath, sourceBackedUp, bundleBackedUp }
}

try {
  const sourceBefore = read(sourcePath)
  const bundleBefore = read(bundlePath)
  const state = stateOf(sourceBefore, bundleBefore)

  if (check) {
    const installed = state.sourceInstalled && state.bundleInstalled
    const report = {
      ok: installed,
      check: true,
      dshIm,
      sourcePatched: state.sourceInstalled,
      bundlePatched: state.bundleInstalled,
      partial: state.sourceInstalled !== state.bundleInstalled,
      sourceChanged: false,
      bundleChanged: false,
    }
    console.log(JSON.stringify(report, null, 2))
    if (!installed) process.exitCode = 1
  } else if (state.sourceInstalled && state.bundleInstalled) {
    console.log(JSON.stringify({
      ok: true, check: false, dshIm,
      sourcePatched: true, bundlePatched: true, partial: false,
      sourceChanged: false, bundleChanged: false, backups: []
    }, null, 2))
  } else {
    if (state.sourceInstalled !== state.bundleInstalled) {
      throw new Error(`partial install detected (source=${state.sourceInstalled}, bundle=${state.bundleInstalled}); refusing to write; restore the backup or reinstall dsh-im`)
    }
    if (!state.sourceClean || !state.bundleClean) {
      throw new Error(`dsh-im /new pattern mismatch (source=${state.sourceClean ? 'ok' : 'changed'}, bundle=${state.bundleClean ? 'ok' : 'changed'}); update the patch for this dsh-im version before applying; no files were written`)
    }
    const sourceNext = state.source.replace(sourceOld, sourceNew)
    const bundleNext = bundleBefore.replace(bundleOld, bundleNew)
    const after = stateOf(sourceNext, bundleNext)
    if (!after.sourceInstalled || !after.bundleInstalled) {
      throw new Error(`patch produced an incomplete or duplicate result (${JSON.stringify(after.counts)}); no files were written`)
    }
    const backups = applyAtomically(sourceBefore, bundleBefore, sourceNext, bundleNext)
    console.log(JSON.stringify({
      ok: true, check: false, dshIm,
      sourcePatched: true, bundlePatched: true, partial: false,
      sourceChanged: true, bundleChanged: true,
      backups: [backups.sourceBackupPath, backups.bundleBackupPath]
    }, null, 2))
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, check, dshIm, error: error.message }, null, 2))
  process.exit(1)
}
