#!/usr/bin/env node
/**
 * Read-only migration guard for a profile.
 *
 * The old personal bundle ID is deliberately not hardcoded. Pass it with
 * --legacy-id (or DSH_LEGACY_MEMORY_ID) when checking a migration. It fails
 * when both the configured legacy bundle and dsh-memory-scoped are present in
 * the same profile. It never writes or stops DSH.
 *
 * Usage:
 *   node check-migration.mjs --profile <profile-dir> [--legacy-id <old-bundle-id>]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
let profile = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
let legacyId = process.env.DSH_LEGACY_MEMORY_ID ?? ''
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--profile') profile = args[++i]
  else if (args[i] === '--legacy-id') legacyId = args[++i]
  else {
    console.error(`unknown argument: ${args[i]}`)
    process.exit(2)
  }
}
if (legacyId !== '' && legacyId === 'dsh-memory-scoped') {
  console.error('legacy-id must differ from dsh-memory-scoped')
  process.exit(2)
}
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
profile = path.resolve(profile)
const patch = path.join(profile, 'cordis.patch.yml')
const packagePath = path.join(profile, 'package.json')
if (!fs.existsSync(patch)) {
  console.error(JSON.stringify({ ok: false, profile, error: 'cordis.patch.yml not found' }, null, 2))
  process.exit(1)
}
const text = fs.readFileSync(patch, 'utf8')
const packageText = fs.existsSync(packagePath) ? fs.readFileSync(packagePath, 'utf8') : ''
const legacyPattern = legacyId ? new RegExp(escapeRegExp(legacyId)) : null
const oldPresent = legacyPattern !== null && (legacyPattern.test(text) || legacyPattern.test(packageText))
const scopedPresent = /dsh-memory-scoped/.test(text) || /dsh-memory-scoped/.test(packageText)
const ok = !(oldPresent && scopedPresent)
console.log(JSON.stringify({
  ok,
  profile,
  legacyCheck: legacyPattern === null ? 'skipped (pass --legacy-id)' : 'enabled',
  oldPresent,
  scopedPresent,
  action: !ok
    ? 'remove the legacy memory bundle/row before loading dsh-memory-scoped'
    : oldPresent
      ? 'legacy bundle only; it can be removed before installing scoped'
      : scopedPresent
        ? 'scoped bundle only'
        : 'neither bundle present'
}, null, 2))
if (!ok) process.exit(1)
