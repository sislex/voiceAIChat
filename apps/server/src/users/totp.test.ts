import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, otpauthUrl, totpCode, verifyTotp } from './totp'

describe('totp', () => {
  it('base32 туда-обратно', () => {
    const buf = Buffer.from('12345678901234567890')
    expect(base32Encode(buf)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(buf)).toBe(true)
  })
  it('вектор RFC 6238 (SHA1, секрет 12345678901234567890): T=59 → 287082 (6 цифр)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082')
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804')
  })
  it('verifyTotp принимает соседний шаг и отвергает мусор', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const now = 1111111109 * 1000
    expect(verifyTotp(secret, '081804', now)).toBe(true)
    expect(verifyTotp(secret, totpCode(secret, Math.floor(now / 30_000) - 1), now)).toBe(true)
    expect(verifyTotp(secret, '000000', now)).toBe(false)
    expect(verifyTotp(secret, '12', now)).toBe(false)
    expect(otpauthUrl('anna', secret)).toMatch(/^otpauth:\/\/totp\/ChatAI:anna\?secret=/)
  })
})
