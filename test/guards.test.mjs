import assert from 'node:assert/strict'
import test from 'node:test'

import { classify, isAlreadyStyled } from '../lib/guards.js'

const skip = (text) => {
  const verdict = classify(text, { maxChars: 20000 })
  assert.equal(verdict.skip, true, `expected skip for: ${text}`)
  return verdict.reason
}

test('empty input is skipped', () => {
  assert.equal(skip('   \n\t '), 'empty')
})

test('slash commands are skipped', () => {
  assert.equal(skip('/compact now'), 'slash-command')
  assert.equal(skip('/model deepseek-chat'), 'slash-command')
})

test('shell-prefixed input is skipped', () => {
  assert.equal(skip('!git status'), 'shell-prefix')
  assert.equal(skip('$ ls -la'), 'shell-prefix')
})

test('bare confirmations are skipped', () => {
  for (const text of ['继续', '好的', '好', '嗯嗯', 'ok', 'OK!', '收到', '谢谢', '可以', 'continue']) {
    assert.equal(skip(text), 'confirmation')
  }
})

test('already liturgical text is skipped by default', () => {
  assert.equal(isAlreadyStyled('伟大而不朽的万机之神欧姆弥赛亚'), true)
  assert.equal(skip('欧姆弥赛亚在上！请继续'), 'already-styled')
  assert.deepEqual(classify('欧姆弥赛亚在上！', { rewrapAlreadyStyled: true }).skip, false)
})

test('pasted code is skipped', () => {
  const code = ['```js', 'const a = 1', 'function f() { return a }', '```'].join('\n')
  assert.equal(skip(code), 'code-or-log-paste')
})

test('a python traceback without a question is skipped', () => {
  const traceback = [
    'Traceback (most recent call last):',
    '  File "main.py", line 3, in <module>',
    '    raise ValueError("boom")',
    'ValueError: boom',
  ].join('\n')
  assert.equal(skip(traceback), 'code-or-log-paste')
})

test('a real request mentioning an error is wrapped', () => {
  const text = '我的服务报 TypeError: x is not a function，请帮我定位原因'
  assert.equal(classify(text, {}).skip, false)
})

test('over-long input is skipped', () => {
  const verdict = classify('写一个函数'.repeat(20), { maxChars: 10 })
  assert.equal(verdict.reason, 'too-long')
})

test('ordinary requests are wrapped', () => {
  assert.deepEqual(classify('写一个 Python 快速排序，要求带注释和单元测试', {}), { skip: false })
})
