import { describe, it, expect } from 'vitest'
import { chipClass } from './view'

describe('chipClass — цвет подписи по движку', () => {
  it('Claude и Codex получают разные классы', () => {
    expect(chipClass('ai', true, 'claude')).toBe('chip spa')
    expect(chipClass('ai', true, 'codex')).toBe('chip spx')
  })

  it('без движка (старые сообщения) — как Claude', () => {
    expect(chipClass('ai', true)).toBe('chip spa')
  })

  it('реплики пользователя не зависят от движка', () => {
    expect(chipClass('u1', true)).toBe('chip sp1')
    expect(chipClass('u2', true)).toBe('chip sp2')
    expect(chipClass('u1', false)).toBe('chip sp1')
  })
})
