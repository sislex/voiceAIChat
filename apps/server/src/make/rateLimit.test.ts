import { describe, expect, it } from 'vitest'
import { SlidingWindowLimiter } from './rateLimit'

describe('SlidingWindowLimiter', () => {
  it('пускает limit попыток в окне, дальше отказ с retryAfter, окно скользит', () => {
    let now = 0
    const l = new SlidingWindowLimiter(3, 10_000, () => now)
    expect(l.hit('u').ok).toBe(true)
    expect(l.hit('u').ok).toBe(true)
    expect(l.hit('u')).toMatchObject({ ok: true, remaining: 0 })
    expect(l.hit('u')).toMatchObject({ ok: false, retryAfterSec: 10 })
    expect(l.hit('other').ok).toBe(true)
    now = 6_000
    expect(l.hit('u')).toMatchObject({ ok: false, retryAfterSec: 4 })
    now = 10_001
    expect(l.hit('u').ok).toBe(true)
  })
})
