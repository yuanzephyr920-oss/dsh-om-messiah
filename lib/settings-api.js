/**
 * The settings page's server half.
 *
 * The Client half of this plugin lives in the browser and has no way to read or
 * write plugin config (Client services are only layout/locale/sessions/slots/
 * theme/timer/uiWorkspace/workspaces). So the page talks to two Host routes
 * registered here:
 *
 *   GET  /api/om-messiah/config   → the config that is actually in effect
 *   POST /api/om-messiah/config   → validate + persist via `configEditor`
 *   POST /api/om-messiah/preview  → try the prayer on arbitrary text
 *
 * `configEditor` is the only sanctioned way to persist a plugin config: it
 * validates, writes the profile patch and reconciles through the normal Loader
 * path, so the running plugin is re-applied with the new values.
 */

import { buildPrayer, normalizeConfig, LITURGY_FIELDS } from './prayer.js'
import { classify } from './guards.js'

/** Patch id of this plugin inside `cordis.patch.yml`. */
export const PATCH_ID = 'om-messiah'

const INTENSITIES = ['low', 'medium', 'high']
const QUOTE_STYLES = ['quote', 'plain']

/** Everything the page may write, with its type guard. */
const FIELDS = {
  enabled: (value) => typeof value === 'boolean',
  intensity: (value) => INTENSITIES.includes(value),
  quoteStyle: (value) => QUOTE_STYLES.includes(value),
  echo: (value) => typeof value === 'boolean',
  echoFile: (value) => typeof value === 'string' && value.length <= 400,
  maxChars: (value) => Number.isFinite(value) && value >= 200 && value <= 200000,
  rewrapAlreadyStyled: (value) => typeof value === 'boolean',
  askChoice: (value) => typeof value === 'boolean',
  choiceTimeoutMs: (value) => Number.isFinite(value) && value >= 5000 && value <= 600000,
  choiceFallback: (value) => value === 'prayer' || value === 'original',
  address: (value) => typeof value === 'string' && value.length <= 400,
  selfDesc: (value) => typeof value === 'string' && value.length <= 400,
  praise: (value) => typeof value === 'string' && value.length <= 400,
  wishLead: (value) => typeof value === 'string' && value.length <= 400,
  closing: (value) => typeof value === 'string' && value.length <= 200,
}

/**
 * Keep only known keys with valid values.
 *
 * @param {unknown} input whatever the page posted.
 * @returns {{patch: Record<string, unknown>, rejected: string[]}}
 */
export function sanitizePatch(input) {
  const patch = {}
  const rejected = []
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { patch, rejected }
  }
  for (const [key, keep] of Object.entries(FIELDS)) {
    if (!Object.hasOwn(input, key)) continue
    if (keep(input[key])) patch[key] = input[key]
    else rejected.push(key)
  }
  return { patch, rejected }
}

/** Find this plugin's row in the profile patch. */
export function findEntry(configEditor) {
  if (configEditor === undefined || configEditor === null) return undefined
  try {
    const rows = configEditor.entries()
    if (!Array.isArray(rows)) return undefined
    return rows.find((row) => row?.options?.id === PATCH_ID)
  } catch {
    return undefined
  }
}

/**
 * The config in effect: profile patch values over the bundle defaults.
 *
 * `configEditor` is optional, so fall back to the config handed to `apply()`
 * when it is missing (e.g. a headless profile without the Settings UI).
 */
export function effectiveConfig(configEditor, fallback) {
  const entry = findEntry(configEditor)
  if (entry === undefined) return normalizeConfig(fallback)
  try {
    const rows = configEditor.configuration()
    const row = Array.isArray(rows) ? rows.find((item) => item?.entry?.options?.id === PATCH_ID) : undefined
    if (row === undefined) return normalizeConfig(entry.options?.config ?? fallback)
    return normalizeConfig({ ...row.inherited, ...row.override })
  } catch {
    return normalizeConfig(entry.options?.config ?? fallback)
  }
}

/** Options `buildPrayer` takes from the config. */
export function prayerOptions(config) {
  const options = {
    intensity: config.intensity,
    quoteStyle: config.quoteStyle,
  }
  for (const field of LITURGY_FIELDS) options[field] = config[field]
  return options
}

/**
 * Transport-agnostic settings operations; `index.js` adapts them to HTTP so the
 * logic stays testable without a server.
 *
 * @param {{config: unknown, configEditor?: any}} host
 */
export function createSettingsApi(host) {
  const fallback = host.config
  const configEditor = host.configEditor

  return {
    read() {
      return { ok: true, config: effectiveConfig(configEditor, fallback) }
    },

    async save(input) {
      const entry = findEntry(configEditor)
      if (entry === undefined) {
        return {
          status: 501,
          body: {
            ok: false,
            error: '写不了配置：当前 profile 没有 configEditor（这条路由只在带设置界面的宿主里可用）',
          },
        }
      }
      const { patch, rejected } = sanitizePatch(input)
      if (rejected.length > 0) {
        return { status: 400, body: { ok: false, error: `这些值不合法：${rejected.join(', ')}` } }
      }
      if (Object.keys(patch).length === 0) {
        return { status: 400, body: { ok: false, error: '没有可写字段' } }
      }
      try {
        await configEditor.edit(entry, (current, inherited) => ({
          ...inherited,
          ...(current !== null && typeof current === 'object' ? current : {}),
          ...patch,
        }))
      } catch (error) {
        return { status: 500, body: { ok: false, error: `保存失败：${error?.message ?? String(error)}` } }
      }
      return {
        status: 200,
        body: { ok: true, saved: patch, config: effectiveConfig(configEditor, fallback) },
      }
    },

    preview(input) {
      const text = typeof input?.text === 'string' ? input.text : ''
      if (text.trim() === '') {
        return { status: 400, body: { ok: false, error: '先写一段要试改写的话' } }
      }
      const base = effectiveConfig(configEditor, fallback)
      const { patch } = sanitizePatch(input?.overrides)
      const config = normalizeConfig({ ...base, ...patch })
      if (config.enabled !== true) {
        return { status: 200, body: { ok: true, skipped: true, reason: 'disabled', config } }
      }
      const verdict = classify(text, config)
      if (verdict.skip) {
        return { status: 200, body: { ok: true, skipped: true, reason: verdict.reason ?? 'skip', config } }
      }
      const { text: prayer, petition } = buildPrayer(text, prayerOptions(config))
      return { status: 200, body: { ok: true, skipped: false, prayer, petition, config } }
    },
  }
}
