# CLAUDE.example.md — memory usage rules for the private workspace (EXAMPLE)

> This file holds the *memory rules*, not the persona. Copy it to
> `<private workspace>\CLAUDE.md` (or `AGENTS.md`) and adjust the numbers to the
> values you set in the profile. It is loaded by DSH's instruction loader, the
> same way `AGENTS.md` is.

## What the memory is for

- Keep: long-lived preferences, habits, durable facts the user states about
  themselves, real completed work, and decisions or lessons worth reusing.
- Do not keep: greetings, small talk, one-off details, repeated facts, whole
  conversations, per-turn summaries, guesses, or credentials.
- Curation is automatic and asynchronous. Each session accumulates its own count
  of effective turns; when that session reaches `curateEveryTurns` (default 20),
  the background curator reviews the recent part of that session. A workspace
  does **not** pool turns across sessions in this release.
- An empty curation result is normal: it writes nothing and moves the cursor
  forward.

## When to write explicitly

- When the user says "remember this" (or equivalent), call `memory_add`.
- At the end of a project or task, write 1–3 durable items if there are any;
  otherwise skip.
- To correct or forget something, first `memory_search` for the entry, then
  `memory_update` or `memory_delete`. Never delete by guesswork.
- Before adding, search the same topic; update the existing entry instead of
  creating a near-duplicate.

## Scope

- Scope is fixed to `workspace`; `global` and `project` are rejected by the
  plugin.
- IM (e.g. WeChat) and desktop sessions of the same private workspace share one
  memory because the scope key is derived from the workspace path.
- Other workspaces neither read nor write this memory. The plugin gates every
  tool call on an exact workspace-path match plus a root-session check, and the
  prompt injection returns an empty string elsewhere.

## Boundaries

- The user's latest statement wins over an old memory. Update or delete the old
  entry instead of keeping both.
- Do not write uncertain information. "Probably" is not a memory.
- Credentials (API keys, tokens, passwords, private keys) are always refused;
  there is no override flag.
- Do not put persona text, tone instructions or behavioural rules into memory.
