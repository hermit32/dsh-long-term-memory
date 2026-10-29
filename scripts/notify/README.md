# Shared notification outlet (`notify/`)

One IM bot, one private workspace that receives and answers messages, and any
number of other workspaces that can only push text out. This directory holds the
outgoing half.

## Files

| File | Purpose |
| --- | --- |
| `notify.ps1` | The command every workspace calls. Discovers the Host, dedupes, queues on failure, and logs. |
| `lib/dsh-host.ps1` | Locates and verifies the running Host. No port is ever hard-coded. |
| `notify-config.example.json` | Copy to `notify-config.json` next to `notify.ps1` and fill in the placeholders. |
| `workspace-labels.example.json` | Copy to `workspace-labels.json` next to `notify.ps1` to control the label shown for each workspace root. |

`notify.ps1` resolves `notify-config.json`, `workspace-labels.json` and `lib/`
relative to its own location, so the whole directory can live anywhere. The
examples above are the two files it expects next to itself.

## How the Host is found (no fixed port)

The Host listens on a different loopback port on every start. `lib/dsh-host.ps1`
therefore:

1. accepts only loopback literals (`127.0.0.1`, `localhost`, `::1`) — a URL
   pointing anywhere else is rejected before a byte is sent;
2. resolves the PID that owns each candidate listening port and requires that
   process's executable path to equal `appExe` from `notify-config.json`;
3. requires the candidate to answer the dsh-im delivery route probe with
   `404 unknown-bot` / `404 unknown-target` — an impostor that returns
   `{"sent":true}` is rejected;
4. treats ambiguous results (several ports answering) as a failure, not a guess.

This is why there is no port to edit, and why a stale `endpoint` override cannot
bypass the checks: the override is verified with the same rules.

## Behaviour

- **Deduplication**: identical text is suppressed for 10 minutes by default
  (`-DedupeWindowMinutes`, 1–1440). `-Force` bypasses it for a deliberate resend.
- **Offline queue**: when the Host is unreachable the message is written to an
  append-only JSONL queue (bounded by `maxQueueItems`, entries expire after
  `maxQueueAgeDays`). Exit code `2` means "queued".
- **Resend**: `-FlushQueue` drains this workspace's queue; `-FlushQueue
  -AllWorkspaces` drains the central queue plus every registered workspace
  queue. Resend is an explicit command.
- **Atomic writes**: queue and state files are written to a temp file and
  replaced; a corrupted queue is copied aside before being parsed.
- **Locking**: queue read-modify-write is serialised by a lock file with a
  timeout, so concurrent notifications do not lose entries.

## Isolation model

- The private workspace is the only IM-bound workspace. It receives messages and
  produces replies.
- Workspace A and Workspace B run the same script with the same `notify-config.json`. They can
  send text; they cannot change the bot, the target, or the reply route.
- The bot id and target id live only in the central `notify-config.json`
  (read-only for other workspaces), and `Send-Delivery` posts exactly those two
  ids. There is no parameter to pick a different bot or target.
- `-Workspace` only changes the human-readable prefix. It is not an
  authorisation: omitting or spoofing it cannot obtain reply rights.
- Each non-private workspace keeps its own `.dsh-notify` state directory in its
  own root; the private workspace keeps the central state.

## Required local configuration

1. Copy `notify-config.example.json` to `notify-config.json`.
2. Set `appExe` to the **exact absolute path** of the running Harness executable
   (case-insensitive, must match the process's `ExecutablePath`).
3. Set `botId` and `targetId` to the values created by your IM integration. Both
   are machine-local secrets of a sort: never commit them.
4. Optionally set `endpoint` to pin one verified URL (rarely needed; the Host
   port normally changes).
5. Create `workspace-labels.json` if the automatic leaf-directory label is not
   what you want.

## Known limitations (not fixed in this release)

- **The local delivery route itself has no authentication.** `notify.ps1`
  verifies the target is a loopback listener owned by the Harness executable, but
  any local process that knows the port could POST to the same route directly.
  This is a property of the upstream IM plugin's local delivery API, not of this
  script. Treat the machine as trusted, and do not expose the Host port.
- **No automatic retry.** The watchdog scheduled task is disabled in the
  deployment this package was derived from, and the watchdog script is not
  included here. Failed messages stay queued until someone runs `-FlushQueue`.
- **Windows/PowerShell only.** The script depends on `Get-NetTCPConnection` (with
  a `netstat` fallback) and `Get-CimInstance`.
- **One-way by design.** There is no inbound path in this directory. Incoming IM
  messages are handled by the IM plugin inside the private workspace.
- **`DSH_HOME` support was added for this release.** The deployed copy hard-coded
  `~/.dsh`; the published copy honours `$env:DSH_HOME` first. If you diff it
  against a running install, expect that difference plus the removed personal
  default `appExe`.
