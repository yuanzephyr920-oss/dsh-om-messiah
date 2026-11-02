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
