#!/usr/bin/env node
/**
 * Negative test for scripts/check-release.mjs.
 *
 * Builds a temporary package whose test command has 187 tests with one failing
 * test. The release check must NOT print OK / exit 0: it must notice both the
 * non-zero test process exit and the failed-test count.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-check-release-negative-'))
try {
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(root, 'check-release.mjs'), path.join(tmp, 'scripts', 'check-release.mjs'))
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'dsh-memory-scoped',
    version: '0.2.0',
    scripts: { test: 'node --test fake-tests.test.js' }
  }, null, 2))
  fs.writeFileSync(path.join(tmp, 'README.md'), 'Current release: **0.2.0**\n\nruns 187 tests\n')
  fs.writeFileSync(path.join(tmp, 'README.zh.md'), '当前版本：**0.2.0**\n\n运行 187 项测试\n')
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '## 0.2.0 (2026-10-30)\n')
  const tests = []
  for (let i = 0; i < 186; i += 1) tests.push(`test('ok ${i}', () => {})`)
  tests.push("test('deliberate failure', () => { throw new Error('synthetic release-gate failure') })")
  fs.writeFileSync(path.join(tmp, 'fake-tests.test.js'), "import test from 'node:test'\n" + tests.join('\n') + '\n')
  const result = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'check-release.mjs')], { cwd: tmp, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const ok = result.status !== 0 && !output.includes('[check-release] OK')
  console.log(JSON.stringify({
    ok,
    status: result.status,
    sawExitFailure: output.includes('test process exit code'),
    sawFailCount: output.includes('actual failed tests'),
    output: output.split('\n').slice(-12)
  }, null, 2))
  if (!ok) process.exit(1)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
