<div align="center">

<img src="docs/icon.svg" width="88" alt="dsh-om-messiah" />

# 🕯️ dsh-om-messiah

**Every prompt, offered to the Machine God first.**

Rewrites each user prompt into a Mechanicus / Om Messiah prayer before it reaches the model — then lets you choose, per turn, whether to send the prayer or your original text.

<p>
  <a href="https://www.npmjs.com/package/dsh-om-messiah"><img src="https://img.shields.io/npm/v/dsh-om-messiah?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/yuanzephyr920-oss/dsh-om-messiah/stargazers"><img src="https://img.shields.io/github/stars/yuanzephyr920-oss/dsh-om-messiah?style=flat-square&color=d8a657" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4c8bf5?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/DSH-0.2%2B-8b5cf6?style=flat-square" alt="DSH 0.2+" />
  <img src="https://img.shields.io/badge/tests-73%20passed-2ea043?style=flat-square" alt="tests" />
  <img src="https://img.shields.io/badge/deps-0-555?style=flat-square" alt="zero dependencies" />
</p>

<p><sub><a href="README.md">中文</a> · English</sub></p>

</div>

---

## What it does

- **Rewrites at the right seam.** It hooks the host `agent/pre-step` waterfall — the one official place in DSH where the user message batch can be replaced before it enters the request. No patching DSH, no proxy, no network layer.
- **Asks before sending.** After the prayer is composed, an optional choice card asks whether to send the prayer or your original text. On timeout (default 90 s) it falls back to your configured choice.
- **Zero semantic loss.** Only imperative mood and pronouns change (`write a → bestow`, `you → Your Eminence`); code blocks, inline code, URLs, paths, versions and numbers are protected verbatim. `restyle()` returns a segment table that `reconstruct()` turns back into the original, and a test pins that identity.
- **Knows when to stay out.** Slash commands, `!shell` prefixes, bare confirmations, pure code/log pastes, oversized pastes and already-wrapped text are all skipped.
- **Three intensities, five customizable passages.** `low / medium / high`; address, self-description, praise, wish lead-in and closing can each be replaced with your own lines.
- **Zero third-party dependencies.** One ESM host plugin; with the switch off it behaves exactly like an uninstalled plugin.

## Install

```bash
dsh plugin --profile desktop add dsh-om-messiah
```

From a mirror that has not synced yet: add `--registry=https://registry.npmjs.org`.
From source: `dsh plugin --profile desktop add https://github.com/yuanzephyr920-oss/dsh-om-messiah`.

Restart DeepSeek Harness once (the desktop profile is managed by Electron). Settings then appear under **Settings → 欧姆弥赛亚**.

## See also

- Chinese documentation with screenshots, the full config table, the skip-rule table and the host contract notes: [README.md](README.md)
- Screenshots: [chat](docs/screenshot-chat.png) · [choice card](docs/screenshot-choice.png) · [settings](docs/screenshot-settings.png)

## Development

```bash
node --test              # 73 tests
node scripts/samples.mjs # three before/after samples
```

## Limits

The prompt is rewritten, not the model's tools: the prayer does not grant file/web access. The chat transcript shows the rewritten text (that is what the model received). A DSH update that removes `agent/pre-step` would require a new mount point; it is registered in exactly one place in `index.js`.

## License

[MIT](LICENSE) © 2026 yuanzephyr920-oss
