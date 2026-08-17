const SECRET_KEY = /(authorization|bearer|token|credential|password|secret|cookie|transport|bridge|socket)/i
const SECRET_VALUE = /(bearer\s+[a-z0-9._~-]+|(?:token|secret|password)=\S+)/ig
export function redactDiagnostics(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]')
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key,item]) => [key, redactDiagnostics(item)]))
  return value
}
