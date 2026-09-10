import { expect, it } from 'vitest'
import { isBrowserSiteDataResetResult, normalizeBrowserProfileMode, normalizeBrowserSiteDataReset } from './browserProfile'

it('одноразовый профиль остаётся совместимым значением по умолчанию', () => {
  expect(normalizeBrowserProfileMode(undefined)).toBe('ephemeral')
  expect(normalizeBrowserProfileMode('persistent')).toBe('persistent')
  expect(() => normalizeBrowserProfileMode('permanent')).toThrow(/profileMode/)
})
it('очистка явно различает текущий сайт и все сайты сессии', () => {
  expect(normalizeBrowserSiteDataReset({})).toEqual({ scope: 'current' })
  expect(normalizeBrowserSiteDataReset({ scope: 'all' })).toEqual({ scope: 'all' })
  expect(normalizeBrowserSiteDataReset({ scope: 'all', host: ' MAIL.EXAMPLE.COM ' })).toEqual({ scope: 'all', host: 'mail.example.com' })
})
it('ошибочный host не расширяет очистку до всех сайтов', () => {
  for (const host of ['', ' ', 'https://example.com', 'example.com/path', 'a@b', 'a?x', 'a#x', 'a\\b']) {
    expect(() => normalizeBrowserSiteDataReset({ scope: 'all', host })).toThrow(/host/)
  }
  expect(() => normalizeBrowserSiteDataReset({ host: 'example.com' })).toThrow(/scope/)
})

it('сброс требует подтверждения выполненной очистки, а не ready-метаданных', () => {
  expect(isBrowserSiteDataResetResult({ ok: true, clearedCookies: 0, clearedOrigins: [] })).toBe(true)
  for (const result of [undefined, true, {}, { state: 'ready' }, { ok: true }, { ok: false, clearedCookies: 2, clearedOrigins: [] }, { ok: true, clearedCookies: -1, clearedOrigins: [] }, { ok: true, clearedCookies: 1, clearedOrigins: [null] }]) expect(isBrowserSiteDataResetResult(result)).toBe(false)
  expect(() => normalizeBrowserSiteDataReset({ scope: null } as never)).toThrow(/scope/)
})
