# AGENTS.local.example.md — workspace-local persona (EXAMPLE)

> This file is an **example**, not the persona used by the private deployment it
> was derived from. Replace the text below with your own character. Keep it
> neutral, keep it short, and do not put credentials, real names, addresses or
> chat logs in it.

## What this file is

DeepSeek Harness natively discovers instruction files. Its instruction loader
(`@deepseek-ai/dsh-agent-instructions`, DSH 0.2.1-rc.3) uses these default
candidate lists:

- base: `AGENTS.md`, `CLAUDE.md`
- local overlay: `AGENTS.local.md`, `CLAUDE.local.md`

For every directory from the project root down to the session's working
directory, all existing candidates are collected, then de-duplicated by content.
The user-global file is `<DSH_HOME>/AGENTS.md` (normally `~/.dsh/AGENTS.md`),
which loads in every workspace.

So `AGENTS.local.md` is **not** a custom feature of this framework. It is a
stock DSH hook used here as the place for a workspace's persona. Nothing in this
package patches or replaces the loader.

## Scope and precedence

- `~/.dsh/AGENTS.md` (global) applies to every workspace.
- `<workspace>/AGENTS.md` and `<workspace>/AGENTS.local.md` apply to sessions
  whose working directory is inside that workspace.
- The `.local` file is the conventional overlay: keep machine-specific or
  personal wording there, and keep `AGENTS.md` portable.
- Later/more specific files are rendered after the global one. Treat conflicts
  as "the more specific file wins", and avoid duplicating rules across files.
- Subagent sessions inherit their parent's working directory. A subagent started
  from workspace B does **not** load workspace A's persona unless B's directory
  is inside A's tree (see the isolation notes below).

## Multi-workspace isolation checklist

1. Give every workspace its own root directory that is **not** a parent of
   another workspace (for example `C:\Workspaces\private`,
   `C:\Workspaces\work-a`, `C:\Workspaces\work-b`).
2. Do not put a persona file in a shared parent such as `%USERPROFILE%` while
   other workspaces live underneath it. If DSH resolves a subdirectory session's
   project root to that parent, the parent's instruction files are in scope.
3. Verify empirically: open a fresh session in each workspace and ask the model
   to quote the first heading of the instruction files it received. A workspace
   that shows another workspace's persona is configured wrong.
4. Keep the memory plugin's `privateWorkspace` set to the exact workspace root
   (see `config.example.yml`). It compares the full, case-folded path, so a
   subdirectory never matches.

## Example persona (replace freely)

```markdown
# Workspace persona

You are the assistant for this workspace. Speak plainly and stay concise for
everyday chat; be precise and complete for engineering and research work.

- Say what you did, what you verified, and what is still unverified.
- Never invent results. If a step was not run, say so.
- Ask before destructive or irreversible actions.
- This file only changes tone and defaults. It never grants new permissions.
```

Keep persona and memory rules separate: the persona file says *how to talk*;
the memory rules file (`CLAUDE.example.md`) says *what to remember*.
