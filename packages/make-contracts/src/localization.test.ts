import { describe, expect, it } from 'vitest'
import { createMakeTextTranslator, formatMakeMessage, makeSystemMessages, resolveMakeLocale, translateMakeSystemText } from './localization.js'

describe('Make localization contracts', () => {
  it.each([
    [undefined, 'ru'], ['en-US,en;q=0.9,ru;q=0.8', 'en'], ['en;q=0.1,ru-RU;q=0.9', 'ru'],
    ['en;q=0,ru;q=0.2', 'ru'], ['fr,de,en-GB;q=0.3', 'en'], ['en;q=invalid', 'ru'], ['unknown', 'ru']
  ])('resolves supported language preferences: %s', (header, expected) => {
    expect(resolveMakeLocale(header)).toBe(expected)
  })

  it('translates errors in both directions while preserving paths and interpolation values', () => {
    const original = 'Файл «src/Привет.ts» не найден'
    const english = 'File “src/Привет.ts” not found'
    expect(translateMakeSystemText(original, 'en')).toBe(english)
    expect(translateMakeSystemText(english, 'ru')).toBe(original)
    expect(translateMakeSystemText('Проект занял 12 МБ из 20 — очистите снимки в «Место»', 'en'))
      .toBe('The project uses 12 MB of 20. Clean up snapshots in Storage.')
    expect(translateMakeSystemText('compiler details: λ <div>', 'ru')).toBe('compiler details: λ <div>')
  })

  it('does not evaluate or recursively interpolate supplied data', () => {
    expect(formatMakeMessage('{p0} / {p1}', { p0: '{p1}', p1: '<script>value</script>' }))
      .toBe('{p1} / <script>value</script>')
    const translate = createMakeTextTranslator({ file: { ru: 'Файл [{p0}] недоступен.', en: 'File [{p0}] is unavailable.' } })
    expect(translate('Файл [a.*?{p1}] недоступен.', 'en')).toBe('File [a.*?{p1}] is unavailable.')
  })

  it('provides English and Russian text with matching placeholders for every system message', () => {
    const parameters = (text: string) => [...new Set(text.match(/\{p\d+\}/g))].sort()
    for (const [key, message] of Object.entries(makeSystemMessages)) {
      expect(message.ru, key).not.toBe('')
      expect(message.en, key).not.toMatch(/[\u0400-\u04ff]/u)
      expect(parameters(message.en), key).toEqual(parameters(message.ru))
    }
  })
})
