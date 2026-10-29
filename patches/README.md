# dsh-im `/new` bridge patch

`@xmanrui/dsh-im` 5.6.0 handles WeChat `/new` by deleting the conversation
binding in its state store. It does not create a DSH session and does not emit a
host lifecycle event. `dsh-memory-scoped` therefore cannot observe `/new` at the
moment the command is processed without a local hook.

This directory patches the **installed package only**; it does not modify the
upstream repository. It adds one local process event after the binding is
cleared:

```js
globalThis.process.emit('dsh-im/new-session', {
  channel: 'weixin',
  key,
  previousSessionId,
  workspace, // currentConversationWorkspace(key), fallback currentWorkspace()
  at: Date.now()
})
```

The memory plugin checks `channel`, the previous private root, or the current
workspace, and only then schedules the configured private workspace task.

## Apply

```powershell
node .\patches\apply-dsh-im-patch.mjs
# or, for a custom install:
node .\patches\apply-dsh-im-patch.mjs --dsh-im "C:\path\to\dsh-im"
```

Then reload the `@xmanrui/dsh-im` plugin in DSH (or restart DSH Desktop).

`--check` succeeds only when both the source and the runtime bundle contain one
complete applied code block, the old `/new` branch is absent, and the new block
is not duplicated. A marker in a comment, a mixed old+new file, or a duplicated
block fails. Uninstalled or half-installed packages exit 1 and nothing is written:

```powershell
node .\patches\apply-dsh-im-patch.mjs --check
```

The script writes one `.dsh-new-session.bak` beside each changed file the first
time. It is intentionally **fail-loud**: if a dsh-im upgrade changes the source
or the minified `/new` branch, it exits non-zero and leaves the package
untouched, rather than silently losing the event.

## After a dsh-im upgrade

1. Run `apply-dsh-im-patch.mjs` again (or `--check` in a deployment check).
2. Verify `node --check <dsh-im>/lib/index.js`.
3. Reload dsh-im, then send a manual WeChat `/new` (user-run; the release test
   does not send WeChat messages).
4. Confirm the next memory diagnostics show a `wechat-new` trigger or a
   workspace curator run with the expected `sessionIds`.

`dsh-im-weixin-new-session.patch` is the source-level diff for review. The
runtime bundle is minified, so the script patches both representations.

## Safety tests

Run the synthetic patch matrix without touching production:

```powershell
node .\patches\test-patch.mjs
```

Cases: uninstalled (check fails, apply patches, repeat is idempotent), source-only
half install, bundle-only half install, version/pattern mismatch, comment-only
markers, mixed old+new, and duplicate new blocks. Partial, mixed, duplicate, or
mismatched files are never written.

