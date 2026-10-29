import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { installMemorySettingsWeb, memorySettingsRouteHandler } from '../lib/web.js'

/** Minimal server-response fake capturing the status, headers, and JSON body. */
function fakeResponse() {
  const res = {
    headers: {},
    status: 0,
    ended: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    writeHead(status) { this.status = status },
    end(body) { this.ended = Buffer.isBuffer(body) ? body.toString('utf8') : String(body) }
  }
  return res
}

function fakeRequest(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.headers = headers
  return req
}

function fakeSettings() {
  const calls = []
  const settings = {
    writable: true,
    value: { maxBytes: 8000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true },
    revision: 7,
    base: undefined,
    user: undefined,
    describe(options) {
      // The Host removes schema `role('secret')` fields from a redacting read
      // and reports every declared secret slot through the sidecar, set or not.
      const redacted = options && options.redactSecrets === true
      const strip = (input) => {
        if (!redacted || input === undefined) return input
        const copy = { ...input }
        delete copy.embeddingApiKey
        return copy
      }
      const secrets = [{ path: ['embeddingApiKey'], set: settings.user !== undefined && typeof settings.user.embeddingApiKey === 'string' && settings.user.embeddingApiKey.length > 0 }]
      return [{
        ns: 'dsh-memory',
        value: strip(settings.value),
        ...redacted ? { secrets } : {},
        ...settings.base === undefined ? {} : { base: strip(settings.base) },
        ...settings.user === undefined ? {} : { user: strip(settings.user) },
        revision: settings.revision
      }]
    },
    applyOps(ops) {
      const next = { ...settings.value }
      for (const op of ops) {
        if (op.op === 'set') next[op.path[0]] = op.value
        else delete next[op.path[0]]
      }
      settings.value = next
      if (settings.user !== undefined) {
        const user = { ...settings.user }
        for (const op of ops) {
          if (op.op === 'set') user[op.path[0]] = op.value
          else delete user[op.path[0]]
        }
        settings.user = user
      }
      settings.revision += 1
    },
    async mutate(ns, ops, expectedRevision) {
      calls.push({ method: 'mutate', ns, ops, expectedRevision })
      settings.applyOps(ops)
    },
    async replace(ns, section, expectedRevision) {
      calls.push({ method: 'replace', ns, section, expectedRevision })
      settings.value = section
      settings.revision += 1
    }
  }
  return { settings, calls }
}

/** Same-origin POST helper for the settings endpoint. */
async function postSettings(settings, payload, readDefaults) {
  const handler = memorySettingsRouteHandler(fakeCtx, settings, readDefaults)
  const res = fakeResponse()
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  return res
}

const fakeCtx = {
  logger: { warn: () => {} },
  get(name) {
    if (name !== 'connection') return undefined
    return {
      requestRejection(req) {
        if (req.headers['sec-fetch-site'] === 'cross-site') return 403
        const origin = req.headers.origin
        if (origin !== undefined && origin !== 'http://127.0.0.1:18080') return 403
        return undefined
      }
    }
  }
}

const noConnectionCtx = { logger: { warn: () => {} }, get: () => undefined }

test('settings endpoint fails closed without a connection service', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(noConnectionCtx, settings)
  for (const method of ['GET', 'POST']) {
    const res = fakeResponse()
    await handler(fakeRequest(method, method === 'POST' ? '{}' : undefined, {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin'
    }), res)
    assert.equal(res.status, 503)
    assert.equal(JSON.parse(res.ended).error.code, 'auth-unavailable')
  }
})

test('settings endpoint rejects a connection verdict of 401', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler({
    logger: { warn: () => {} },
    get: (name) => name === 'connection' ? { requestRejection: () => 401 } : undefined
  }, settings)
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 401)
  assert.equal(JSON.parse(res.ended).error.code, 'unauthenticated')
})

test('settings card resolves the loader-row namespace on DSH 0.1.7 (no settings.register)', async () => {
  // DSH 0.1.7-rc.1 removed SettingsProvider.register() and derives a plugin's
  // settings namespace from its loader-row id (this bundle's cordis.patch.yml
  // row is `dsh-memory`), so the card must probe for it instead of assuming the
  // registered name `memory`.
  const calls = []
  const settings = {
    writable: true,
    describe: () => [{ ns: 'dsh-memory', value: { maxBytes: 8000 }, revision: 3 }],
    async mutate(ns, ops, expectedRevision) { calls.push({ ns, ops, expectedRevision }) }
  }
  const handler = memorySettingsRouteHandler(fakeCtx, settings)

  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.ended).value.settings.value.maxBytes, 8000)

  const save = fakeResponse()
  await handler(fakeRequest('POST', JSON.stringify({ action: 'save', expectedRevision: 3, set: { maxBytes: 4000 }, unset: [] }), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), save)
  assert.equal(save.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ns, 'dsh-memory', 'saves must target whichever namespace the running DSH line exposes')
})

test('GET returns the memory settings snapshot', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.settings.value.maxBytes, 8000)
  assert.equal(payload.value.settings.revision, 7)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('GET redacts the embeddings key and a save can clear it explicitly', async () => {
  const { settings, calls } = fakeSettings()
  settings.value = { ...settings.value, embeddingApiKey: 'sk-live-secret' }
  settings.user = { embeddingApiKey: 'sk-live-secret' }
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.value.settings.value.embeddingApiKey, undefined,
    'the stored key must not cross the endpoint')
  assert.deepEqual(payload.value.settings.secrets, [{ path: ['embeddingApiKey'], set: true }],
    'the redaction sidecar must still tell the card a key is stored')

  const cleared = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, set: {}, unset: ['embeddingApiKey'] })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), cleared)
  const after = JSON.parse(cleared.ended)
  assert.equal(after.ok, true)
  assert.ok(calls.some((call) => call.ops.length === 1 && call.ops[0].op === 'unset' && call.ops[0].path.join('.') === 'embeddingApiKey'),
    'clearing the key must reach the seam as an unset op')
})

test('POST saves the section and returns the updated snapshot', async () => {
  const { settings, calls } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, value: { maxBytes: 4000, autoSummarize: false, consolidateEvery: 5, seedFromAgentsMd: false } })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.settings.value.maxBytes, 4000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ns, 'dsh-memory')
  assert.equal(calls[0].expectedRevision, 7)
})

test('POST persists only the fields that differ from the resolved value', async () => {
  const { settings, calls } = fakeSettings()
  // A legacy card posts the whole form; only maxBytes actually changed here.
  const res = await postSettings(settings, {
    action: 'save',
    expectedRevision: 7,
    value: { maxBytes: 4000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true }
  }, () => ({ maxBytes: 8000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true }))
  assert.equal(res.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'mutate', 'saves must patch the namespace, not replace the whole section')
  assert.deepEqual(calls[0].ops, [{ op: 'set', path: ['maxBytes'], value: 4000 }])
})

test('POST drops a user-layer override that is saved back at its default', async () => {
  const { settings, calls } = fakeSettings()
  settings.user = { consolidateMaxTokens: 3000 }
  settings.value = { ...settings.value, consolidateMaxTokens: 3000 }
  const res = await postSettings(settings, {
    action: 'save',
    expectedRevision: 7,
    value: { ...settings.value, consolidateMaxTokens: 8192 }
  }, () => ({ maxBytes: 8000, consolidateMaxTokens: 8192 }))
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0].ops, [{ op: 'unset', path: ['consolidateMaxTokens'] }])
  assert.equal(JSON.parse(res.ended).value.settings.value.consolidateMaxTokens, undefined)
})

test('POST accepts an explicit set/unset diff from the card', async () => {
  const { settings, calls } = fakeSettings()
  settings.user = { consolidateMaxTokens: 3000 }
  settings.value = { ...settings.value, consolidateMaxTokens: 3000 }
  const res = await postSettings(settings, {
    action: 'save',
    expectedRevision: 7,
    set: { maxBytes: 4000 },
    unset: ['consolidateMaxTokens']
  }, () => ({ maxBytes: 8000, consolidateMaxTokens: 8192 }))
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0].ops, [
    { op: 'unset', path: ['consolidateMaxTokens'] },
    { op: 'set', path: ['maxBytes'], value: 4000 }
  ])
})

test('GET exposes schema defaults so the card can spot a reset field', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings, () => ({ maxBytes: 8000 }))
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.ended).value.settings.defaults, { maxBytes: 8000 })
})

test('POST rejects a malformed save payload', async () => {
  const { settings } = fakeSettings()
  const badSet = await postSettings(settings, { action: 'save', expectedRevision: 7, set: [] })
  assert.equal(badSet.status, 400)
  assert.equal(JSON.parse(badSet.ended).error.code, 'invalid-request')
  const badUnset = await postSettings(settings, { action: 'save', expectedRevision: 7, unset: ['', 5] })
  assert.equal(badUnset.status, 400)
  assert.equal(JSON.parse(badUnset.ended).error.code, 'invalid-request')
})

test('POST rejects a cross-site origin', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('POST', '{}', { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }), res)
  assert.equal(res.status, 403)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'origin-rejected')
})

test('POST maps a settings conflict to 409', async () => {
  const { settings } = fakeSettings()
  const conflict = new Error('moved')
  conflict.code = 'SETTINGS_CONFLICT'
  settings.mutate = async () => { throw conflict }
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, value: { maxBytes: 4000 } })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 409)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'settings-conflict')
})

test('unsupported POST actions are rejected', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('POST', JSON.stringify({ action: 'explode' }), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.ended).error.code, 'invalid-request')
})

test('Web route waits for the webServer service before registering', () => {
  const settings = fakeSettings()
  const registrations = []
  const effects = []
  const fakeCtx = {
    logger: { warn() {} },
    inject(services, callback) {
      assert.deepEqual([...services], ['webServer'])
      callback({
        webServer: {
          register(options) {
            registrations.push(options)
            return () => {}
          }
        },
        effect(effect, label) {
          effects.push(label)
          return effect()
        }
      })
    }
  }

  installMemorySettingsWeb(fakeCtx, settings)

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].kind, 'exact')
  assert.equal(registrations[0].path, '/_dsh/memory/settings')
  assert.equal(typeof registrations[0].handler, 'function')
  assert.ok(effects.includes('dsh-memory: settings route'))
})


test('client bundle uses the fork package identity and registers a settings section', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /__ModuleLoader__\.load\(\{\s*id: 'dsh-memory-scoped'/)
  assert.match(source, /name: 'settings\.section'/)
  assert.match(source, /id: 'scoped-memory'/)
  assert.match(source, /order: 60/)
  assert.match(source, /exports\.inject = \['slots', 'locale'\]/)
  assert.match(source, /locale\.register\(NS, \{ en: en, zh: zh \}\)/)
  assert.match(source, /const API = '\/_dsh\/memory\/console'|var API = '\/_dsh\/memory\/console'/)
  // The old stale surfaces are gone: the bundle id must match the package name
  // (client-modules keys the boot graph by the resolved package name), and the
  // dedicated page replaces the Plugins-row form.
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), /@dsh-external\/dsh-memory/,
    'the stale upstream bundle identity must not survive in executable code')
  assert.doesNotMatch(source, /plugins\.row\.config/)
  assert.doesNotMatch(source, /settings\.plugin\.item/)
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
  assert.match(source, /var zh = \{/)
  assert.match(source, /nav: '私人工作区记忆'/)
})

test('client bundle mounts the section through the client slots service', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const fakeReact = {
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    createElement: (type, props, ...children) => ({ type, props, children })
  }
  let loaded = null
  const styleNodes = []
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { loaded = spec } } },
    document: {
      head: { appendChild(node) { styleNodes.push(node) } },
      createElement(tag) { return { tag, id: '', textContent: '', remove() {} } },
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
    },
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: () => { throw new Error('no network in this test') },
    Date,
    TextEncoder
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(loaded.id, 'dsh-memory-scoped')
  const exports = loaded.factory((spec) => {
    if (spec === 'react') return fakeReact
    throw new Error(`unexpected require: ${spec}`)
  })

  let dictionaries = null
  const registrations = []
  const sections = []
  const fakeCtx = {
    effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
    locale: {
      register(ns, dicts) { dictionaries = { ns, dicts }; return () => {} },
      bind() { return (key) => (dictionaries.dicts.zh[key] !== undefined ? dictionaries.dicts.zh[key] : key) }
    },
    slots: {
      inject(name, callback) {
        sections.push(name)
        registrations.push(callback())
        return () => {}
      },
      register(options, component) { return { options, component } }
    }
  }
  exports.apply(fakeCtx)

  assert.equal(styleNodes.length, 1, 'the page injects exactly one style element')
  assert.match(styleNodes[0].textContent, /\.mf-root/)
  assert.deepEqual(sections, ['settings.section'])
  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  assert.equal(registration.options.name, 'settings.section')
  assert.equal(registration.options.id, 'scoped-memory')
  assert.equal(registration.options.locale, 'dsh-memory-scoped')
  assert.equal(registration.options.label(), '私人工作区记忆')
  assert.equal(typeof registration.component, 'function')
  assert.equal(dictionaries.ns, 'dsh-memory-scoped')
  for (const key of ['title', 'subtitle', 'tabs', 'summary', 'curatorRunning', 'paramsTitle', 'confirmDeleteBody']) {
    assert.equal(typeof dictionaries.dicts.zh[key] !== 'undefined', true, `zh dictionary must define ${key}`)
    assert.equal(typeof dictionaries.dicts.en[key] !== 'undefined', true, `en dictionary must define ${key}`)
  }
})

test('client copy covers every console source and status label in both languages', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const sourceType of ['user_statement', 'session_task', 'file_fact', 'assistant_claim', 'model_tool', 'manual', 'import', 'unknown']) {
    const hits = (source.match(new RegExp(`${sourceType}:`, 'g')) || []).length
    assert.ok(hits >= 2, `source type ${sourceType} needs en+zh copy (found ${hits})`)
  }
  for (const status of ['ok', 'empty', 'failed', 'skipped']) {
    assert.ok(source.includes(`${status}:`), `status ${status} needs copy`)
  }
  for (const key of ['source', 'recordedBy', 'evidence', 'createdAt', 'updatedAt', 'session']) {
    assert.ok((source.match(new RegExp(`${key}:`, 'g')) || []).length >= 2, `metadata label ${key} needs en+zh copy`)
  }
})
