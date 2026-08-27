// TOTP (RFC 6238, HMAC-SHA1, 30 с, 6 цифр) для второго фактора (auth-roadmap п.6). Без зависимостей:
// секрет — base32 (как ждут Google Authenticator/1Password), проверка с окном ±1 шаг на рассинхрон часов.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const out: number[] = []
  let bits = 0, value = 0
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20))

export function totpCode(secret: string, step = Math.floor(Date.now() / 30_000)): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const off = h[h.length - 1]! & 0xf
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!
  return String(bin % 1_000_000).padStart(6, '0')
}

/** Код верен для текущего шага или соседних (±30 с). */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const c = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(c)) return false
  const step = Math.floor(now / 30_000)
  return [step - 1, step, step + 1].some((s) => { const expected = totpCode(secret, s); return expected.length === c.length && timingSafeEqual(Buffer.from(expected), Buffer.from(c)) })
}

/** Ссылка для приложения-аутентификатора (QR строит клиент или пользователь вводит ключ вручную). */
export function otpauthUrl(user: string, secret: string, issuer = 'ChatAI'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
