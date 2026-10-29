# AGENTS.global.example.md — global rules shared by every workspace (EXAMPLE)

> Copy this to `<DSH_HOME>/AGENTS.md` (normally `~/.dsh/AGENTS.md`) and replace
> every `<...>` placeholder. This is a **template**; the example workspace names
> and paths are fictional.

# Global rules for all Harness workspaces

This machine runs exactly one IM bot. The private workspace
`C:\Workspaces\private` receives and answers IM messages. Other workspaces only
send outgoing text through the notification script described here; they never
change the bot binding, the workspace routing, or the reply path.

If the current workspace has a more specific rule, that rule wins.

## Sending a notification

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Workspaces\private\.dsh\assistant\notify.ps1" -Workspace "<LABEL>" -Title "<TITLE>" -Message "<TEXT>"
```

Parameters:

- `-Workspace`: optional label shown at the top of the message. When omitted the
  script derives it from the current directory (via the workspace registry or
  `workspace-labels.json`).
- `-Title`: optional single line, e.g. `Task finished`, `Task failed`,
  `Needs attention`.
- `-Message`: required body. For long text use `-TextFile "<absolute path>"`.
- `-Force`: only when the same text really must be sent twice; identical text is
  deduplicated for 10 minutes by default.
- `-Status` / `-FlushQueue`: diagnostics and manual resend only.

State (dedupe marks, offline queue, log) lives in `<workspace>\.dsh-notify` for
non-private workspaces, and in the central `<DSH_HOME>\assistant` directory for
the private workspace.

```powershell
# Resend this workspace's queued messages
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<path>\notify.ps1" -FlushQueue

# Resend the central queue plus every registered workspace queue
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<path>\notify.ps1" -FlushQueue -AllWorkspaces
```

Resending is an explicit command. It does **not** depend on any watchdog: the
watchdog scheduled task is disabled in this deployment, so a failed message is
never retried automatically.

## Notification policy

- Short task: one concise notification when it finishes.
- Long task: acknowledge, report at key milestones, then report the result; do
  not narrate every step.
- Notify on failure, on a blocked step that needs a human, and on significant
  events.
- Do not notify when a routine poll finds nothing new; do not repeat an event.
- Include the result, artifact paths, problems and next step. "Done" alone is
  not a notification.
- Never send API keys, tokens, passwords, private file contents or other
  secrets.
- A notification never changes the current workspace and never changes the IM
  bot binding.

## Boundaries

- The script only posts text to the local Host. The Host port changes on every
  start; the script discovers and verifies it at run time
  (`lib\dsh-host.ps1`). Never hard-code a port in a document, script or config.
- The script does not execute anything in the private workspace and accepts no
  command arguments.
- Other workspaces must not edit the IM integration directory
  (`<DSH_HOME>\integrations\<im-plugin>`).
- Replies are always produced by the private workspace. Other workspaces must
  not try to answer IM messages or switch the bot's workspace.
- Do not use `-NoPrefix` to hide the source; it exists for diagnostics only.
