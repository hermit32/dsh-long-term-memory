# Changelog

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
