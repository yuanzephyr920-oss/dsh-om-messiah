import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'
import { CALL, CLOSING } from '../lib/prayer.js'

function harness(config, services = {}) {
  const listeners = []
  const logs = []
  const ctx = {
    get: (key) => services[key],
    logger: {
      info: (line) => logs.push(line),
      warn: (line) => logs.push(`WARN ${line}`),
    },
    on: (event, listener) => {
      if (event === 'agent/pre-step') listeners.push(listener)
      return () => {}
    },
  }
  apply(ctx, config)
  assert.equal(listeners.length, 1, 'the plugin must register exactly one pre-step listener')
  return { listener: listeners[0], logs }
}

const userMessage = (text, id = 'u1') => ({
  id,
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

const enter = (...messages) => ({ kind: 'enter', messages })

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** A userQuestions stand-in that records requests and answers with `label`. */
function asker(label, error) {
  const calls = []
  return {
    calls,
    async ask(request) {
      calls.push(request)
      if (error !== undefined) throw error
      return { answers: [{ id: 'om-messiah-route', selected: [label] }] }
    },
  }
}

const webServer = { register: () => () => {} }

test('the claimed user prompt is replaced, plugin snapshots are left alone', async () => {
  const { listener } = harness({ enabled: true, intensity: 'medium', echo: false })
  const originalMessage = userMessage('写一个 Python 快速排序，要求带注释和单元测试')
  const runtime = {
    id: 'r1',
    role: 'user',
    source: { kind: 'plugin', form: 'snapshot' },
    content: [{ type: 'text', text: '<runtime context>' }],
  }
  const decision = await listener({}, async () => enter(originalMessage, runtime))

  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 2)
  const [user, context] = decision.messages
  assert.equal(user.id, 'u1')
  assert.equal(user.role, 'user')
  assert.equal(user.source.kind, 'user')
  assert.notEqual(user, originalMessage)
  assert.equal(originalMessage.content[0].text, '写一个 Python 快速排序，要求带注释和单元测试')
  assert.ok(user.content[0].text.startsWith(CALL))
  assert.ok(user.content[0].text.endsWith(CLOSING))
  assert.ok(user.content[0].text.includes('Python 快速排序'))
  assert.equal(context.content[0].text, '<runtime context>')
})

test('non-text blocks are preserved untouched', async () => {
  const { listener } = harness({ echo: false })
  const message = {
    id: 'u2',
    role: 'user',
    source: { kind: 'user' },
    content: [
      { type: 'image', attachment: { attachmentId: 'a1' } },
      { type: 'text', text: '请帮我处理这张图' },
      { type: 'file', attachment: { attachmentId: 'a2' } },
    ],
  }
  const decision = await listener({}, async () => enter(message))
  const content = decision.messages[0].content
  assert.deepEqual(content[0], message.content[0])
  assert.deepEqual(content[2], message.content[2])
  assert.ok(content[1].text.includes('这张图'))
})

test('disabled plugin sends the original prompt', async () => {
  const { listener } = harness({ enabled: false })
  const original = enter(userMessage('写一个 Python 快速排序'))
  const decision = await listener({}, async () => original)
  assert.equal(decision, original)
})

test('an already liturgical message is not wrapped twice', async () => {
  const { listener } = harness({ echo: false })
  const first = await listener({}, async () => enter(userMessage('写一个 Python 快速排序')))
  const wrapped = first.messages[0].content[0].text
  const second = await listener({}, async () => enter(userMessage(wrapped, 'u3')))
  assert.equal(second.messages[0].content[0].text, wrapped)
})

test('slash commands and confirmations pass through', async () => {
  const { listener } = harness({ echo: false })
  for (const text of ['/compact', '继续', '好的', '!git status']) {
    const original = enter(userMessage(text))
    const decision = await listener({}, async () => original)
    assert.equal(decision, original, `must not wrap: ${text}`)
  }
})

test('rejected steps pass through unchanged', async () => {
  const { listener } = harness({ echo: false })
  const reject = { kind: 'reject' }
  const decision = await listener({}, async () => reject)
  assert.equal(decision, reject)
})

test('a failure downstream is propagated, never swallowed', async () => {
  const { listener } = harness({ echo: false })
  await assert.rejects(
    listener({}, async () => {
      throw new Error('downstream exploded')
    }),
    /downstream exploded/,
  )
})

test('echo writes the rewritten text to the host log', async () => {
  const { listener, logs } = harness({ echo: true })
  await listener({}, async () => enter(userMessage('写一个 Python 快速排序')))
  await settle()
  const joined = logs.join('\n')
  assert.ok(joined.includes('[dsh-om-messiah] wrapped'))
  assert.ok(joined.includes(CALL))
  assert.ok(joined.includes('----- original -----'))
  assert.ok(joined.includes('写一个 Python 快速排序'))
})

test('the question is asked and the prayer is sent when the user picks it', async () => {
  const questions = asker('发送祷文')
  const { listener, logs } = harness({ echo: true }, { userQuestions: questions, webServer })
  const agent = { id: 'session-1' }
  const decision = await listener({ agent }, async () => enter(userMessage('写一个 Python 快速排序')))

  assert.equal(questions.calls.length, 1)
  assert.equal(questions.calls[0].agent, agent)
  assert.ok(decision.messages[0].content[0].text.startsWith(CALL))
  await settle()
  assert.ok(logs.join(String.fromCharCode(10)).includes('choice: 发送祷文'))
})

test('picking the original sends the user text untouched', async () => {
  const questions = asker('发送原文')
  const { listener } = harness({ echo: false }, { userQuestions: questions, webServer })
  const original = enter(userMessage('写一个 Python 快速排序'))
  const decision = await listener({ agent: { id: 's' } }, async () => original)
  assert.equal(decision, original)
  assert.equal(decision.messages[0].content[0].text, '写一个 Python 快速排序')
})

test('an unanswerable question falls back to the configured route', async () => {
  for (const [fallback, expectPrayer] of [['prayer', true], ['original', false]]) {
    const questions = asker('发送祷文', new Error('ASK_ABORTED'))
    const { listener } = harness({ echo: false, choiceFallback: fallback }, { userQuestions: questions, webServer })
    const original = enter(userMessage('写一个 Python 快速排序'))
    const decision = await listener({ agent: { id: 's' } }, async () => original)
    if (expectPrayer) assert.ok(decision.messages[0].content[0].text.startsWith(CALL))
    else assert.equal(decision, original)
  }
})

test('a late webServer never suppresses the question', async () => {
  // The Host may expose `webServer` only after this plugin applies; the card
  // depends on the answerer service, not on the web server (issue #1).
  const questions = asker('发送原文')
  const { listener } = harness({ echo: false, choiceFallback: 'prayer' }, { userQuestions: questions })
  const original = enter(userMessage('写一个 Python 快速排序'))
  const decision = await listener({ agent: { id: 's' } }, async () => original)
  assert.equal(questions.calls.length, 1)
  assert.equal(decision, original)
})

test('without the userQuestions service the fallback applies', async () => {
  const { listener } = harness({ echo: false, choiceFallback: 'original' }, { webServer })
  const original = enter(userMessage('写一个 Python 快速排序'))
  const decision = await listener({ agent: { id: 's' } }, async () => original)
  assert.equal(decision, original)
})

test('turning the confirmation off never asks', async () => {
  const questions = asker('发送原文')
  const { listener } = harness({ echo: false, askChoice: false }, { userQuestions: questions, webServer })
  const decision = await listener({ agent: { id: 's' } }, async () => enter(userMessage('写一个 Python 快速排序')))
  assert.equal(questions.calls.length, 0)
  assert.ok(decision.messages[0].content[0].text.startsWith(CALL))
})

test('a skipped prompt is never asked about', async () => {
  const questions = asker('发送原文')
  const { listener } = harness({ echo: false }, { userQuestions: questions, webServer })
  const original = enter(userMessage('/compact'))
  const decision = await listener({ agent: { id: 's' } }, async () => original)
  assert.equal(decision, original)
  assert.equal(questions.calls.length, 0)
})
