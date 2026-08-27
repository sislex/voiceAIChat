// Мини-валидатор JSON Schema для моков (roadmap-4 п.31): подмножество ключевых слов, достаточное для форм —
// type, required, properties, enum, minLength/maxLength, minimum/maximum, pattern, format email, items.
// Без внешних зависимостей: ajv в браузерном/серверном бандле ради моков избыточен.

export interface SchemaIssue { path: string; message: string }

type Schema = {
  type?: string | string[]
  required?: string[]
  properties?: Record<string, Schema>
  enum?: unknown[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  format?: string
  items?: Schema
  additionalProperties?: boolean
}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

export function validateJsonSchema(schema: unknown, value: unknown, path = ''): SchemaIssue[] {
  if (!schema || typeof schema !== 'object') return []
  const s = schema as Schema
  const issues: SchemaIssue[] = []
  const at = (p: string): string => (path ? `${path}.${p}` : p)
  if (s.type) {
    const allowed = Array.isArray(s.type) ? s.type : [s.type]
    const actual = typeOf(value)
    const ok = allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'))
    if (!ok) { issues.push({ path: path || '$', message: `ожидается ${allowed.join(' | ')}, получено ${actual}` }); return issues }
  }
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) issues.push({ path: path || '$', message: `значение не из списка: ${s.enum.map((e) => JSON.stringify(e)).join(', ')}` })
  if (typeof value === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength) issues.push({ path: path || '$', message: `короче ${s.minLength} символов` })
    if (s.maxLength !== undefined && value.length > s.maxLength) issues.push({ path: path || '$', message: `длиннее ${s.maxLength} символов` })
    if (s.pattern && !new RegExp(s.pattern).test(value)) issues.push({ path: path || '$', message: `не соответствует шаблону ${s.pattern}` })
    if (s.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) issues.push({ path: path || '$', message: 'некорректный email' })
  }
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) issues.push({ path: path || '$', message: `меньше ${s.minimum}` })
    if (s.maximum !== undefined && value > s.maximum) issues.push({ path: path || '$', message: `больше ${s.maximum}` })
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of s.required ?? []) if (obj[key] === undefined || obj[key] === '') issues.push({ path: at(key), message: 'обязательное поле' })
    for (const [key, sub] of Object.entries(s.properties ?? {})) if (obj[key] !== undefined) issues.push(...validateJsonSchema(sub, obj[key], at(key)))
    if (s.additionalProperties === false) for (const key of Object.keys(obj)) if (!s.properties || !(key in s.properties)) issues.push({ path: at(key), message: 'лишнее поле' })
  }
  if (Array.isArray(value) && s.items) value.forEach((item, i) => issues.push(...validateJsonSchema(s.items, item, `${path || '$'}[${i}]`)))
  return issues
}
