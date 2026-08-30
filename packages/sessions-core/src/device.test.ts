import { describe, expect, it } from 'vitest'
import { deviceIcon, parseUserAgent } from './device'

// Строки собраны из реальных заголовков: разбор ломается именно на них, а не на выдуманных.
const UA = {
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.2651.98',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  curl: 'curl/8.6.0',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  agent: 'VoiceChatAgent/1.4.2 (darwin)',
  electron: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/33.0.0 Chrome/130.0.0.0 Safari/537.36'
}

describe('parseUserAgent', () => {
  it('различает браузер, версию, ОС и класс устройства', () => {
    expect(parseUserAgent(UA.macChrome)).toMatchObject({ browser: 'Chrome', browserVersion: '128', os: 'macOS', osVersion: '10.15', kind: 'desktop', label: 'Chrome 128 · macOS' })
    expect(parseUserAgent(UA.winEdge)).toMatchObject({ browser: 'Edge', browserVersion: '127', os: 'Windows', osVersion: '10/11', kind: 'desktop' })
    expect(parseUserAgent(UA.firefox)).toMatchObject({ browser: 'Firefox', browserVersion: '129', os: 'Linux', kind: 'desktop' })
    expect(parseUserAgent(UA.opera)).toMatchObject({ browser: 'Opera', browserVersion: '112', os: 'Windows' })
  })

  it('мобильные: телефон и планшет, Chrome на iOS остаётся Chrome', () => {
    expect(parseUserAgent(UA.iphone)).toMatchObject({ browser: 'Safari', browserVersion: '17', os: 'iOS', osVersion: '17.5', kind: 'phone' })
    expect(parseUserAgent(UA.ipad)).toMatchObject({ os: 'iOS', kind: 'tablet' })
    expect(parseUserAgent(UA.android)).toMatchObject({ browser: 'Chrome', os: 'Android', osVersion: '14', kind: 'phone' })
    // Android без маркера Mobile — планшет: так эту строку размечает сам Google.
    expect(parseUserAgent(UA.androidTablet)).toMatchObject({ os: 'Android', kind: 'tablet' })
    expect(parseUserAgent(UA.chromeIos)).toMatchObject({ browser: 'Chrome', browserVersion: '125', os: 'iOS', kind: 'phone' })
  })

  it('не-браузерные клиенты: curl, поисковый робот и собственный агент', () => {
    expect(parseUserAgent(UA.curl)).toMatchObject({ browser: 'curl', browserVersion: '8.6.0', kind: 'bot' })
    expect(parseUserAgent(UA.bot).kind).toBe('bot')
    // У собственного агента в строке нет ОС — класс устройства честно неизвестен.
    expect(parseUserAgent(UA.agent)).toMatchObject({ browser: 'VoiceChatAgent', kind: 'unknown' })
  })

  it('пустой и унаследованный UA дают legacy без подписи, мусор не роняет разбор', () => {
    for (const ua of ['', '   ', null, undefined, 'legacy']) {
      expect(parseUserAgent(ua)).toMatchObject({ legacy: true, kind: 'unknown', label: '' })
    }
    expect(parseUserAgent('%%%').legacy).toBe(false)
    // Слишком длинную строку режем: она приходит из заголовка и может быть любой.
    expect(parseUserAgent('X'.repeat(5000)).browser.length).toBeLessThanOrEqual(40)
  })

  it('десктоп-приложение опознаётся как Electron, а не как Chrome', () => {
    // Внутри Electron тот же Chrome, но человеку важно отличать приложение от
    // вкладки браузера — иначе в списке устройств они выглядят одинаково.
    expect(parseUserAgent(UA.electron)).toMatchObject({ browser: 'Electron', browserVersion: '33.0.0', os: 'macOS', kind: 'desktop', label: 'Electron 33 · macOS' })
    expect(parseUserAgent(UA.macChrome).label).toBe('Chrome 128 · macOS')
  })

  it('иконка зависит от класса устройства', () => {
    expect(deviceIcon(parseUserAgent(UA.iphone).kind)).toBe('📱')
    expect(deviceIcon(parseUserAgent(UA.macChrome).kind)).toBe('💻')
    expect(deviceIcon(parseUserAgent(UA.bot).kind)).toBe('🤖')
    expect(deviceIcon('unknown')).toBe('❔')
  })
})
