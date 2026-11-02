import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

/** Minimal React surface the settings panel touches. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
}

async function loadClient() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let bundle
  const style = { setAttribute() {}, textContent: '' }
  const context = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          bundle = definition
        },
      },
    },
    document: {
      createElement: () => style,
      head: { appendChild() {} },
    },
    fetch: async () => {
      throw new Error('no network in tests')
    },
    require: (id) => {
      assert.equal(id, 'react')
      return React
    },
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'client.js' })
  return { bundle, context, style }
}

test('client bundle self-registers with the package id', async () => {
  const { bundle } = await loadClient()
  assert.ok(bundle, 'window.__ModuleLoader__.load was not called')
  assert.equal(bundle.id, '@local/dsh-mechanicus')
  assert.equal(typeof bundle.factory, 'function')
  const half = bundle.factory((id) => (id === 'react' ? React : undefined))
  assert.equal(typeof half.apply, 'function')
  assert.equal(half.inject.length, 1)
  assert.equal(half.inject[0], 'slots')
})

test('apply registers exactly one settings.section page', async () => {
  const { bundle, style } = await loadClient()
  const half = bundle.factory(() => React)

  const registrations = []
  const injections = []
  const slots = {
    inject(name, callback) {
      injections.push(name)
      callback()
    },
    register(definition, component) {
      registrations.push({ definition, component })
      return () => {}
    },
  }
  const disposers = []
  const ctx = {
    get: (key) => (key === 'slots' ? slots : undefined),
    effect(fn) {
      disposers.push(fn())
      return () => {}
    },
  }
  half.apply(ctx)

  assert.deepEqual(injections, ['settings.section'])
  assert.equal(registrations.length, 1)
  const { definition, component } = registrations[0]
  assert.equal(definition.name, 'settings.section')
  assert.equal(definition.id, 'mechanicus')
  assert.equal(definition.label, '机械神教')
  assert.equal(typeof definition.order, 'number')
  assert.equal(typeof component, 'function')
  assert.ok(style.textContent.includes('[data-mk-page]'))
  assert.equal(disposers.length, 1)

  // the registered component must render without throwing
  const element = component()
  assert.equal(typeof element.type, 'function')
  const tree = element.type(element.props)
  assert.equal(tree.props['data-mk-page'], '')
})

/** Pull the plugin's inline CSS back out of the bundle source. */
async function readCss() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const start = source.indexOf('const CSS = `')
  assert.ok(start >= 0, 'CSS block not found')
  const bodyStart = start + 'const CSS = `'.length
  const end = source.indexOf('`', bodyStart)
  assert.ok(end > bodyStart, 'CSS block not terminated')
  return source.slice(bodyStart, end)
}

test('every style rule is scoped under the page root, so no other plugin UI is touched', async () => {
  const css = await readCss()
  const selectors = [...css.matchAll(/(?:^|\n)\s*([^{}\n][^{}]*)\{/g)]
    .map((m) => m[1].trim())
    .filter((selector) => !selector.startsWith('@'))
  assert.ok(selectors.length > 10, 'expected the full rule set')
  for (const selector of selectors) {
    for (const part of selector.split(',')) {
      assert.ok(
        part.trim().startsWith('[data-mk-page]'),
        `unscoped selector would leak into other plugins: ${part.trim()}`,
      )
    }
  }
  assert.ok(!/!important/.test(css), 'never use !important against theme plugins')
})

test('uses only DSH theme tokens, always with a fallback, so themes restyle the page', async () => {
  const css = await readCss()
  // tokens confirmed present in @deepseek-ai/dsh-client-ui-theme (44.7.0) — keep this list in sync
  const allowed = new Set([
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-brand-primary',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-button-primary-hover',
    '--dsw-alias-interactive-bg-hover',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-primary-inverted',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-markdown-code-block',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-switch-thumb',
  ])
  const used = [...css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1])
  assert.ok(used.length > 10, 'expected the palette to come from theme tokens')
  for (const token of used) assert.ok(allowed.has(token), `unknown theme token: ${token}`)
  const bare = [...css.matchAll(/var\(--dsw-[a-z0-9-]+\)/g)]
  assert.deepEqual(bare.map((m) => m[0]), [], 'every token needs a fallback for hosts without that token')
})

test('client uses the same-origin settings API and never hardcodes a key', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(source.includes("'/api/mechanicus'"))
  assert.ok(source.includes('/config'))
  assert.ok(source.includes('/preview'))
  assert.ok(source.includes("credentials: 'same-origin'"))
  assert.ok(!/sk-[A-Za-z0-9]{8,}/.test(source), 'looks like a hardcoded API key')
})
