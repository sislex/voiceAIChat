import postcss from 'postcss'
import valueParser from 'postcss-value-parser'

const decodeCss = (value: string): string => value.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|(\r\n|[\n\r\f])|(.))/gi, (_match, hex: string | undefined, newline: string | undefined, char: string | undefined) => {
  if (hex) { const cp = parseInt(hex, 16); return !cp || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? '\ufffd' : String.fromCodePoint(cp) }
  return newline ? '' : char || ''
})

/** CSS парсится отдельно от значений: комментарий и content не являются ресурсами. */
export function rewritePreviewCss(source: string, base: URL, url: (value: string, base: URL) => string): string {
  const rewriteValue = (input: string, importRule = false): string => {
    const parsed = valueParser(input)
    const rewriteNode = (node: valueParser.Node): void => {
      if (node.type !== 'word' && node.type !== 'string' || 'unclosed' in node && node.unclosed) return
      const decoded = decodeCss(node.value)
      if (!decoded || decoded.trim().startsWith('#')) return
      const next = url(decoded, base)
      if (next === decoded) return
      Object.assign(node, { type: 'string', quote: '"', value: next.replace(/\\/g, '\\\\').replace(/"/g, '\\"') })
    }
    if (importRule) {
      const first = parsed.nodes.find(node => node.type !== 'space' && node.type !== 'comment')
      if (first?.type === 'string') rewriteNode(first)
    }
    parsed.walk(node => {
      if (node.type !== 'function' || node.unclosed) return
      if (node.value.toLowerCase() === 'url') {
        const args = node.nodes.filter(item => item.type !== 'space' && item.type !== 'comment')
        if (args.length === 1) rewriteNode(args[0])
        return false
      }
      if (/^(?:-webkit-)?image-set$/i.test(node.value)) node.nodes.filter(item => item.type === 'string').forEach(rewriteNode)
    })
    return parsed.toString()
  }
  try {
    const root = postcss.parse(source)
    root.walkDecls(decl => { decl.value = rewriteValue(decl.value) })
    root.walkAtRules(/^import$/i, rule => { rule.params = rewriteValue(rule.params, true) })
    return root.toString()
  } catch { return source }
}

/** В srcset запятая внутри URL допустима; разделитель ищется после дескрипторов. */
export function rewritePreviewSrcset(source: string, base: URL, url: (value: string, base: URL) => string): string {
  let position = 0, copied = 0, result = ''
  const whitespace = (char: string): boolean => /[\t\n\f\r ]/.test(char)
  while (position < source.length) {
    while (position < source.length && (whitespace(source[position]) || source[position] === ',')) position++
    const start = position
    while (position < source.length && !whitespace(source[position])) position++
    let end = position
    while (end > start && source[end - 1] === ',') end--
    if (end > start) {
      result += source.slice(copied, start) + url(source.slice(start, end), base)
      copied = end
    }
    if (end < position) continue
    let depth = 0
    while (position < source.length) {
      const char = source[position++]
      if (char === '(') depth++
      else if (char === ')') depth = Math.max(0, depth - 1)
      else if (char === ',' && !depth) break
    }
  }
  return result + source.slice(copied)
}
