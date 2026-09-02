// Переводы ошибок изолированного Chromium: сетевые коды Playwright и коды
// самого раннера доходили до человека буквально — «page.goto:
// net::ERR_NAME_NOT_RESOLVED at http://…» в панели и «not_found» после того,
// как сессию убрал сборщик простоя.

import { describe, expect, it } from 'vitest'
import { describeBrowserRunnerCode, describeNavigationError, humanizeNavigationError, isBrowserSessionLostCode } from './browserErrors'

describe('describeNavigationError', () => {
  it('имя не разрешается — про адрес, с самим адресом', () => {
    const text = describeNavigationError('page.goto: net::ERR_NAME_NOT_RESOLVED at https://нет-такого.example/\nCall log:\n  - navigating to …')
    expect(text).toBe('Страница не открылась: имя сайта не разрешается (проверьте адрес) — https://нет-такого.example/')
  })
  it('запрет политикой объясняет, кто пускает во внутреннюю сеть', () => {
    expect(describeNavigationError('page.goto: net::ERR_BLOCKED_BY_CLIENT at http://10.0.0.1/')).toContain('политикой раннера')
  })
  it('таймаут навигации — в секундах', () => {
    expect(describeNavigationError('page.goto: Timeout 30000ms exceeded.')).toBe('Страница не загрузилась за 30 с')
  })
  it('незнакомый сетевой код всё равно не прячется за «page.goto:»', () => {
    expect(describeNavigationError('page.goto: net::ERR_SOMETHING_NEW at http://a/')).toBe('Страница не открылась: ERR_SOMETHING_NEW — http://a/')
  })
  it('не сетевой текст не переводится: подменять «примерно тем же» хуже, чем оставить', () => {
    expect(describeNavigationError('locator.click: Target closed')).toBeNull()
    expect(humanizeNavigationError('locator.click: Target closed\nCall log')).toBe('locator.click: Target closed')
  })
})

describe('коды раннера', () => {
  it('not_found и stale_incarnation означают потерянную сессию', () => {
    expect(isBrowserSessionLostCode('not_found')).toBe(true)
    expect(isBrowserSessionLostCode('stale_incarnation')).toBe(true)
    expect(isBrowserSessionLostCode('stale_tab')).toBe(false)
    expect(isBrowserSessionLostCode(undefined)).toBe(false)
  })
  it('у каждого кода есть текст с действием, у не-кода — нет', () => {
    expect(describeBrowserRunnerCode('not_found')).toMatch(/Перезапустите панель/)
    expect(describeBrowserRunnerCode('stale_tab')).toMatch(/выберите другую/)
    expect(describeBrowserRunnerCode('Browser Runner недоступен')).toBeNull()
  })
})
