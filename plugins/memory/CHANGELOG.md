# Changelog

## 0.2.1 (2026-11-03)

Maintenance patch: the host Cordis tools now share the standalone MCP write
guards, and the release gate itself works from Windows checkouts whose path
contains non-ASCII characters.

### Host/MCP write-path parity

- `lib/store.js` now owns `assertNoSecrets()`, `assertNoSecretTags()` and
  `journalEntrySnapshot()`; `bin/dsh-memory-mcp.mjs` imports them instead of
  keeping a private copy, so the two entry points cannot drift apart.
- Host `memory_add` scans normalized tags as well as content; `memory_update`
  validates the final stored state (content + tags), so an unrelated edit can no
  longer preserve a legacy credential; `memory_delete` journals a redacted
  snapshot; `memory_merge` rejects duplicate ids and an invalid `keepId` and
  validates every participant plus the exact `planMergeEntries()` output before
  writing. None of these change the store's merge rules; they only add checks.
- Added `test/host-security.test.js` (5 tests). `scripts/check-release.mjs` now
  gates the host guard calls, the duplicate-id/plan validator, and parses every
  shipped entry point with `node --check` — a syntax error in `lib/index.js` used
  to pass the whole gate when the host-wiring smoke test skipped for missing
  peer packages. Suite is 192 tests (189 pass / 3 skip / 0 fail).

### Release tooling fixes

- `patches/test-patch.mjs` and `scripts/check-release-negative.mjs` resolve
  their own directory with `fileURLToPath`, so they run from checkouts whose
  path contains non-ASCII characters (for example `X:\AI\实验室\...`). Both
  scripts previously percent-encoded the path and failed before testing anything.
- `tests/privacy-scan.ps1` no longer flags the documented sanitized placeholder
  account `C:\Users\example\...` used by fixtures and evidence; any other user
  segment is still reported.

## 0.2.0 (2026-10-30)

Final RC3 polish for the public v0.2.0 line: workspace-total threshold doc fix,
strict patch check (old branch absent, new block unique), configurable legacy
migration ID, standalone config example/path fixes, and release tests/SHA.

### MCP hardening (P0)

- The standalone MCP server no longer accepts `allowSecret`: the schema does not
  declare it and passing it is an explicit error. `memory_update` and
  `memory_merge` now run the same credential scan as `memory_add`, and no
  environment variable can disable write-time rejection (`DSH_MEMORY_REDACT`
  was removed).
- MCP scopes are deny-by-default: `workspace`/`project` resolve only inside a
  root listed in `DSH_MEMORY_ALLOWED_ROOTS`, `global` requires
  `DSH_MEMORY_ALLOW_GLOBAL=1`, and unknown scope values are rejected instead of
  falling back to `global`. Client-supplied `cwd` no longer mints arbitrary
  scopes.
- Second audit fixes: `memory_merge` rejects duplicate ids before scanning (the
  previous `targets.length === ids.length` guard could be bypassed by repeating
  an id), validates that every id exists and `keepId` is one of them, and scans
  the final merged content plus the merged tag union before the write.
  `memory_add` / `memory_update` / `memory_merge` now scan the final tags as
  well as content, and `memory_update` validates the final stored state so a
  legacy credential cannot survive an unrelated edit.
- Third audit (root cause): merge planning moved into the single pure
  `planMergeEntries()` export in `lib/store.js`; the MCP no longer re-implements
  the longest-content, tag-union, 16-tag-cap or ordering rules.
  `mergeRawEntries(ids, keepId, { validate })` builds the plan in raw-file order
  and calls the validator with that exact plan and its targets before
  `writeAtomic`, so the checked object and the persisted object cannot diverge.
  Every participant's content and tags are scanned, which also keeps a removed
  entry's credential out of the journal delete events.
- `memory_delete` now journals a tainted entry with redacted content/tags;
  `normalizeTags` and the MCP unknown-scope/unknown-tool/missing-entry errors no
  longer echo caller input. Added `test/merge-plan.test.js` and 6 MCP cases; the
  suite is now 187 tests (22 MCP security tests).

## 0.6.0-local.2 (2026-10-29)

### Workspace-level curation port

- The threshold is now the sum of `pendingTurns` over all owned root sessions in
  the configured private workspace; `lifetimeTurns` is display-only.
- One workspace task selects all pending owned sessions oldest-first and runs
  them in sequential batches of up to 8 sessions. Up to 8 batches (64 sessions)
  chain automatically; 17 sessions drain in 3 batches. Remaining sessions are
  recorded in `deferredSessionIds`.
- Each session keeps its own cursor, transcript and provenance. Only successful
  or empty batches advance that session. Failed batches remain pending.
- Desktop trigger: `agent/created` with `source: "startup"` and a private root;
  `resume`, subagents and other workspaces do not trigger.
- WeChat `/new`: local dsh-im `dsh-im/new-session` process event after clearing
  the binding; the memory plugin verifies the workspace/previous root.
- Fixed attribution context: transcript lines are now passed to
  `attributeOperation`, so curator proposals are no longer silently dropped as
  “not enough overlap”.
- Fixed cursor-save interruption: `completeCurate` restores the record and
  `owned` ledger if the pending write fails; retry is duplicate-safe.
- Added unit/source tests, `acceptance/curator-harness.mjs`, release-check script,
  patch safety matrix, sanitized docs and package.
- Removed all `allowSecret` bypass documentation: the parameter does not exist.

## 0.6.0-local.1

Public scoped baseline (152 tests) before the unified workspace scheduler.
