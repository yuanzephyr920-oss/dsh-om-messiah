/**
 * Faithful restyling of one user request.
 *
 * The restyle is a *single left-to-right scan* over the text. At every offset a
 * protected pattern wins over a substitution, so code, URLs, paths, versions,
 * identifiers, numbers and quoted strings pass through untouched. Every emitted
 * segment remembers the exact source characters it replaced, which makes the
 * result provably lossless: `segments.map(s => s.source).join('') === input`.
 *
 * Substitutions are conservative on purpose: they only rewrite imperatives and
 * first-person wishes into prayer voice ("写一个" -> "降下", "我需要" -> "您的信徒渴求").
 * No technical noun, no quantity and no constraint is ever touched.
 */

/** Patterns whose matches must reach the model byte-for-byte. */
const PROTECT = [
  // fenced code first, so its interior never gets split by later patterns
  /```[\s\S]*?```/y,
  /~~~[\s\S]*?~~~/y,
  /`[^`\n]{1,400}`/y,
  /https?:\/\/[^\s<>"'（）()，。；、]+/y,
  /[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]+/y,
  /(?:^|(?<=\s))(?:\.{0,2}\/|~\/)[^\s，。；、）]+/y,
  /\b[\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|yml|yaml|toml|css|scss|less|html|sh|bash|ps1|bat|cmd|txt|log|csv|xlsx|docx|pdf|png|jpe?g|svg|gif|webp|mp4|zip|tgz|wasm|db|sql)\b/iy,
  /[\u4e00-\u9fff][\u4e00-\u9fff\w-]*\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|yml|yaml|toml|css|html|sh|ps1|txt|log|csv|xlsx|docx|pdf|png|jpe?g|svg)/y,
  /\b[A-Za-z_$][\w$.]*\([^()\n]{0,200}\)/y,
  /\b[a-zA-Z]+_[a-zA-Z0-9_]+\b/y,
  /"[^"\n]{1,300}"|'[^'\n]{1,300}'/y,
  /<\/?[A-Za-z][^>\n]{0,200}>/y,
  /\bv?\d+(?:\.\d+){1,3}\b/y,
  /\b\d+(?:\.\d+)?\s?(?:px|em|rem|vh|vw|ms|kb|mb|gb|hz|fps|%)\b/iy,
]

/**
 * Imperative -> prayer-voice rewrites, longest first. Each entry is
 * [pattern, replacement] where pattern is a sticky regex anchored at the offset.
 */
const D = (source) => new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'y')

const SUBSTITUTIONS = [
  [D('请帮我'), '恳请您为您的信徒'],
  [D('帮我'), '祈求您为您的信徒'],
  [D('麻烦你'), '恳请您'],
  [D('麻烦您'), '恳请您'],
  [D('麻烦'), '恳请'],
  [D('我需要'), '您的信徒渴求'],
  [D('我想要'), '您的信徒渴望'],
  [D('我要'), '您的信徒渴求'],
  [D('给我'), '赐予您的信徒'],
  [D('写一个'), '降下'],
  [D('写一段'), '降下'],
  [D('写一份'), '降下'],
  [D('写个'), '降下'],
  [D('实现一个'), '降下'],
  [D('做一个'), '降下'],
  [D('做个'), '降下'],
  [D('生成一个'), '降下'],
  [D('生成'), '降下'],
  [D('实现'), '降下神迹以实现'],
  [D('创建'), '塑造'],
  [D('搭建'), '构筑'],
  [D('设计'), '擘画'],
  [D('要求'), '信徒虔诚地祈求'],
  [D('必须'), '务请'],
  [D('不要'), '恳请您切勿'],
  [D('禁止'), '恳请您切勿'],
  [D('需要'), '渴求'],
  // "请" alone, but never inside 请求/请示/请假/请教/请勿/请您/请问
  [/请(?!求|示|假|教|勿|您|问|柬|缨)/y, '恳请'],
]

/** Offset of the next protected match at (or after) `i`, or -1. */
function protectAt(text, i) {
  for (const pattern of PROTECT) {
    pattern.lastIndex = i
    const match = pattern.exec(text)
    if (match !== null && match.index === i && match[0].length > 0) return match[0]
  }
  return null
}

/** Offset of the next substitution at `i`, or null. */
function substituteAt(text, i) {
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    pattern.lastIndex = i
    const match = pattern.exec(text)
    if (match !== null && match.index === i && match[0].length > 0) {
      return { source: match[0], text: replacement }
    }
  }
  return null
}

/**
 * Restyle one request.
 *
 * @param {string} input raw user prose.
 * @returns {{text: string, segments: Array<{kind: string, text: string, source: string}>}}
 *   `segments` is the lossless ledger: joining `source` reproduces the input.
 */
export function restyle(input) {
  const text = String(input ?? '')
  const segments = []
  let i = 0
  while (i < text.length) {
    const guarded = protectAt(text, i)
    if (guarded !== null) {
      segments.push({ kind: 'protected', text: guarded, source: guarded })
      i += guarded.length
      continue
    }
    const swapped = substituteAt(text, i)
    if (swapped !== null) {
      segments.push({ kind: 'substituted', text: swapped.text, source: swapped.source })
      i += swapped.source.length
      continue
    }
    const last = segments[segments.length - 1]
    if (last !== undefined && last.kind === 'raw') {
      last.text += text[i]
      last.source += text[i]
    } else {
      segments.push({ kind: 'raw', text: text[i], source: text[i] })
    }
    i += 1
  }
  return { text: segments.map((segment) => segment.text).join(''), segments }
}

/** Rebuild the original text from a restyle ledger (used by the tests). */
export function reconstruct(segments) {
  return segments.map((segment) => segment.source).join('')
}

/** Protected spans, in order — the "must reach the model verbatim" set. */
export function protectedSpans(segments) {
  return segments.filter((segment) => segment.kind === 'protected').map((segment) => segment.text)
}
