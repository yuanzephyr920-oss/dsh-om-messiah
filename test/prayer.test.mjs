import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CALL,
  CLOSING,
  SELF,
  SELF_LONG,
  WISH_LEAD,
  buildPrayer,
  normalizeConfig,
} from '../lib/prayer.js'
import { reconstruct } from '../lib/style.js'

test('the five liturgical elements appear in order', () => {
  const { text } = buildPrayer('写一个 Python 快速排序，要求带注释和单元测试')
  const order = [CALL, SELF, WISH_LEAD, CLOSING].map((part) => text.indexOf(part))
  for (const index of order) assert.ok(index >= 0, 'a fixed section is missing')
  assert.deepEqual([...order].sort((a, b) => a - b), order)
})

test('the request is carried inside the wish, verbatim where it matters', () => {
  const original = '用 three.js 做一个海中小岛，岛上要有 `seasonSystem`，帧率 60fps，参考 https://threejs.org 文档'
  const { text, petition } = buildPrayer(original)
  for (const must of ['three.js', 'seasonSystem', '60fps', 'https://threejs.org']) {
    assert.ok(text.includes(must), `lost: ${must}`)
  }
  assert.ok(text.includes('海中小岛'))
  assert.ok(petition.length > 0)
})

test('the petition is lossless relative to the raw request', () => {
  const original = '请帮我实现一个 CLI，支持 --dry-run 与 --port 8080，路径 C:\\tool\\bin\\run.ps1'
  const { segments } = buildPrayer(original)
  assert.equal(reconstruct(segments), original)
})

test('low intensity is short, high intensity is elaborate', () => {
  const short = buildPrayer('写个函数', { intensity: 'low' }).text
  const high = buildPrayer('写个函数', { intensity: 'high' }).text
  assert.ok(!short.includes(SELF_LONG))
  assert.ok(high.includes(SELF_LONG))
  assert.ok(high.length > short.length)
})

test('every intensity keeps call, wish lead and closing', () => {
  for (const intensity of ['low', 'medium', 'high']) {
    const { text } = buildPrayer('实现一个排序算法', { intensity })
    assert.ok(text.startsWith(CALL))
    assert.ok(text.includes(WISH_LEAD))
    assert.ok(text.endsWith(CLOSING))
  }
})

test('plain quote style does not prefix lines', () => {
  const quoted = buildPrayer('写个函数', { quoteStyle: 'quote' }).text
  const plain = buildPrayer('写个函数', { quoteStyle: 'plain' }).text
  assert.ok(quoted.includes('\n> '))
  assert.ok(!plain.includes('\n> '))
})

test('a code block stays byte-identical and separated from the liturgy', () => {
  const code = ['```python', 'def quicksort(a):', '    return sorted(a)', '```'].join('\n')
  const { text } = buildPrayer(`请帮我写一个函数：\n${code}`)
  assert.ok(text.includes(code))
})

test('normalizeConfig fills defaults and clamps unknown intensity', () => {
  const config = normalizeConfig({ intensity: 'ludicrous', enabled: false })
  assert.equal(config.intensity, 'medium')
  assert.equal(config.enabled, false)
  assert.equal(config.quoteStyle, 'quote')
  assert.equal(config.maxChars, 20000)
})
