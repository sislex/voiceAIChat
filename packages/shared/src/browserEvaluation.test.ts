import { expect, it } from 'vitest'
import { normalizeBrowserEvaluateOptions } from './browserEvaluation'
import { isPreviewAction } from './previewActions'
import { planModelAction } from './browserActions'
it('задаёт default deadline и сохраняет явный лимит модели', () => {
  expect(normalizeBrowserEvaluateOptions({ code: '1+2' })).toEqual({ code: '1+2', timeoutMs: 5000 })
  expect(planModelAction({ kind: 'evaluate', code: '1+2', timeoutMs: 100 })).toEqual({
    kind: 'command',
    command: { type: 'inspect', action: { kind: 'evaluate', code: '1+2', timeoutMs: 100 } }
  })
})
it.each([0, -1, 1.5, 99, 15001, '100'])('отвергает невалидный timeout %j', (timeoutMs) => {
  expect(isPreviewAction({ kind: 'evaluate', code: 'window.changed=true', timeoutMs })).toBe(false)
})
it('не принимает пустой и слишком большой код', () => {
  expect(isPreviewAction({ kind: 'evaluate', code: ' ' })).toBe(false)
  expect(isPreviewAction({ kind: 'evaluate', code: 'x'.repeat(4001) })).toBe(false)
  expect(isPreviewAction({ kind: 'evaluate', code: '1+2', timeoutMs: 15000 })).toBe(true)
})
