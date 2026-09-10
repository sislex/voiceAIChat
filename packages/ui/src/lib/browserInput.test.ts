import { expect, it } from 'vitest'
import { frameKeyAction, frameWheelDelta, remainingTypedDraft } from './browserInput'
const key = (key: string, extra = {}) =>
  frameKeyAction({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
it('прямой Unicode-ввод не теряет символы вне BMP', () => {
  expect(key('Я')).toEqual({ type: 'type', text: 'Я' })
  expect(key('😀')).toEqual({ type: 'type', text: '😀' })
})
it('Shift+Tab и клавиши редактирования сохраняют семантику', () => {
  expect(key('Tab', { shiftKey: true })).toEqual({ type: 'press', key: 'Shift+Tab' })
  for (const name of ['Delete', 'Home', 'End', 'PageUp', 'PageDown'])
    expect(key(name)).toEqual({ type: 'press', key: name })
})
it('primary editing modifier определяется раннером', () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }])
    expect(key('a', extra)).toEqual({ type: 'press', key: 'ControlOrMeta+a' })
  expect(key('Z', { metaKey: true, shiftKey: true })).toEqual({ type: 'press', key: 'ControlOrMeta+Shift+z' })
})
it('paste и промежуточные IME события не дублируются', () => {
  expect(key('v', { ctrlKey: true })).toBeNull()
  expect(key('Я', { isComposing: true })).toBeNull()
  expect(key('Dead')).toBeNull()
})
it('колесо переводит line и page отдельно по осям', () => {
  expect(frameWheelDelta({ deltaX: 2, deltaY: 3, deltaMode: 1 }, { width: 390, height: 844 })).toEqual({
    deltaX: 32,
    deltaY: 48
  })
  expect(frameWheelDelta({ deltaX: 1, deltaY: 1, deltaMode: 2 }, { width: 390, height: 844 })).toEqual({
    deltaX: 390,
    deltaY: 844
  })
})
it('ответ ввода сохраняет дополнение и заменённый черновик', () => {
  expect(remainingTypedDraft('abcXYZ', 'abc')).toBe('XYZ')
  expect(remainingTypedDraft('new', 'abc')).toBe('new')
  expect(remainingTypedDraft('abc', 'abc')).toBe('')
})
