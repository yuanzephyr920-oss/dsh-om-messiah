import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSettingsApi,
  effectiveConfig,
  findEntry,
  prayerOptions,
  sanitizePatch,
} from '../lib/settings-api.js'
import { CALL, CLOSING, PRAISE, WISH_LEAD, buildPrayer, normalizeConfig } from '../lib/prayer.js'

/** A configEditor stand-in with one row for this plugin. */
function fakeEditor(initial = { intensity: 'medium' }) {
  const row = {
    options: { id: 'mechanicus', config: { ...initial } },
  }
  const state = {
    edits: [],
    overrides: { ...initial },
  }
  return {
    state,
    entries() {
      return [row]
    },
    configuration() {
      return [{ entry: row, inherited: { intensity: 'medium' }, override: { ...state.overrides } }]
    },
    async edit(entry, change) {
      assert.equal(entry, row)
      const next = change(entry.options.config, { intensity: 'medium' })
      state.edits.push(next)
      state.overrides = next
      entry.options.config = next
    },
  }
}

test('sanitizePatch keeps known keys and rejects bad values', () => {
  const { patch, rejected } = sanitizePatch({
    enabled: false,
    intensity: 'high',
    maxChars: 5000,
    quoteStyle: 'nope',
    address: 'x'.repeat(401),
    unknown: 1,
  })
  assert.deepEqual(patch, { enabled: false, intensity: 'high', maxChars: 5000 })
  assert.deepEqual(rejected.sort(), ['address', 'quoteStyle'])
})

test('sanitizePatch tolerates non-objects', () => {
  assert.deepEqual(sanitizePatch(null), { patch: {}, rejected: [] })
  assert.deepEqual(sanitizePatch([1, 2]), { patch: {}, rejected: [] })
  assert.deepEqual(sanitizePatch('x'), { patch: {}, rejected: [] })
})

test('findEntry locates the plugin row by patch id', () => {
  const editor = fakeEditor()
  assert.equal(findEntry(editor), editor.entries()[0])
  assert.equal(findEntry(undefined), undefined)
  assert.equal(findEntry({ entries: () => [] }), undefined)
})

test('effectiveConfig merges inherited and override layers', () => {
  const editor = fakeEditor({ intensity: 'high', closing: '愿机魂永在！' })
  const config = effectiveConfig(editor, {})
  assert.equal(config.intensity, 'high')
  assert.equal(config.closing, '愿机魂永在！')
  assert.equal(config.enabled, true)
})

test('effectiveConfig falls back to the apply() config without an editor', () => {
  const config = effectiveConfig(undefined, { intensity: 'low', enabled: false })
  assert.equal(config.intensity, 'low')
  assert.equal(config.enabled, false)
})

test('prayerOptions carries the five liturgy slots', () => {
  const config = normalizeConfig({ address: 'A', selfDesc: 'B', praise: 'C', wishLead: 'D', closing: 'E' })
  assert.deepEqual(prayerOptions(config), {
    intensity: 'medium',
    quoteStyle: 'quote',
    address: 'A',
    selfDesc: 'B',
    praise: 'C',
    wishLead: 'D',
    closing: 'E',
  })
})

test('read returns the config in effect', () => {
  const api = createSettingsApi({ config: {}, configEditor: fakeEditor({ intensity: 'low' }) })
  const result = api.read()
  assert.equal(result.ok, true)
  assert.equal(result.config.intensity, 'low')
})

test('save persists a merged raw config through configEditor.edit', async () => {
  const editor = fakeEditor({ intensity: 'medium' })
  const api = createSettingsApi({ config: {}, configEditor: editor })
  const result = await api.save({ intensity: 'high', address: '伟大之神！' })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(editor.state.edits.length, 1)
  assert.equal(editor.state.edits[0].intensity, 'high')
  assert.equal(editor.state.edits[0].address, '伟大之神！')
  assert.equal(result.body.config.intensity, 'high')
})

test('save reports missing configEditor and invalid payloads', async () => {
  const bare = createSettingsApi({ config: {} })
  const missing = await bare.save({ intensity: 'high' })
  assert.equal(missing.status, 501)
  assert.equal(missing.body.ok, false)

  const api = createSettingsApi({ config: {}, configEditor: fakeEditor() })
  const bad = await api.save({ intensity: 'extreme' })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /intensity/)

  const empty = await api.save({})
  assert.equal(empty.status, 400)
})

test('preview rewrites text with the posted overrides', () => {
  const api = createSettingsApi({ config: {}, configEditor: fakeEditor() })
  const result = api.preview({ text: '写一个 Python 快速排序', overrides: { intensity: 'low', closing: '机魂永在！' } })
  assert.equal(result.status, 200)
  assert.equal(result.body.skipped, false)
  assert.ok(result.body.prayer.includes(CALL))
  assert.ok(result.body.prayer.endsWith('机魂永在！'))
  assert.ok(result.body.prayer.includes(WISH_LEAD))
  assert.ok(!result.body.prayer.includes(PRAISE), 'low intensity has no praise paragraph')
})

test('preview explains skips instead of pretending to rewrite', () => {
  const api = createSettingsApi({ config: {}, configEditor: fakeEditor() })
  assert.equal(api.preview({ text: '   ' }).status, 400)
  const slash = api.preview({ text: '/compact' })
  assert.equal(slash.body.skipped, true)
  assert.equal(slash.body.reason, 'slash-command')
  const confirm = api.preview({ text: '继续' })
  assert.equal(confirm.body.reason, 'confirmation')
})

test('personalized liturgy replaces the built-in lines', () => {
  const { text } = buildPrayer('写一个快速排序', {
    intensity: 'low',
    address: '吾主欧姆弥赛亚，信徒在此叩首。',
    wishLead: '信徒有一愿：',
    closing: '愿机魂永在！',
  })
  assert.ok(text.startsWith('吾主欧姆弥赛亚，信徒在此叩首。'))
  assert.ok(text.includes('信徒有一愿：'))
  assert.ok(text.endsWith('愿机魂永在！'))
  assert.ok(!text.includes(CLOSING))
})

test('blank personalization falls back to the built-in liturgy', () => {
  const { text } = buildPrayer('写一个快速排序', { intensity: 'low', address: '   ', closing: '' })
  assert.ok(text.startsWith(CALL))
  assert.ok(text.endsWith(CLOSING))
})

/* ── the HTTP layer mounted by apply() ─────────────────────────────────── */

import { apply } from '../index.js'

function fakeCtx({ webServer, configEditor } = {}) {
  return {
    logger: { info() {}, warn() {} },
    on() {},
    effect(fn) {
      return fn()
    },
    get(key) {
      if (key === 'webServer') return webServer
      if (key === 'configEditor') return configEditor
      return undefined
    },
  }
}

function fakeResponse() {
  const out = { status: 0, headers: {}, body: '' }
  return {
    out,
    set statusCode(value) {
      out.status = value
    },
    get statusCode() {
      return out.status
    },
    setHeader(name, value) {
      out.headers[name] = value
    },
    end(body) {
      out.body = body
    },
  }
}

function postRequest(url, payload) {
  return {
    url,
    method: 'POST',
    [Symbol.asyncIterator]: async function* iterator() {
      yield Buffer.from(JSON.stringify(payload))
    },
  }
}

test('apply mounts the settings routes under /api/mechanicus', async () => {
  let route
  const webServer = {
    register(next) {
      route = next
      return () => {}
    },
  }
  const editor = fakeEditor({ intensity: 'medium' })
  apply(fakeCtx({ webServer, configEditor: editor }), { enabled: true })

  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/api/mechanicus')

  const getRes = fakeResponse()
  await route.handler({ url: '/api/mechanicus/config', method: 'GET' }, getRes)
  assert.equal(getRes.out.status, 200)
  assert.equal(JSON.parse(getRes.out.body).config.intensity, 'medium')

  const saveRes = fakeResponse()
  await route.handler(postRequest('/api/mechanicus/config', { intensity: 'high' }), saveRes)
  assert.equal(saveRes.out.status, 200)
  assert.equal(JSON.parse(saveRes.out.body).saved.intensity, 'high')
  assert.equal(editor.state.edits.length, 1)

  const previewRes = fakeResponse()
  await route.handler(postRequest('/api/mechanicus/preview', { text: '写一个快速排序' }), previewRes)
  assert.equal(previewRes.out.status, 200)
  assert.ok(JSON.parse(previewRes.out.body).prayer.includes('欧姆弥赛亚'))

  const unknownRes = fakeResponse()
  await route.handler({ url: '/api/mechanicus/nope', method: 'GET' }, unknownRes)
  assert.equal(unknownRes.out.status, 404)
})

test('apply skips route mounting when the profile has no webServer', () => {
  assert.doesNotThrow(() => apply(fakeCtx({}), { enabled: true }))
  assert.doesNotThrow(() => apply(fakeCtx({ webServer: {} }), { enabled: true }))
})

test('the confirmation settings round-trip through the patch', () => {
  const { patch, rejected } = sanitizePatch({
    askChoice: false,
    choiceTimeoutMs: 30000,
    choiceFallback: 'original',
  })
  assert.deepEqual(patch, { askChoice: false, choiceTimeoutMs: 30000, choiceFallback: 'original' })
  assert.deepEqual(rejected, [])

  const bad = sanitizePatch({ choiceTimeoutMs: 10, choiceFallback: 'later', askChoice: 'yes' })
  assert.deepEqual(bad.patch, {})
  assert.deepEqual(bad.rejected.sort(), ['askChoice', 'choiceFallback', 'choiceTimeoutMs'])
})

test('normalizeConfig keeps a sane confirmation wait', () => {
  assert.equal(normalizeConfig({}).askChoice, true)
  assert.equal(normalizeConfig({ askChoice: false }).askChoice, false)
  assert.equal(normalizeConfig({}).choiceTimeoutMs, 90000)
  assert.equal(normalizeConfig({ choiceTimeoutMs: 1 }).choiceTimeoutMs, 90000)
  assert.equal(normalizeConfig({ choiceTimeoutMs: 120000 }).choiceTimeoutMs, 120000)
  assert.equal(normalizeConfig({ choiceFallback: 'original' }).choiceFallback, 'original')
  assert.equal(normalizeConfig({ choiceFallback: 'nope' }).choiceFallback, 'prayer')
})
