> **历史 RC3 验收记录（脱敏副本）**：记录的是发布前候选测试与限制。本文的“未上传 GitHub / 未就绪”描述为当时状态；v0.2.0 已以**技术预览版**形式公开，未完成的真实微信/外部模型/冷启动验收仍然未完成。

# dsh-memory-scoped 0.2.0-rc3

Public release candidate; based on GitHub `dsh-memory-scoped` v0.1.0
(package internal `0.6.0-local.1`). Package name, loader row, settings namespace
and client bundle remain `dsh-memory-scoped`.

## Added in this candidate

- Workspace-level effective-turn accounting: sum of pending turns over all
  owned root sessions in the configured private workspace; `lifetimeTurns` is
  not used for triggering.
- Cross-session batching: up to 8 sessions per batch, up to 8 batches (64
  sessions) per task; 17 sessions drain in 3 batches; remaining sessions are
  recorded as `deferredSessionIds`.
- Per-session cursor, transcript, provenance and failure boundary; successful
  or empty batches advance only their own cursor.
- Desktop `startup` trigger; `resume`/open-existing, subagents and other
  workspaces do not trigger.
- WeChat `/new` local process bridge via the dsh-im patch.
- Attribution context now carries transcript lines, so curator proposals are
  not silently dropped.
- Cursor-save failure recovery: record and owned ledger are restored; retry is
  duplicate-safe.
- Structured patch `--check`: complete new block must be unique and the old branch
  absent; comment-only, mixed old+new and duplicate blocks fail. Atomic writes
  with rollback remain.
- Release check rejects non-zero test processes and failed-test counts; reverse
  test included.
- MCP hardening: the standalone server rejects `allowSecret`, always scans
  `memory_add`/`memory_update`/`memory_merge`, restricts scopes to
  `DSH_MEMORY_ALLOWED_ROOTS` (`global` is opt-in via
  `DSH_MEMORY_ALLOW_GLOBAL=1`), rejects duplicate merge ids, and scans the
  final merged content plus the merged tag union. Merge planning lives in the
  single `planMergeEntries()` store export; the store validates that exact plan
  before writing. A fail-closed MCP gate was added to
  `scripts/check-release.mjs`.
- Migration guard and docs; old personal-named bundle must not be loaded at the
  same time.
- Old deployment scripts (`start-dsh-logged.ps1`, `restart-dsh.ps1`,
  `sync-install.ps1`, `verify-after-restart.ps1`) are excluded from this
  candidate; no script stops a running production process.

## Tests

- Unit: 187 tests / 184 pass / 3 skip / 0 fail.
- MCP security: 22/22 disk- and journal-verified tests (allowSecret, add/update/
  merge content and tag credentials, duplicate merge ids, request-order
  permutations with equal-length content and the 16-tag cap, error echo, delete
  journal redaction, `DSH_MEMORY_REDACT=0`, scope escape, legacy-entry policy).
- Merge plan: 3/3 (pure `planMergeEntries()` semantics, validator veto leaves
  raw unchanged, safe `normalizeTags` error).
- Integration: `abc`, `wechat`, `partial`, `deferred`, `fault` all pass.
- Patch matrix: uninstalled/installed/repeat/source-only/bundle-only/mismatch/
  comment-only all pass.
- Release check and negative release check pass.
- Migration guard: old-only pass; old+scoped fail.
- Sanitization scan: 0 private matches.
- ZIP: POSIX paths, SHA256 list.

## Not verified

- Real WeChat `/new` (owner must send; this package never sends).
- Real external model 20 turns.
- Full DSH Desktop restart.
- Acceptance harness was not rerun after the MCP-only change (peer packages are
  not installed in this workspace); curator code is untouched.
- Background-created fresh private root distinction.
- More than 64 pending sessions remain deferred.
- dsh-im upgrades require replaying the patch.

**Do not describe this as ready for public release until the manual checks above
are complete.**
