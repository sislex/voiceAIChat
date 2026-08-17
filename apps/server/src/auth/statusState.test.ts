import { describe, expect, it, vi } from 'vitest'
import { AuthStatusState } from './statusState.js'

const initial = {
  claude: { provider: 'claude' as const, loggedIn: true, detail: 'ok' },
  codex: { provider: 'codex' as const, loggedIn: true, detail: 'ok' }
}

describe('AuthStatusState', () => {
  it('дедуплицирует эквивалентные снимки', async () => {
    const state = new AuthStatusState(async () => initial)
    const listener = vi.fn()
    state.subscribe(listener)
    await state.get('alex')
    state.set('alex', { ...initial })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('меняет только нужный CLI по auth-ошибке и игнорирует обычную ошибку', async () => {
    const state = new AuthStatusState(async () => initial)
    await state.get('alex')
    expect(state.reportRunError('alex', 'claude', 'вход в Claude не выполнен')).toBe(true)
    expect((await state.get('alex')).claude.loggedIn).toBe(false)
    expect((await state.get('alex')).codex.loggedIn).toBe(true)
    expect(state.reportRunError('alex', 'codex', 'network timeout')).toBe(false)
  })
})
