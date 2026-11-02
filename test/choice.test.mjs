import assert from 'node:assert/strict'
import test from 'node:test'

import { CHOICE_ID, OPTION_ORIGINAL, OPTION_PRAYER, askRoute, choiceQuestions, fallbackRoute, readChoice } from '../lib/choice.js'

test('the question offers exactly the two routes', () => {
  const [item] = choiceQuestions()
  assert.equal(item.id, CHOICE_ID)
  assert.equal(item.options.length, 2)
  assert.deepEqual(
    item.options.map((option) => option.label),
    [OPTION_PRAYER, OPTION_ORIGINAL],
  )
  assert.equal(item.multiSelect, undefined)
})

test('readChoice maps labels, custom text and junk', () => {
  assert.equal(readChoice({ answers: [{ id: CHOICE_ID, selected: [OPTION_PRAYER] }] }), 'prayer')
  assert.equal(readChoice({ answers: [{ id: CHOICE_ID, selected: [OPTION_ORIGINAL] }] }), 'original')
  // a single-select custom answer replaces the label, with selected left empty
  assert.equal(readChoice({ answers: [{ id: CHOICE_ID, selected: [], custom: OPTION_ORIGINAL }] }), 'original')
  // skipped question / unknown label / missing payload → no route
  assert.equal(readChoice({ answers: [{ id: CHOICE_ID, selected: [] }] }), null)
  assert.equal(readChoice({ answers: [{ id: CHOICE_ID, selected: ['随便'] }] }), null)
  assert.equal(readChoice({}), null)
  assert.equal(readChoice(null), null)
})

test('fallbackRoute defaults to the prayer', () => {
  assert.equal(fallbackRoute('original'), 'original')
  assert.equal(fallbackRoute('prayer'), 'prayer')
  assert.equal(fallbackRoute(undefined), 'prayer')
})

test('askRoute passes the live agent and returns the chosen route', async () => {
  const calls = []
  const userQuestions = {
    async ask(request) {
      calls.push(request)
      return { answers: [{ id: CHOICE_ID, selected: [OPTION_ORIGINAL] }] }
    },
  }
  const agent = { id: 'session-1' }
  const route = await askRoute({ userQuestions, agent, timeoutMs: 5000 })
  assert.equal(route, 'original')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].agent, agent)
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.equal(calls[0].questions[0].id, CHOICE_ID)
})

test('askRoute returns null without a service or an agent', async () => {
  assert.equal(await askRoute({}), null)
  assert.equal(await askRoute({ userQuestions: { ask: async () => ({}) } }), null)
})

test('askRoute forwards the turn abort to the question', async () => {
  const controller = new AbortController()
  const userQuestions = {
    ask: (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('ASK_ABORTED')))
      }),
  }
  const route = askRoute({ userQuestions, agent: { id: 's' }, signal: controller.signal, timeoutMs: 5000 })
  controller.abort()
  await assert.rejects(route, /ASK_ABORTED/)
})

test('askRoute leaves the caller signal untouched after settling', async () => {
  const controller = new AbortController()
  const userQuestions = { ask: async () => ({ answers: [{ id: CHOICE_ID, selected: [OPTION_PRAYER] }] }) }
  assert.equal(await askRoute({ userQuestions, agent: { id: 's' }, signal: controller.signal, timeoutMs: 5000 }), 'prayer')
  assert.equal(controller.signal.aborted, false)
})
