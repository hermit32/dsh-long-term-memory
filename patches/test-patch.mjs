#!/usr/bin/env node
/**
 * Patch-script safety matrix. Uses synthetic upstream snippets only; it never
 * touches an installed dsh-im package or the production profile.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const script = path.join(root, 'apply-dsh-im-patch.mjs')
const sourceOld = [
  "      if (!hasImages && !hasFiles && command === '/new') {",
  '        await this.#state.clearSession(key);',
  "        await this.#send(sender, t('已开启新会话。请发送你的问题。'), contextToken, runId);",
  '        await this.#state.markSeen(messageId);',
  '        return;',
  '      }'
].join('\n')
const bundleOld = 'if(!y&&!Q&&D==="/new"){await this.#g.clearSession(n),await this.#q(s,S("\\u5DF2\\u5F00\\u542F\\u65B0\\u4F1A\\u8BDD\\u3002\\u8BF7\\u53D1\\u9001\\u4F60\\u7684\\u95EE\\u9898\\u3002"),c,g),await this.#g.markSeen(r);return}'
const event = 'dsh-im/new-session'
const sourceHeader = "export class Fixture {\n  async handle() {\n"
const sourceFooter = '\n  }\n}\n'
const bundleHeader = 'function fixture(y,d,u,Q,n,s,c,g,r){\n'
const bundleFooter = '\n}\n'

function makeFixture(rootDir) {
  fs.mkdirSync(path.join(rootDir, 'src', 'channels', 'weixin'), { recursive: true })
  fs.mkdirSync(path.join(rootDir, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(rootDir, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), sourceHeader + sourceOld + sourceFooter)
  fs.writeFileSync(path.join(rootDir, 'lib', 'index.js'), bundleHeader + bundleOld + bundleFooter)
}
function run(args) {
  const result = spawnSync(process.execPath, [script, '--dsh-im', args.dshIm, ...(args.extra ?? [])], { encoding: 'utf8' })
  return {
    status: result.status,
    out: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    source: fs.readFileSync(path.join(args.dshIm, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), 'utf8'),
    bundle: fs.readFileSync(path.join(args.dshIm, 'lib', 'index.js'), 'utf8')
  }
}
function expect(name, condition, detail = '') {
  if (!condition) throw new Error(`${name} failed ${detail}`)
  console.log(`ok ${name}`)
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-patch-matrix-'))
try {
  // 1. Uninstalled: --check must fail; --apply patches both; --check succeeds.
  const fresh = path.join(base, 'fresh')
  makeFixture(fresh)
  let r = run({ dshIm: fresh, extra: ['--check'] })
  expect('uninstalled check fails', r.status === 1 && !r.out.includes('"ok": true'))
  expect('uninstalled check does not write', !r.source.includes(event) && !r.bundle.includes(event))
  r = run({ dshIm: fresh })
  expect('uninstalled apply patches both', r.status === 0 && r.source.includes(event) && r.bundle.includes(event))
  expect('apply made backups', fs.existsSync(path.join(fresh, 'src', 'channels', 'weixin', 'weixin-bridge.mjs.dsh-new-session.bak')) && fs.existsSync(path.join(fresh, 'lib', 'index.js.dsh-new-session.bak')))
  r = run({ dshIm: fresh, extra: ['--check'] })
  expect('installed check succeeds', r.status === 0 && r.out.includes('"sourcePatched": true') && r.out.includes('"bundlePatched": true'))
  const beforeSource = r.source
  const beforeBundle = r.bundle
  r = run({ dshIm: fresh })
  expect('repeat apply is idempotent', r.status === 0 && r.source === beforeSource && r.bundle === beforeBundle)

  // 2. Half install source-only and bundle-only: check must fail; apply must not write.
  for (const half of ['source', 'bundle']) {
    const dir = path.join(base, half)
    makeFixture(dir)
    const patched = path.join(base, `patched-${half}`)
    makeFixture(patched)
    const applied = run({ dshIm: patched })
    expect(`fixture ${half} patch setup`, applied.status === 0)
    if (half === 'source') {
      fs.copyFileSync(path.join(patched, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), path.join(dir, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'))
    } else {
      fs.copyFileSync(path.join(patched, 'lib', 'index.js'), path.join(dir, 'lib', 'index.js'))
    }
    const sourceBefore = fs.readFileSync(path.join(dir, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), 'utf8')
    const bundleBefore = fs.readFileSync(path.join(dir, 'lib', 'index.js'), 'utf8')
    r = run({ dshIm: dir, extra: ['--check'] })
    expect(`half ${half} check fails`, r.status === 1 && r.out.includes('"ok": false'))
    r = run({ dshIm: dir })
    expect(`half ${half} apply fails`, r.status === 1 && r.out.includes('partial install'))
    expect(`half ${half} apply does not write`, r.source === sourceBefore && r.bundle === bundleBefore)
  }

  // 3. Version/pattern mismatch: no writes.
  const mismatch = path.join(base, 'mismatch')
  makeFixture(mismatch)
  const sourcePath = path.join(mismatch, 'src', 'channels', 'weixin', 'weixin-bridge.mjs')
  fs.writeFileSync(sourcePath, sourceHeader + sourceOld.replace('await this.#state.clearSession(key);', 'await this.#state.clearSession(key); // upstream changed') + sourceFooter)
  const sourceBefore = fs.readFileSync(sourcePath, 'utf8')
  const bundleBefore = fs.readFileSync(path.join(mismatch, 'lib', 'index.js'), 'utf8')
  r = run({ dshIm: mismatch })
  expect('version mismatch apply fails', r.status === 1 && r.out.includes('pattern mismatch'))
  expect('version mismatch does not write', r.source === sourceBefore && r.bundle === bundleBefore)
  r = run({ dshIm: mismatch, extra: ['--check'] })
  expect('version mismatch check fails', r.status === 1 && r.out.includes('"ok": false'))

  // 4. Mixed old+new and duplicate new blocks: neither is a valid install and
  // apply must not touch the files.
  const patchedSource = fs.readFileSync(path.join(fresh, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), 'utf8')
  const patchedBundle = fs.readFileSync(path.join(fresh, 'lib', 'index.js'), 'utf8')
  for (const mode of ['mixed', 'duplicate']) {
    const dir = path.join(base, mode)
    makeFixture(dir)
    const sourceFile = path.join(dir, 'src', 'channels', 'weixin', 'weixin-bridge.mjs')
    const bundleFile = path.join(dir, 'lib', 'index.js')
    if (mode === 'mixed') {
      fs.writeFileSync(sourceFile, `${patchedSource}\n${sourceOld}\n`)
      fs.writeFileSync(bundleFile, `${patchedBundle}\n${bundleOld}\n`)
    } else {
      fs.writeFileSync(sourceFile, `${patchedSource}\n${patchedSource}\n`)
      fs.writeFileSync(bundleFile, `${patchedBundle}\n${patchedBundle}\n`)
    }
    const sourceBefore = fs.readFileSync(sourceFile, 'utf8')
    const bundleBefore = fs.readFileSync(bundleFile, 'utf8')
    r = run({ dshIm: dir, extra: ['--check'] })
    expect(`${mode} old/new check fails`, r.status === 1 && r.out.includes('"ok": false'))
    r = run({ dshIm: dir })
    expect(`${mode} old/new apply fails`, r.status === 1)
    expect(`${mode} old/new apply does not write`, r.source === sourceBefore && r.bundle === bundleBefore)
  }

  // 5. Comment-only markers: no active /new branch, so --check and apply must fail.
  const comments = path.join(base, 'comments')
  fs.mkdirSync(path.join(comments, 'src', 'channels', 'weixin'), { recursive: true })
  fs.mkdirSync(path.join(comments, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(comments, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), sourceHeader + '// ' + event + '\\n// const previousSessionId = this.#state.sessionFor(key)\\n' + sourceFooter)
  fs.writeFileSync(path.join(comments, 'lib', 'index.js'), bundleHeader + '// ' + event + '\\n// let _prev=this.#g.sessionFor(n)\\n' + bundleFooter)
  const csource = fs.readFileSync(path.join(comments, 'src', 'channels', 'weixin', 'weixin-bridge.mjs'), 'utf8')
  const cbundle = fs.readFileSync(path.join(comments, 'lib', 'index.js'), 'utf8')
  r = run({ dshIm: comments, extra: ['--check'] })
  expect('comment-only markers check fails', r.status === 1 && r.out.includes('"ok": false'))
  r = run({ dshIm: comments })
  expect('comment-only markers apply fails', r.status === 1 && r.out.includes('pattern mismatch'))
  expect('comment-only markers apply does not write', r.source === csource && r.bundle === cbundle)

  console.log(JSON.stringify({ ok: true, base }, null, 2))
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
