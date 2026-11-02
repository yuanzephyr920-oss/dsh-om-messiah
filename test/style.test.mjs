import assert from 'node:assert/strict'
import test from 'node:test'

import { protectedSpans, reconstruct, restyle } from '../lib/style.js'

test('restyle is lossless: joining segment sources reproduces the input', () => {
  const input = '请帮我用 three.js 做一个海中小岛，要求 60fps。参考 https://threejs.org/docs 与 C:\\work\\island\\main.js'
  const { segments } = restyle(input)
  assert.equal(reconstruct(segments), input)
})

test('protected spans reach the output byte-for-byte', () => {
  const input = [
    '请帮我实现 `quicksort(arr)`，要求 v1.2.3 兼容，端口 8080，参考 https://example.com/a?b=1',
    '```python',
    'def f(x):',
    '    return x  # 注释与缩进都要保留',
    '```',
  ].join('\n')
  const { text, segments } = restyle(input)
  for (const span of protectedSpans(segments)) assert.ok(text.includes(span), `missing span: ${span}`)
  assert.ok(text.includes('```python'))
  assert.ok(text.includes('    return x  # 注释与缩进都要保留'))
})

test('imperatives are rewritten into prayer voice', () => {
  const { text } = restyle('请帮我写一个 Python 快速排序，要求带注释和单元测试')
  assert.ok(text.includes('恳请您为您的信徒'))
  assert.ok(text.includes('降下 Python 快速排序'))
  assert.ok(text.includes('信徒虔诚地祈求'))
})

test('protected spans are never substituted, even when they contain trigger words', () => {
  const input = '实现函数 need_help() 与 创建.json，路径 D:\\work\\请帮我.txt'
  const { text, segments } = restyle(input)
  assert.ok(text.includes('need_help()'))
  assert.ok(text.includes('创建.json'))
  assert.ok(text.includes('D:\\work\\请帮我.txt'))
  assert.equal(reconstruct(segments), input)
})

test('URLs, versions and numbers survive untouched', () => {
  const input = '我要把 https://api.example.com/v1/items?page=2 的结果缓存 30 秒，版本 2.1.0'
  const { text } = restyle(input)
  assert.ok(text.includes('https://api.example.com/v1/items?page=2'))
  assert.ok(text.includes('30'))
  assert.ok(text.includes('2.1.0'))
})

test('the agent is always addressed as 您', () => {
  const { text } = restyle('你的方案有问题，你们再看一下你自己写的注释，妳也确认下')
  assert.ok(text.includes('您的方案'))
  assert.ok(text.includes('您们'))
  assert.ok(text.includes('您自己'))
  assert.ok(text.includes('您也确认下'))
  assert.ok(!/[你妳]/.test(text))
})

test('帮你/请你 become prayerful requests instead of stacking pronouns', () => {
  assert.equal(restyle('你能帮我写个排序').text, '恳请您为您的信徒降下排序')
  assert.equal(restyle('你能不能帮我改一下').text, '可否恳请您为您的信徒改一下')
  assert.equal(restyle('请实现一个登录页').text, '恳请您降下登录页')
})

test('用 before a technology name turns into 以 without touching 使用/作用', () => {
  assert.equal(restyle('用 three.js 做一个岛').text, '以 three.js 降下岛')
  assert.ok(restyle('使用这个接口的时候注意作用域').text.includes('使用这个接口'))
  assert.ok(restyle('使用这个接口的时候注意作用域').text.includes('作用域'))
})
