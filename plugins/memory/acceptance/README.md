# Isolated Curator acceptance harness

This harness executes the real `apply()`, `runWorkspaceCurator`, `runCurator`,
`applyCuratorOperations`, journal, provenance and cursor code. It uses only:

- a temporary workspace directory,
- a temporary memory directory,
- synthetic `user/message` / `assistant/message` events,
- a deterministic in-process LLM stream (no external model call),
- no production memory, sessions, WeChat credentials or network.

It is intentionally outside `test/` so `node --test` does not discover it; the
normal unit suite stays dependency-free.

## Requirements

The plugin's `lib/index.js` imports `@deepseek-ai/dsh-llm`,
`@deepseek-ai/dsh-tools`, and `@deepseek-ai/schemastery` (plus their transitive
packages). Run from a DSH profile that can resolve those packages, or place a
copy of the installed `@deepseek-ai` dependency tree next to this plugin. The
harness does not install anything and does not touch a live DSH profile.

## Run

From the plugin package root:

```powershell
node acceptance/curator-harness.mjs all
node acceptance/curator-harness.mjs abc
node acceptance/curator-harness.mjs wechat
node acceptance/curator-harness.mjs partial
node acceptance/curator-harness.mjs deferred
node acceptance/curator-harness.mjs fault
```

Modes:

| Mode | What it proves |
|---|---|
| `abc` | A=8/B=6/C=6 workspace task writes three memories, cursor/pending per session, provenance source session; `resume` does not trigger, `startup` does |
| `wechat` | `process.emit('dsh-im/new-session')` is actually received by the memory plugin; foreign workspace event is ignored; private workspace event triggers A/B/C |
| `partial` | A raw entry already exists and pending remains; retry is duplicate-safe and advances only after success |
| `deferred` | 17 sessions drain in three 8/8/1 batches; final pending 0 and at least three run logs |
| `fault` | The raw write succeeds, then the cursor save is interrupted by a test fault injection; pending/cursor stay unchanged (6/0); retry writes no duplicate and reaches 0/6 |

`fault` fails only the first post-raw `writePendingTurns` call; it does not
simulate a process kill. The cursor/owned rollback is in `completeCurate`:
if the pending write fails, the in-memory record and `owned` ledger are restored
before `failCurate` saves the attempt.

## Cleanup

Every fixture is created under the OS temp directory and removed in `finally`.
The harness never reads `$DSH_HOME/memories`, `~/.dsh`, or the production
plugin directory.
