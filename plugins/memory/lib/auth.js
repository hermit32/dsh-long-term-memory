// Shared browser authentication for every memory management endpoint.
//
// DSH's `connection.requestRejection(request)` is the authoritative fence: it
// validates the Host/Origin boundary AND the signed browser-session cookie.
// The memory plugin used to fall back to loopback + same-origin headers when
// the connection service was absent; that made `/console` and `/settings`
// readable/writable by any local process that could forge those headers. The
// management surface is private user data, so this module fails closed.

const AUTH_UNAVAILABLE = Object.freeze({
  status: 503,
  code: 'auth-unavailable',
  message: '认证服务不可用，已拒绝记忆管理请求'
})

/**
 * Authenticate one memory management request.
 *
 * @param ctx - owning host context (`ctx.get('connection')`).
 * @param req - Node request with headers.
 * @returns `{status, code, message}` on rejection, otherwise undefined.
 */
export function memoryRequestRejection(ctx, req) {
  const connection = ctx !== null && typeof ctx === 'object' && typeof ctx.get === 'function'
    ? ctx.get('connection')
    : undefined
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
    return { ...AUTH_UNAVAILABLE }
  }
  try {
    const rejection = connection.requestRejection(req)
    if (rejection === undefined || rejection === null) return undefined
    if (rejection === 403) {
      return {
        status: 403,
        code: 'origin-rejected',
        message: '请求必须来自本机已认证的 DSH 页面'
      }
    }
    if (rejection === 401) {
      return {
        status: 401,
        code: 'unauthenticated',
        message: '需要已认证的 DSH 页面会话'
      }
    }
    return {
      status: 403,
      code: 'origin-rejected',
      message: '请求来源校验失败'
    }
  } catch {
    return {
      status: 403,
      code: 'origin-rejected',
      message: '请求来源校验失败'
    }
  }
}
