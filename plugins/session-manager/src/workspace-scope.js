// Workspace-scope helpers for the model-facing `session_delete` tool.
//
// The UI delete route is a deliberately global administrator surface. The tool
// is not: an AI in the default workspace must not enumerate or delete a session from another
// session just because it can call a tool. These helpers are pure so the scope
// rules can be tested without a live Host.

/** Fold Windows separators/case and a trailing separator for exact comparison. */
export function normalizeWorkspacePath(value) {
  let text = String(value ?? '').trim().replace(/\//g, '\\')
  if (text.length > 3 && text.endsWith('\\')) text = text.slice(0, -1)
  return text.toLowerCase()
}

/** Workspace identity across the entity/storage-record shapes in use. */
export function workspaceIdOf(workspace) {
  if (workspace === null || typeof workspace !== 'object') return ''
  return String(workspace.id ?? workspace.workspaceId ?? '').trim()
}

/** Session ids accounted to one workspace. */
export function workspaceSessionIds(workspace) {
  return Array.isArray(workspace?.sessionIds) ? workspace.sessionIds.map(String) : []
}

/** Every workspace record that claims this session id. */
export function workspaceOwners(workspaces, sessionId, sameId = (left, right) => left === right) {
  const id = String(sessionId ?? '')
  if (id.length === 0) return []
  return (Array.isArray(workspaces) ? workspaces : []).filter((workspace) => (
    workspaceSessionIds(workspace).some((candidate) => sameId(candidate, id))
  ))
}

/** The unique owner, or undefined when none/multiple workspaces claim it. */
export function findWorkspaceForSession(workspaces, sessionId, sameId) {
  const owners = workspaceOwners(workspaces, sessionId, sameId)
  return owners.length === 1 ? owners[0] : undefined
}

/** The unique workspace whose registered path is exactly this cwd. */
export function findUniqueWorkspaceByPath(workspaces, cwd) {
  const target = normalizeWorkspacePath(cwd)
  if (target.length === 0) return undefined
  const matches = (Array.isArray(workspaces) ? workspaces : []).filter((workspace) => (
    normalizeWorkspacePath(workspace?.path) === target
  ))
  return matches.length === 1 ? matches[0] : undefined
}

/** Whether two workspace records have the same non-empty identity. */
export function isSameWorkspace(left, right) {
  const leftId = workspaceIdOf(left)
  const rightId = workspaceIdOf(right)
  return leftId.length > 0 && rightId.length > 0 && leftId === rightId
}

/**
 * Walk subagent parents to the owning root session header.
 *
 * Only `origin === 'subagent'` links are followed. A fork/resume has a
 * `parentSession` too, but it is an independent user session and must not be
 * re-parented for permission purposes. A missing parent or a cycle is
 * unresolvable and returns undefined (the caller must refuse).
 *
 * @param header - caller session header.
 * @param lookup - async `(sessionId) => header | undefined`.
 * @param maxDepth - cycle/chain bound.
 * @returns root header, or undefined when the chain cannot be resolved.
 */
export async function rootHeaderOf(header, lookup, maxDepth = 32) {
  let current = header
  if (current === null || typeof current !== 'object' || typeof current.id !== 'string' || current.id.length === 0) {
    return undefined
  }
  const seen = new Set()
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (current.origin !== 'subagent' || current.parentSession === undefined || current.parentSession === null) {
      return current
    }
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    if (typeof lookup !== 'function') return undefined
    const parent = await lookup(current.parentSession)
    if (parent === null || typeof parent !== 'object' || typeof parent.id !== 'string' || parent.id.length === 0) {
      return undefined
    }
    current = parent
  }
  return undefined
}
