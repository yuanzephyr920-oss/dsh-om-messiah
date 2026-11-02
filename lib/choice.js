/**
 * "Which text should this turn send?" — the question the plugin asks after it
 * has lowered the prayer.
 *
 * The Host `userQuestions` service renders a live request in the Session
 * composer: a request that carries no tool call still gets a card, and closing
 * that card rejects the wait (`ASK_CANCELLED`). We therefore need no tool call
 * of our own — `ask()` alone puts the choice in front of the user, and the
 * answer comes back here as the waterfall's return value.
 *
 * Everything in this module is pure/awaitable and has no dependency on the
 * rest of the plugin, so the decision logic can be tested without a server.
 */

/** Question id, stable so an old draft cannot be mistaken for a new one. */
export const CHOICE_ID = 'om-messiah-route'

/** The two answers the card offers, in display order. */
export const OPTION_PRAYER = '发送祷文'
export const OPTION_ORIGINAL = '发送原文'

/** Default wait; a forgotten card must not park the turn forever. */
export const CHOICE_TIMEOUT_MS = 90000

/** The question batch shown to the user. */
export function choiceQuestions() {
  return [
    {
      id: CHOICE_ID,
      header: '欧姆弥赛亚',
      question: '祷文已降下。这一轮，用哪一段作为你的提示词？',
      options: [
        { label: OPTION_PRAYER, description: '把整段祷文发给模型（默认）。' },
        { label: OPTION_ORIGINAL, description: '只发你刚才敲的原文，祷文丢弃。' },
      ],
    },
  ]
}

/**
 * Turn a raw answer batch into one of the two routes.
 *
 * A single-select question may answer with `custom` (free text) instead of a
 * label; anything we do not recognise is treated as "no choice", so the caller
 * applies its configured fallback rather than guessing.
 *
 * @param {{answers?: Array<{id?: string, selected?: string[], custom?: string}>}} answer
 * @returns {'prayer'|'original'|null}
 */
export function readChoice(answer) {
  const items = Array.isArray(answer?.answers) ? answer.answers : []
  const item = items.find((entry) => entry?.id === CHOICE_ID) ?? items[0]
  if (item === null || typeof item !== 'object') return null
  const custom = typeof item.custom === 'string' ? item.custom.trim() : ''
  const selected = Array.isArray(item.selected) && typeof item.selected[0] === 'string' ? item.selected[0] : ''
  const label = custom !== '' ? custom : selected
  if (label === OPTION_ORIGINAL) return 'original'
  if (label === OPTION_PRAYER) return 'prayer'
  return null
}

/**
 * Ask, and resolve to the chosen route or `null` when no answer was possible.
 *
 * Returning `null` (instead of throwing) keeps the caller in charge of the
 * fallback: a headless run, a child agent, an abort or a timeout must never
 * cost the user their message. Only a genuine answer produces a route.
 *
 * @param {{
 *   userQuestions?: {ask?: Function},
 *   agent?: unknown,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<'prayer'|'original'|null>}
 */
export async function askRoute(options) {
  const { userQuestions, agent, signal } = options
  if (userQuestions === undefined || userQuestions === null || typeof userQuestions.ask !== 'function') return null
  // `ask()` authenticates a live runtime root; without an agent there is no
  // answerer at all, so asking would only produce NO_PROVIDER.
  if (agent === undefined || agent === null) return null

  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : CHOICE_TIMEOUT_MS

  const controller = new AbortController()
  if (signal?.aborted === true) controller.abort(signal.reason)
  const forward = () => {
    try {
      controller.abort(signal?.reason)
    } catch {
      controller.abort()
    }
  }
  if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', forward, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('dsh-om-messiah: choice timed out')), timeoutMs)
  // Never keep the process alive just for this timer (CLI runs must exit).
  if (typeof timer?.unref === 'function') timer.unref()

  try {
    const answer = await userQuestions.ask({ agent, signal: controller.signal, questions: choiceQuestions() })
    return readChoice(answer)
  } finally {
    clearTimeout(timer)
    if (signal !== undefined && signal !== null && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', forward)
    }
  }
}

/**
 * Apply the configured fallback when the question could not be answered.
 *
 * @param {'prayer'|'original'} fallback
 * @returns {'prayer'|'original'}
 */
export function fallbackRoute(fallback) {
  return fallback === 'original' ? 'original' : 'prayer'
}
