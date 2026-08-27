import { describe, expect, it } from 'vitest'
import { pwnedCount } from './pwned'

describe('pwnedCount', () => {
  it('находит суффикс в ответе range и возвращает счётчик; отсутствие → 0; ошибка сети → null', async () => {
    // SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const ok = async () => ({ ok: true, text: async () => '0018A45C4D1DEF81644B54AB7F969B88D65:1\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\n' })
    expect(await pwnedCount('password', ok)).toBe(3861493)
    expect(await pwnedCount('unique-pass-xyz', ok)).toBe(0)
    expect(await pwnedCount('password', async () => { throw new Error('offline') })).toBeNull()
  })
})
