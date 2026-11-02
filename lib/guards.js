/**
 * Which inputs must NOT be wrapped.
 *
 * The rule is "never make a short command, a bare confirmation, a code dump or
 * a stack trace longer than it is": those either are not requests for work
 * (slash commands, `!` shell lines, "继续", "好的") or the original bytes are
 * the whole message (pasted code, pasted error). They pass through untouched.
 */

const CONFIRMATION =
  /^(?:继续(?:吧|干|做)?|好(?:的)?|嗯+|哦+|ok(?:ay)?|yes|yep|no|nope|行|可以|收到|明白|知道了|谢谢|多谢|辛苦了|干得好|不错|nice|cool|go on|continue|keep going)[\s。.!！~～、，]*$/i

const STYLED_MARKERS = ['欧姆弥赛亚', '万机之神', '机械之道学者', '机械神教', '您的孩子向您许愿', '欧姆弥赛亚在上']

const STACK_TRACE = [
  /Traceback \(most recent call last\)/,
  /^\s+at .+:\d+:\d+/m,
  /^\s*File ".*", line \d+/m,
  /^(?:Uncaught\s+)?(?:Type|Range|Reference|Syntax|Import|Module|Name|Value|Key|Index|Attribute)Error\b/m,
]

const CODE_LINE = /^\s*(?:[$>#]\s|(?:const|let|var|function|class|import|export|def|from|return|if|for|while|try|catch|module|package)\b|[{}()[\];=]|\/\/|\/\*|<\/?[A-Za-z]|--[a-z-]+)/

const CJK = /[\u4e00-\u9fff]/

/** Already a prayer? */
export function isAlreadyStyled(text) {
  return STYLED_MARKERS.some((marker) => text.includes(marker))
}

/** A whole message that is one fenced code block. */
function isFencedOnly(trimmed) {
  return /^(?:```|~~~)[^\n]*\n[\s\S]*\n(?:```|~~~)$/.test(trimmed)
}

/** Code or log dump: no CJK prose, and most lines look like code/stack frames. */
function looksLikePaste(text, trimmed) {
  if (isFencedOnly(trimmed)) return true
  if (STACK_TRACE.some((pattern) => pattern.test(text))) {
    // a stack trace with a real question around it is still a request
    return !CJK.test(text)
  }
  if (CJK.test(text)) return false
  const lines = trimmed.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < 2) return false
  const codeLines = lines.filter((line) => CODE_LINE.test(line)).length
  return codeLines / lines.length >= 0.6
}

/**
 * Decide whether one text block may be wrapped.
 *
 * @param {string} text
 * @param {{maxChars?: number, rewrapAlreadyStyled?: boolean}} config
 * @returns {{skip: boolean, reason?: string}}
 */
export function classify(text, config = {}) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { skip: true, reason: 'empty' }
  if (trimmed.startsWith('/')) return { skip: true, reason: 'slash-command' }
  if (/^[!$](?:\s|$)/.test(trimmed) || /^[!$][A-Za-z]/.test(trimmed)) return { skip: true, reason: 'shell-prefix' }
  if (CONFIRMATION.test(trimmed)) return { skip: true, reason: 'confirmation' }
  const maxChars = config.maxChars ?? 20000
  if (trimmed.length > maxChars) return { skip: true, reason: 'too-long' }
  if (config.rewrapAlreadyStyled !== true && isAlreadyStyled(trimmed)) {
    return { skip: true, reason: 'already-styled' }
  }
  if (looksLikePaste(text, trimmed)) return { skip: true, reason: 'code-or-log-paste' }
  return { skip: false }
}
