import { parse } from 'acorn'

interface SyntaxNode { type: string; start: number; end: number; [key: string]: unknown }
const isNode = (value: unknown): value is SyntaxNode => !!value && typeof value === 'object' && 'type' in value && typeof value.type === 'string'
const literalValue = (node: unknown): string | null => {
  if (!isNode(node)) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0 && Array.isArray(node.quasis)) {
    const quasi = node.quasis[0] as { value?: { cooked?: unknown } } | undefined
    return typeof quasi?.value?.cooked === 'string' ? quasi.value.cooked : null
  }
  return null
}

/** AST отличает импорт от примера кода в строке/комментарии/регулярном выражении. */
export function rewritePreviewModules(code: string, base: URL, proxy: (value: string, base: URL) => string): string {
  let root: unknown
  try { root = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowReturnOutsideFunction: true }) }
  catch { return code }
  const edits: Array<{ start: number; end: number; value: string }> = []
  const replace = (node: unknown, resource = false): void => {
    const value = literalValue(node)
    if (!isNode(node) || value === null || !resource && !/^(?:\.{0,2}\/|https?:\/\/)/i.test(value)) return
    const target = proxy(value, base)
    if (value === target) return
    const quote = code[node.start] === "'" ? "'" : '"'
    const escaped = quote === "'" ? target.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : JSON.stringify(target).slice(1, -1)
    edits.push({ start: node.start, end: node.end, value: quote + escaped + quote })
  }
  const metaUrl = (node: unknown): boolean => isNode(node) && node.type === 'MemberExpression' && node.computed === false
    && isNode(node.property) && node.property.type === 'Identifier' && node.property.name === 'url'
    && isNode(node.object) && node.object.type === 'MetaProperty'
    && isNode(node.object.meta) && node.object.meta.name === 'import'
  const walk = (node: unknown): void => {
    if (!isNode(node)) return
    if (['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) replace(node.source)
    if (node.type === 'NewExpression' && isNode(node.callee) && node.callee.type === 'Identifier' && node.callee.name === 'URL'
      && Array.isArray(node.arguments) && node.arguments.length === 2 && metaUrl(node.arguments[1])) replace(node.arguments[0], true)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (isNode(value)) walk(value)
    }
  }
  walk(root)
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end)
  return code
}

/** Адреса import map обязаны совпадать с адресами модулей после rewrite. */
export function rewritePreviewImportMap(source: string, base: URL, proxy: (value: string, base: URL) => string): string {
  try {
    const map: unknown = JSON.parse(source)
    if (!map || typeof map !== 'object' || Array.isArray(map)) return source
    const target = (value: string): string => /^(?:\.{0,2}\/|https?:\/\/)/i.test(value) ? proxy(value, base) : value
    const entries = (value: unknown): unknown => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      return Object.fromEntries(Object.entries(value).map(([key, address]) => [target(key), typeof address === 'string' ? target(address) : address]))
    }
    const result = { ...map } as Record<string, unknown>
    if ('imports' in result) result.imports = entries(result.imports)
    if (result.scopes && typeof result.scopes === 'object' && !Array.isArray(result.scopes)) {
      result.scopes = Object.fromEntries(Object.entries(result.scopes).map(([scope, mapping]) => [proxy(scope, base), entries(mapping)]))
    }
    // JSON остаётся текстом script даже при '<' в имени неизвестного поля.
    return JSON.stringify(result).replace(/</g, '\\u003c')
  } catch { return source }
}
