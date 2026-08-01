// Раскладка колонки чата: шапка задачи с раскрытой лентой рана не имеет права
// выдавливать композер за нижний край экрана.
//
// Как ломалось: `.main` — колонка ровно в высоту экрана, `.taskchat` в ней
// обычный элемент без потолка, а лента рана держала `max-height: 45vh`. На
// телефоне сумма «шапка чата + шапка задачи + лента + композер» перевешивала
// экран: `.scroll` садилась на свой минимум (одни отступы), остаток уезжал вниз,
// а прокрутить страницу нельзя — у `.app` стоит `overflow: hidden`. Композер
// становился недоступен. Измерено в headless-браузере: 360×640, тридцать шагов
// в ленте — `.voicebar` кончалась на 741px при экране 640px.
//
// Отдельная ловушка — единицы: `vh` на мобильном браузере считается от
// «большого» вьюпорта (без адресной строки), а колонка живёт в `100dvh`, так что
// `45vh` внутри `100dvh` — заведомо больше сорока пяти процентов колонки.
// Поэтому потолок стоит в процентах от `.main`, а лента забирает остаток шапки.

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decl, mediaBody } from './cssRules'

describe('app.css — колонка чата не выдавливает композер', () => {
  it('колонка чата ровно в экран', () => {
    expect(decl('.main', 'height')).toBe('100vh')
    expect(decl('.main', 'min-height')).toBe('0')
  })

  it('у шапки задачи есть потолок высоты в процентах от колонки', () => {
    const max = decl('.taskchat', 'max-height')
    expect(max).toMatch(/%$/)
    expect(Number.parseInt(max ?? '', 10)).toBeLessThanOrEqual(50)
    expect(decl('.taskchat', 'min-height')).toBe('0')
  })

  it('внутри шапки скроллится лента рана, а не строки с крошками и метой', () => {
    expect(decl('.taskchat-feed', 'overflow')).toBe('auto')
    expect(decl('.taskchat-feed', 'min-height')).toBe('0')
    expect(decl('.taskchat-feed', 'flex')).toBe('1 1 auto')
    // Потолок в vh вернул бы ровно тот баг, из-за которого правило переписано.
    expect(decl('.taskchat-feed', 'max-height')).toBeNull()
    for (const selector of ['.taskchat-top', '.taskchat-meta']) {
      expect(decl(selector, 'flex'), selector).toBe('none')
    }
  })

  it('скроллится лента сообщений', () => {
    expect(decl('.scroll', 'overflow-y')).toBe('auto')
    expect(decl('.scroll', 'flex')).toBe('1')
    expect(decl('.scroll', 'min-height')).toBe('0')
  })

  it('на телефоне шапке задачи достаётся меньше, а ленте сообщений — больше', () => {
    // Отступы .scroll — её фактический минимум: колонка сжимает ленту первой.
    const phone = mediaBody('(max-width: 768px)')
    expect(phone).toMatch(/\.taskchat\s*\{[^}]*max-height:\s*40%/)
    expect(phone).toMatch(/\.scroll\s*\{[^}]*padding:\s*14px 0/)
  })
})
