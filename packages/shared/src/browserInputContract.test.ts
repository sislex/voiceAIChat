import { expect, it } from 'vitest'
import { isPreviewAction } from './previewActions'
import { planModelAction } from './browserActions'
it('горизонтальный сдвиг включая ноль проходит общий контракт и план модели', () => {
  for (const dx of [0, 250, -250]) {
    const action = { kind: 'scroll' as const, selector: '#pane', frame: ['#child'], dx }
    expect(isPreviewAction(action)).toBe(true)
    expect(planModelAction(action)).toEqual({
      kind: 'command',
      command: { type: 'selector', frame: ['#child'], action: { kind: 'scroll', selector: '#pane', dx } }
    })
  }
})
it('сдвиг ограничен и не принимает нечисловые значения', () => {
  for (const dx of ['250', NaN, Infinity, 100001]) expect(isPreviewAction({ kind: 'scroll', dx })).toBe(false)
  expect(isPreviewAction({ kind: 'scroll' })).toBe(false)
})
