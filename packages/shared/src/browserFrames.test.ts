import { expect, it } from 'vitest'
import { isBrowserFramePath, normalizeBrowserFramePath } from './browserFrames'

it('frame задаётся одним селектором или последовательностью вложенных iframe', () => {
  expect(normalizeBrowserFramePath()).toEqual([])
  expect(normalizeBrowserFramePath('#preview')).toEqual(['#preview'])
  const original = ['#preview', 'iframe[name="login"]']
  expect(normalizeBrowserFramePath(original)).toEqual(original)
  expect(normalizeBrowserFramePath(original)).not.toBe(original)
})

it('пустой, неверный или чрезмерно глубокий scope не превращается в родительскую страницу', () => {
  for (const value of ['', ' ', [], [''], ['#frame', 1], null, {}, Array(9).fill('iframe'), 'x'.repeat(2001)]) {
    expect(isBrowserFramePath(value)).toBe(false)
    expect(() => normalizeBrowserFramePath(value as string)).toThrow(/frame/)
  }
})
