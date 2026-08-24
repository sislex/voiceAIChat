let fallbackSequence = 0

/** Creates a synchronous browser-safe identifier without requiring a secure context. */
export function browserId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER
  const time = Date.now().toString(36)
  const sequence = fallbackSequence.toString(36)
  let random = ''
  try { random = Math.random().toString(36).slice(2) } catch { /* sequence still guarantees session-local uniqueness */ }
  return `local-${time}-${sequence}-${random || '0'}`
}
