import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MEMORY_CONSOLE_ROUTE,
  consoleRejection,
  installMemoryConsoleWeb,
  memoryConsoleHandler
} from '../lib/console-web.js'

function makeReq(options = {}) {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body)]
  return {
    method: options.method ?? 'GET',
    url: options.url ?? MEMORY_CONSOLE_ROUTE,
    headers: {
      host: '127.0.0.1:18080',
      origin: 'http://127.0.0.1:18080',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...options.headers
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  }
}

function makeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    writeHead(status) { this.status = status },
    end(body) { this.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '') }
  }
  return res
}

async function call(handler, req) {
  const res = makeRes()
  await handler(req, res)
  let json
  try { json = JSON.parse(res.body) } catch { json = undefined }
  return { res, json }
}

function fakeService() {
  const calls = []
  return {
    calls,
    async snapshot() { calls.push(['snapshot']); return { entries: [], summary: {} } },
    async entry(id) { calls.push(['entry', id]); return { entry: { id } } },
    async mutate(payload) { calls.push(['mutate', payload]); return { ok: true, action: payload.action } },
    async saveSettings(payload) { calls.push(['saveSettings', payload]); return { fields: [] } }
  }
}

const authCtx = { logger: { warn() {} }, get: () => ({ requestRejection: () => undefined }) }

test('requests fail closed when the connection service is absent', () => {
  const ctx = { get: () => undefined }
  const post = consoleRejection(ctx, makeReq({ method: 'POST', body: '{}' }))
  assert.equal(post.status, 503)
  assert.equal(post.code, 'auth-unavailable')
  const get = consoleRejection(ctx, makeReq())
  assert.equal(get.status, 503)
})

test('the connection service is authoritative when present', () => {
  const ctx401 = { get: () => ({ requestRejection: () => 401 }) }
  assert.equal(consoleRejection(ctx401, makeReq()).status, 401)
  const ctx403 = { get: () => ({ requestRejection: () => 403 }) }
  assert.equal(consoleRejection(ctx403, makeReq()).status, 403)
  const ctxThrows = { get: () => ({ requestRejection: () => { throw new Error('bad') } }) }
  assert.equal(consoleRejection(ctxThrows, makeReq()).status, 403)
  const ctxOk = { get: () => ({ requestRejection: () => undefined }) }
  assert.equal(consoleRejection(ctxOk, makeReq()), undefined)
})

test('GET returns the snapshot and entry detail', async () => {
  const service = fakeService()
  const handler = memoryConsoleHandler(authCtx, service)
  const snapshot = await call(handler, makeReq())
  assert.equal(snapshot.res.status, 200)
  assert.equal(snapshot.json.ok, true)
  assert.deepEqual(snapshot.json.value.entries, [])
  const detail = await call(handler, makeReq({ url: `${MEMORY_CONSOLE_ROUTE}/entry?id=mem-1234` }))
  assert.equal(detail.json.value.entry.id, 'mem-1234')
  assert.deepEqual(service.calls[1], ['entry', 'mem-1234'])
})

test('POST settings-save and memory mutations reach the service', async () => {
  const service = fakeService()
  const handler = memoryConsoleHandler(authCtx, service)
  const save = await call(handler, makeReq({
    method: 'POST',
    body: JSON.stringify({ action: 'settings-save', set: { curateEveryTurns: 20 }, expectedRevision: 3 })
  }))
  assert.equal(save.res.status, 200)
  assert.equal(save.json.ok, true)
  assert.equal(service.calls.at(-1)[0], 'saveSettings')
  const add = await call(handler, makeReq({ method: 'POST', body: JSON.stringify({ action: 'add', content: 'x' }) }))
  assert.equal(add.res.status, 200)
  assert.equal(service.calls.at(-1)[0], 'mutate')
})

test('malformed and oversized bodies are refused', async () => {
  const service = fakeService()
  const handler = memoryConsoleHandler(authCtx, service)
  const bad = await call(handler, makeReq({ method: 'POST', body: '{not json' }))
  assert.equal(bad.res.status, 400)
  const big = await call(handler, makeReq({ method: 'POST', body: JSON.stringify({ action: 'add', content: 'x'.repeat(200 * 1024) }) }))
  assert.equal(big.res.status, 413)
  const wrongType = await call(handler, makeReq({ method: 'POST', body: '[]' }))
  assert.equal(wrongType.res.status, 400)
})

test('service errors map to their status and never leak a stack', async () => {
  const service = {
    async snapshot() {
      const error = new Error('secret/internal detail')
      error.status = 409
      error.code = 'entry-conflict'
      throw error
    }
  }
  const handler = memoryConsoleHandler(authCtx, service)
  const result = await call(handler, makeReq())
  assert.equal(result.res.status, 409)
  assert.equal(result.json.error.code, 'entry-conflict')
  assert.doesNotMatch(result.json.error.message, /secret\/internal/)
})

test('installMemoryConsoleWeb registers a prefix route and creates the service lazily', () => {
  const routes = []
  const effects = []
  const ctx = {
    inject(names, callback) {
      assert.deepEqual(names, ['webServer'])
      callback({
        webServer: {
          register(route) { routes.push(route); return () => {} }
        },
        effect(fn, label) { effects.push(label); fn() }
      })
    }
  }
  let created = 0
  installMemoryConsoleWeb(ctx, () => { created += 1; return fakeService() })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, MEMORY_CONSOLE_ROUTE)
  assert.equal(created, 0, 'the service must not be constructed at registration time')
  assert.match(effects[0], /console route/)
})
