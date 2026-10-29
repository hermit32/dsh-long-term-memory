// HTTP surface for the Scoped memory console.
//
// Security boundary:
// - every request must pass DSH's `connection.requestRejection` — the same
//   Host/Origin fence and signed browser-session cookie used by the settings
//   surface. There is no loopback/same-origin fallback: a local process must
//   not become an authenticated administrator by forging headers;
// - if `connection` is absent, requests fail closed (503) instead of degrading
//   to unauthenticated local read/write;
// - the payload can only name an action and memory fields. It can never name a
//   workspace, scope, directory, or file path.

import {
  settingsReadJson,
  settingsRequestError,
  settingsResponseJson
} from './web.js'
import { memoryRequestRejection } from './auth.js'

/** Exact base path; the route is registered as a prefix so `/entry` works. */
export const MEMORY_CONSOLE_ROUTE = '/_dsh/memory/console'

const MAX_BODY_BYTES = 128 * 1024

/**
 * Authenticate one console request.
 * @returns `{status, code, message}` on rejection, otherwise undefined.
 */
export function consoleRejection(ctx, req) {
  return memoryRequestRejection(ctx, req)
}

function pathOf(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/**
 * Create the route handler. `service` is the MemoryConsoleService-like object.
 * @param ctx - owning host context (only `logger` and `get` are used).
 * @param service - console service.
 * @returns a Node request handler.
 */
export function memoryConsoleHandler(ctx, service) {
  return async function handleMemoryConsole(req, res) {
    const rejection = consoleRejection(ctx, req)
    if (rejection !== undefined) {
      settingsRequestError(res, rejection.status, rejection.code, rejection.message)
      return
    }
    const path = pathOf(req)
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (path === MEMORY_CONSOLE_ROUTE) {
          settingsResponseJson(res, 200, { ok: true, value: await service.snapshot() })
          return
        }
        if (path === `${MEMORY_CONSOLE_ROUTE}/entry`) {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const value = await service.entry(url.searchParams.get('id'))
          settingsResponseJson(res, 200, { ok: true, value })
          return
        }
        settingsRequestError(res, 404, 'not-found', '未知的记忆控制台接口')
        return
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST')
        settingsRequestError(res, 405, 'method-not-allowed', '使用 GET 或 POST')
        return
      }
      let payload
      try {
        payload = await settingsReadJson(req, MAX_BODY_BYTES)
      } catch (error) {
        settingsRequestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', error instanceof Error ? error.message : String(error))
        return
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        settingsRequestError(res, 400, 'invalid-request', '请求体必须是 JSON 对象')
        return
      }
      if (payload.action === 'settings-save') {
        settingsResponseJson(res, 200, { ok: true, value: await service.saveSettings(payload) })
        return
      }
      settingsResponseJson(res, 200, { ok: true, value: await service.mutate(payload) })
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      const code = typeof error?.code === 'string' ? error.code : 'console-failed'
      const safe = error?.name === 'ConsoleError'
      const message = safe
        ? (error instanceof Error ? error.message : String(error))
        : status >= 500 ? '记忆控制台操作失败' : '请求被拒绝'
      if (!safe || status >= 500) ctx.logger?.warn?.('dsh-memory-scoped console failed: %o', error)
      settingsRequestError(res, status, code, message)
    }
  }
}

/**
 * Register the console route once DSH's Web server is available.
 * @param ctx - host context.
 * @param createService - factory called on first request (never at boot).
 */
export function installMemoryConsoleWeb(ctx, createService) {
  ctx.inject(['webServer'], (webCtx) => {
    let service
    const getService = () => {
      if (service === undefined) service = createService()
      return service
    }
    const handler = memoryConsoleHandler(webCtx, new Proxy({}, {
      get(_target, property) {
        const value = getService()
        const member = value[property]
        return typeof member === 'function' ? member.bind(value) : member
      }
    }))
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: MEMORY_CONSOLE_ROUTE,
      handler
    }), 'dsh-memory-scoped: console route')
  })
}
