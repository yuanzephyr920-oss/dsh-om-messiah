/**
 * dsh-om-messiah — rewrite every user prompt into an Om Messiah prayer before it
 * reaches the model.
 *
 * The interception point is the Host waterfall event `agent/pre-step`: the Agent
 * loop hands listeners the batch of user messages it has just claimed, and the
 * decision they return is what gets persisted and sent. Replacing the text of
 * the claimed user message therefore changes the *actual* prompt, while every
 * other block (images, @-file attachments, plugin snapshots) stays untouched.
 *
 * Nothing is wrapped twice: the persisted message already carries the prayer,
 * and the guards skip text that is already liturgical. Retries never re-run
 * `agent/pre-step` for the same step, so a failed model call cannot double-wrap.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { askRoute, fallbackRoute } from './lib/choice.js'
import { classify } from './lib/guards.js'
import { buildPrayer, normalizeConfig, LITURGY_FIELDS } from './lib/prayer.js'
import { createSettingsApi, prayerOptions } from './lib/settings-api.js'

export const name = 'om-messiah'

/** Load schemastery from the plugin, else from any installed profile. */
async function loadSchema() {
  try {
    return (await import('@deepseek-ai/schemastery')).default
  } catch {}
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  let profiles = []
  try {
    const { readdir } = await import('node:fs/promises')
    profiles = await readdir(join(home, 'profiles'))
  } catch {
    return undefined
  }
  for (const profile of profiles) {
    const candidate = join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs')
    try {
      const module = await import(pathToFileURL(candidate).href)
      return module.default ?? module
    } catch {}
  }
  return undefined
}

const z = await loadSchema()

export const Config =
  z === undefined
    ? undefined
    : z.object({
        enabled: z.boolean().default(true),
        intensity: z.union([z.const('low'), z.const('medium'), z.const('high')]).default('medium'),
        quoteStyle: z.union([z.const('quote'), z.const('plain')]).default('quote'),
        echo: z.boolean().default(true),
        echoFile: z.string().default(''),
        maxChars: z.number().default(20000),
        rewrapAlreadyStyled: z.boolean().default(false),
        devoutCoda: z.boolean().default(true),
        askChoice: z.boolean().default(true),
        choiceTimeoutMs: z.number().default(90000),
        choiceFallback: z.union([z.const('prayer'), z.const('original')]).default('prayer'),
        // personalization, edited from the plugin's own Settings page
        address: z.string().default(''),
        selfDesc: z.string().default(''),
        praise: z.string().default(''),
        wishLead: z.string().default(''),
        closing: z.string().default(''),
      })

/** One line describing what happened, for the Host log. */
function echoLines(original, rewritten, config, skip) {
  const head = skip !== undefined && skip !== '' ? `skipped (${skip})` : `wrapped (${config.intensity})`
  return [
    `[dsh-om-messiah] ${head}: ${original.length} -> ${rewritten.length} chars`,
    '----- original -----',
    original,
    '----- prayer -----',
    rewritten,
    '--------------------',
  ].join('\n')
}

/** One line about what the user chose (or why no question was asked). */
function choiceLine(route, fallback) {
  const text =
    route === 'prayer'
      ? '发送祷文'
      : route === 'original'
        ? '发送原文'
        : `未作答（按 fallback=${fallback} 发送）`
  return `[dsh-om-messiah] choice: ${text}`
}

/**
 * Best-effort echo: Host log always, optional file when configured, and the
 * console too when DSH_MECHANICUS_ECHO=1 (handy in `dsh <profile> "…"` runs).
 */
function makeEcho(ctx, config) {
  const logger = ctx?.logger
  const info = typeof logger?.info === 'function' ? logger.info.bind(logger) : undefined
  return async (line) => {
    if (!config.echo) return
    try {
      if (info !== undefined) info(line)
      if ((process.env.DSH_OM_MESSIAH_ECHO ?? process.env.DSH_MECHANICUS_ECHO) === '1') console.error(line)
    } catch {}
    if (config.echoFile !== '') {
      try {
        await mkdir(dirname(config.echoFile), { recursive: true })
        await appendFile(config.echoFile, `${line}\n`, 'utf8')
      } catch (error) {
        try {
          logger?.warn?.(`[dsh-om-messiah] cannot write echoFile: ${String(error)}`)
        } catch {}
      }
    }
  }
}

/** True when this message is a plain user prompt (not a plugin/skill snapshot). */
function isUserPrompt(message) {
  if (message === null || typeof message !== 'object') return false
  if (message.role !== 'user') return false
  const source = message.source
  if (source !== null && typeof source === 'object' && typeof source.kind === 'string') {
    return source.kind === 'user'
  }
  return true
}

/**
 * Rewrite one message's first non-empty text block, keeping every other block.
 *
 * @returns {object|null} the new message, or null when it was left alone.
 */
function rewriteMessage(message, config, echo, warn) {
  const content = message.content
  if (!Array.isArray(content)) return null
  const index = content.findIndex(
    (block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '',
  )
  if (index < 0) return null

  const original = content[index].text
  const verdict = classify(original, config)
  if (verdict.skip) {
    echo(echoLines(original, original, config, verdict.reason ?? 'skip')).catch(warn)
    return null
  }

  const { text } = buildPrayer(original, prayerOptions(config))
  const next = content.slice()
  next[index] = { ...content[index], text }
  echo(echoLines(original, text, config)).catch(warn)
  return { ...message, content: next }
}

/** Rewrite the claimed batch; returns null when nothing changed. */
function rewriteDecision(decision, config, echo, warn) {
  const messages = decision.messages
  if (!Array.isArray(messages)) return null
  let changed = false
  const rewritten = messages.map((message) => {
    if (!isUserPrompt(message)) return message
    const replacement = rewriteMessage(message, config, echo, warn)
    if (replacement === null) return message
    changed = true
    return replacement
  })
  return changed ? rewritten : null
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  const logger = ctx?.logger
  const warn = (error) => {
    try {
      logger?.warn?.(`[dsh-om-messiah] ${error instanceof Error ? error.message : String(error)}`)
    } catch {}
  }
  const echo = makeEcho(ctx, cfg)

  // Optional Host services. `get()` is the tolerant accessor; a headless
  // profile has neither of these and must keep rewriting prompts.
  const service = (key) => {
    try {
      if (typeof ctx?.get === 'function') return ctx.get(key)
      return ctx?.[key]
    } catch {
      return undefined
    }
  }
  const userQuestions = service('userQuestions')
  const hasWebServer = service('webServer') !== undefined

  /** Ask which text this turn sends; never throws, never blocks forever. */
  const chooseRoute = async (payload) => {
    const fallback = fallbackRoute(cfg.choiceFallback)
    if (!hasWebServer) {
      echo(choiceLine('no-settings-ui', fallback)).catch(warn)
      return fallback
    }
    try {
      const route = await askRoute({
        userQuestions,
        agent: payload?.agent,
        signal: payload?.signal,
        timeoutMs: cfg.choiceTimeoutMs,
      })
      if (route === null) {
        echo(choiceLine('unanswered', fallback)).catch(warn)
        return fallback
      }
      echo(choiceLine(route, fallback)).catch(warn)
      return route
    } catch (error) {
      warn(error)
      echo(choiceLine('unavailable', fallback)).catch(warn)
      return fallback
    }
  }

  const listener = async (payload, next) => {
    const decision = await next()
    if (decision === null || typeof decision !== 'object' || decision.kind !== 'enter') return decision
    if (!cfg.enabled) return decision
    try {
      const rewritten = rewriteDecision(decision, cfg, echo, warn)
      if (rewritten === null) return decision
      if (!cfg.askChoice) return { ...decision, messages: rewritten }
      // The user decides whether the prayer or their own words are sent. Until
      // they answer, this turn does not enter the model.
      const route = await chooseRoute(payload)
      return route === 'original' ? decision : { ...decision, messages: rewritten }
    } catch (error) {
      // a broken rewrite must never cost the user their message
      warn(error)
      return decision
    }
  }

  const global = { global: true }
  try {
    ctx.on('agent/pre-step', listener, global)
  } catch {
    ctx.on('agent/pre-step', listener)
  }

  mountSettingsRoutes(ctx, cfg, warn)

  try {
    logger?.info?.(
      `[dsh-om-messiah] active: enabled=${cfg.enabled} intensity=${cfg.intensity} quote=${cfg.quoteStyle} echo=${cfg.echo}`,
    )
  } catch {}
}

/** Largest settings request body we are willing to parse. */
const MAX_BODY = 64 * 1024

/** Read a JSON body, or `{}` when the request has none. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体太大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

/**
 * Mount the plugin's Settings page API.
 *
 * Both services are optional: a headless profile has no `webServer` and no
 * `configEditor`, and the plugin must keep rewriting prompts there.
 */
function mountSettingsRoutes(ctx, cfg, warn) {
  let webServer
  try {
    webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : ctx?.webServer
  } catch {}
  if (webServer === undefined || typeof webServer.register !== 'function') return

  let configEditor
  try {
    configEditor = typeof ctx?.get === 'function' ? ctx.get('configEditor') : ctx?.configEditor
  } catch {}
  const api = createSettingsApi({ config: cfg, configEditor })

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname
      if (path === '/api/om-messiah/config') {
        if (req.method === 'GET') return sendJson(res, 200, api.read())
        if (req.method === 'POST') {
          const body = await readJson(req)
          const result = await api.save(body)
          return sendJson(res, result.status, result.body)
        }
        return sendJson(res, 405, { ok: false, error: `不支持 ${req.method}` })
      }
      if (path === '/api/om-messiah/preview' && req.method === 'POST') {
        const body = await readJson(req)
        const result = api.preview(body)
        return sendJson(res, result.status, result.body)
      }
      return sendJson(res, 404, { ok: false, error: `未知接口 ${req.method} ${path}` })
    } catch (error) {
      warn(error)
      try {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      } catch {}
    }
  }

  try {
    ctx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: '/api/om-messiah',
          handler,
        }),
      'om-messiah: 设置页接口',
    )
  } catch (error) {
    warn(error)
  }
}
