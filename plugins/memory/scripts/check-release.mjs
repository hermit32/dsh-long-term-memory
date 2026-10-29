#!/usr/bin/env node
// Release consistency check (zero dependencies; node builtins only).
//
// Verifies that the version and test-count claims in the prose stay in sync
// with the code:
//   1. package.json version
//   2. CHANGELOG.md newest "## <version>" heading
//   3. README.md "Current release: **<version>**" and README.zh.md "当前版本：**<version>**"
//   4. the test count declared in both READMEs ("runs N tests" / "运行 N 项测试")
//      vs the actual "# tests N" summary of the package.json test script
//
// The README test-count line format is a contract for this script; if either
// wording changes, update both the README and this script together.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// fileURLToPath, not URL.pathname: on Windows the latter yields "/E:/…", which
// path.join turns into a drive-relative "E:\E:\…" and the check cannot run.
const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

let failed = false
function fail(what, expected, actual) {
  failed = true
  console.error(`[check-release] ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function read(name) {
  return readFileSync(join(root, name), 'utf8')
}

// 1. CHANGELOG newest heading.
const changelog = read('CHANGELOG.md')
const changelogMatch = changelog.match(/^##\s+(\S+)/m)
if (changelogMatch === null) {
  fail('CHANGELOG.md newest version heading', version, '(no "## <version>" heading found)')
} else if (changelogMatch[1] !== version) {
  fail('CHANGELOG.md newest version heading', version, changelogMatch[1])
}

// 2. README version claims.
const readmeEn = read('README.md')
const readmeZh = read('README.zh.md')
const enVersion = readmeEn.match(/Current release:\s*\*\*([^\s*]+)\*\*/)
const zhVersion = readmeZh.match(/当前版本：\s*\*\*([^\s*]+)\*\*/)
if (enVersion === null) {
  fail('README.md "Current release: **X**"', version, '(pattern not found)')
} else if (enVersion[1] !== version) {
  fail('README.md current release', version, enVersion[1])
}
if (zhVersion === null) {
  fail('README.zh.md "当前版本：**X**"', version, '(pattern not found)')
} else if (zhVersion[1] !== version) {
  fail('README.zh.md current release', version, zhVersion[1])
}

// 3. Test-count claims vs the actual suite summary.
const enCount = readmeEn.match(/runs\s+(\d+)\s+tests/)
const zhCount = readmeZh.match(/运行\s+(\d+)\s+项测试/)
if (enCount === null || zhCount === null) {
  fail('README test-count pattern', '"runs N tests" and "运行 N 项测试"', `${enCount === null ? 'en missing' : 'ok'} / ${zhCount === null ? 'zh missing' : 'ok'}`)
}
const declared = enCount !== null ? enCount[1] : zhCount !== null ? zhCount[1] : null
if (enCount !== null && zhCount !== null && enCount[1] !== zhCount[1]) {
  fail('README test counts agree', enCount[1], zhCount[1])
}

const testScript = pkg.scripts && pkg.scripts.test
if (typeof testScript !== 'string') {
  fail('package.json scripts.test', 'a "node --test ..." command', '(missing)')
} else {
  const args = testScript.replace(/^node\s+--test\s*/, '').trim().split(/\s+/).filter(Boolean)
  // `node --test` with no file arguments is a valid Node test command: it
  // discovers the package's test files. Do not reject it as "no test files".
  // Pin the TAP reporter: Node 25 defaults to `spec` (`\u2139 tests N`) whenever
  // stdout is not a TTY, which this parser cannot read. `--test-reporter` exists
  // on every Node this package supports (engines: >=20.3); the fallback pattern
  // keeps the check readable if a runtime ever ignores the flag.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...args], { encoding: 'utf8', cwd: root })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  // A passing test-count summary is not enough: a failing test process (or a
  // test file with failed tests) must fail the release check too.
  if (result.error !== undefined) {
    fail('test process spawn', 'successful spawn', result.error.message)
  } else if (result.status !== 0) {
    fail('test process exit code', 0, result.status)
  }
  const failSummary = output.match(/#\s*fail\s+(\d+)/) ?? output.match(/\u2139\s+fail\s+(\d+)/)
  if (failSummary !== null && failSummary[1] !== '0') {
    fail('actual failed tests', 0, failSummary[1])
  }
  const summary = output.match(/#\s*tests\s+(\d+)/) ?? output.match(/\u2139\s+tests\s+(\d+)/)
  if (summary === null) {
    fail('actual test summary ("# tests N")', 'a parseable summary', '(nothing matched; run npm test manually)')
  } else if (declared !== null && summary[1] !== declared) {
    fail('README declared test count', declared, summary[1])
  }
}

// 4. MCP security gate. The standalone stdio server is shipped as a bin, so a
// regression there would not be caught by the host-plugin tests alone.
const MIN_MCP_SECURITY_TESTS = 22
const mcpBin = join(root, 'bin', 'dsh-memory-mcp.mjs')
if (!existsSync(mcpBin)) {
  fail('MCP server file', 'bin/dsh-memory-mcp.mjs', '(missing)')
} else {
  const mcpSource = readFileSync(mcpBin, 'utf8')
  if (/allowSecret\s*:/.test(mcpSource)) {
    fail('MCP schema', 'no allowSecret declaration', 'found "allowSecret:" in bin/dsh-memory-mcp.mjs')
  }
  const guardCalls = mcpSource.split('\n').filter((line) => line.includes('assertNoSecrets(') && !line.includes('function ')).length
  if (guardCalls < 3) {
    fail('MCP write-path credential guards', '>= 3 assertNoSecrets calls (add/update/merge)', guardCalls)
  }
  const tagGuardCalls = mcpSource.split('\n').filter((line) => line.includes('assertNoSecretTags(') && !line.includes('function ')).length
  if (tagGuardCalls < 3) {
    fail('MCP tag credential guards', '>= 3 assertNoSecretTags calls (add/update/merge)', tagGuardCalls)
  }
  if (!mcpSource.includes('duplicate entry ids are not allowed')) {
    fail('MCP merge duplicate-id guard', 'duplicate ids rejected before the scan', '(missing)')
  }
  if (mcpSource.includes('normalizedContent')) {
    fail('MCP merge plan duplication', 'MCP must defer to MemoryStore planMergeEntries', 'found normalizedContent in bin/dsh-memory-mcp.mjs')
  }
  const deleteSnapshotCalls = mcpSource.split('\n').filter((line) => line.includes('journalEntrySnapshot(') && !line.includes('function ')).length
  if (deleteSnapshotCalls < 1) {
    fail('MCP delete journal redaction', 'journalEntrySnapshot(entry) used for the delete event', deleteSnapshotCalls)
  }
  if (!mcpSource.includes('validate: (plan, targets)')) {
    fail('MCP merge validator', 'mergeRawEntries called with validate(plan, targets)', '(missing)')
  }
  const storeSource = readFileSync(join(root, 'lib', 'store.js'), 'utf8')
  if (!storeSource.includes('export function planMergeEntries')) {
    fail('MemoryStore merge plan', 'exported planMergeEntries pure function', '(missing)')
  }
  if (!storeSource.includes('options.validate')) {
    fail('MemoryStore merge validation hook', 'validate(plan, targets) before writeAtomic', '(missing)')
  }
  if (storeSource.includes('characters: ${tag}')) {
    fail('MemoryStore tag error', 'no caller tag value in the error', 'found an echoed tag')
  }
  if (!mcpSource.includes('DSH_MEMORY_ALLOWED_ROOTS') || !mcpSource.includes('DSH_MEMORY_ALLOW_GLOBAL')) {
    fail('MCP scope allow-list', 'DSH_MEMORY_ALLOWED_ROOTS and DSH_MEMORY_ALLOW_GLOBAL', '(missing)')
  }
}

const mcpSecurityTest = join(root, 'test', 'mcp.security.test.js')
if (!existsSync(mcpSecurityTest)) {
  fail('MCP security regression test', 'test/mcp.security.test.js', '(missing)')
} else {
  const securityRun = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/mcp.security.test.js'], {
    encoding: 'utf8',
    cwd: root
  })
  const securityOutput = `${securityRun.stdout ?? ''}\n${securityRun.stderr ?? ''}`
  if (securityRun.error !== undefined) {
    fail('MCP security test spawn', 'successful spawn', securityRun.error.message)
  } else if (securityRun.status !== 0) {
    fail('MCP security test exit code', 0, securityRun.status)
  }
  const securityFail = securityOutput.match(/#\s*fail\s+(\d+)/)
  if (securityFail === null) {
    fail('MCP security test summary', 'a parseable "# fail N" line', '(nothing matched)')
  } else if (securityFail[1] !== '0') {
    fail('MCP security test failures', 0, securityFail[1])
  }
  const securityCount = securityOutput.match(/#\s*tests\s+(\d+)/)
  if (securityCount === null) {
    fail('MCP security test count', `>= ${MIN_MCP_SECURITY_TESTS}`, '(nothing matched)')
  } else if (Number(securityCount[1]) < MIN_MCP_SECURITY_TESTS) {
    fail('MCP security test count', `>= ${MIN_MCP_SECURITY_TESTS}`, securityCount[1])
  }
}

if (failed) {
  console.error('[check-release] FAILED: release docs are out of sync — fix the mismatch above (see scripts/check-release.mjs).')
  process.exit(1)
}
console.log(`[check-release] OK: version ${version}, ${declared} tests declared and verified.`)
