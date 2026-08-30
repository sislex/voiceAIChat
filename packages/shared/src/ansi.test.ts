import { describe, expect, it } from 'vitest'
import { hasAnsi, parseAnsi, stripAnsi } from './ansi'

/** ESC пишем escape-последовательностью: литеральный символ в исходнике невидим. */
const E = '\u001b'

describe('ansi', () => {
  it('режет строку на отрезки с оформлением и не плодит пустые', () => {
    expect(parseAnsi(`${E}[1m${E}[32m✓${E}[0m ok`)).toEqual([
      { bold: true, color: 'green', bright: false, text: '✓' },
      { text: ' ok' }
    ])
  })

  it('строка без разметки остаётся одним отрезком', () => {
    expect(parseAnsi('обычная строка')).toEqual([{ text: 'обычная строка' }])
    expect(parseAnsi('')).toEqual([])
  })

  it('понимает несколько кодов в одной последовательности и точечный сброс', () => {
    expect(parseAnsi(`${E}[1;4;31mтекст${E}[24mдальше`)).toEqual([
      { bold: true, underline: true, color: 'red', bright: false, text: 'текст' },
      { bold: true, color: 'red', bright: false, text: 'дальше' }
    ])
  })

  it('яркие цвета 90–97 помечаются bright, фон 40–47 отдельным полем', () => {
    expect(parseAnsi(`${E}[91;44mгорит`)).toEqual([
      { color: 'red', bright: true, background: 'blue', text: 'горит' }
    ])
  })

  // `ESC[m` без параметров терминалы читают как полный сброс.
  it('пустая последовательность сбрасывает оформление', () => {
    expect(parseAnsi(`${E}[31mкрасный${E}[mобычный`)).toEqual([
      { color: 'red', bright: false, text: 'красный' },
      { text: 'обычный' }
    ])
  })

  it('вырезает то, чему в статичном логе делать нечего', () => {
    // Перемещение курсора, очистка строки и OSC-ссылка.
    expect(stripAnsi(`${E}[2K${E}[1Aсброшено${E}]8;;https://x${E}\\ссылка`)).toBe('сброшеноссылка')
    expect(parseAnsi(`${E}[32m${E}[2Kзелёный`)).toEqual([{ color: 'green', bright: false, text: 'зелёный' }])
  })

  it('stripAnsi оставляет текст, hasAnsi отвечает дёшево', () => {
    expect(stripAnsi(`${E}[33mTest Files${E}[0m  1 failed`)).toBe('Test Files  1 failed')
    expect(hasAnsi(`${E}[33m`)).toBe(true)
    expect(hasAnsi('Test Files')).toBe(false)
  })
})
