import { describe, expect, it } from 'vitest'
import { aliasNote, offOrigin, pushHistory } from './readerAddress'

describe('aliasNote', () => {
  it('молчит, когда подмены не было', () => {
    expect(aliasNote('http://89.125.68.35:8787/', null)).toBeNull()
    expect(aliasNote('http://89.125.68.35:8787/', undefined)).toBeNull()
  })
  it('объясняет подмену по факту от раннера, а не по расхождению адресов', () => {
    expect(aliasNote('http://89.125.68.35:8787/', 'voicechat:8787'))
      .toBe('Запрошен 89.125.68.35:8787, страница загружена с voicechat:8787: адрес подменён алиасом раннера.')
  })
  it('на мусоре не падает', () => {
    expect(aliasNote('не адрес', 'voicechat:8787')).toBeNull()
  })
})

describe('pushHistory', () => {
  it('новый адрес встаёт первым', () => {
    expect(pushHistory(['http://b/'], 'http://a/')).toEqual(['http://a/', 'http://b/'])
  })
  it('повтор подряд не плодит записей', () => {
    expect(pushHistory(['http://a/'], 'http://a/')).toEqual(['http://a/'])
  })
  it('возврат на прежний адрес поднимает его наверх, а не дублирует', () => {
    expect(pushHistory(['http://b/', 'http://a/'], 'http://a/')).toEqual(['http://a/', 'http://b/'])
  })
  it('длина ограничена — история не растёт без предела', () => {
    const many = Array.from({ length: 25 }, (_, i) => `http://x/${i}`)
    expect(pushHistory(many, 'http://new/', 20)).toHaveLength(20)
  })
  it('пустой адрес игнорируется', () => {
    expect(pushHistory(['http://a/'], null)).toEqual(['http://a/'])
  })
})

describe('offOrigin', () => {
  it('другой хост посреди проверки — повод сказать', () => {
    expect(offOrigin('http://89.125.68.35:8787/', 'https://accounts.google.com/signin')).toBe(true)
  })
  it('другой путь и порт того же сайта — не уход', () => {
    expect(offOrigin('http://89.125.68.35:8787/', 'http://89.125.68.35:8787/#/projects')).toBe(false)
  })
  it('без данных молчит', () => {
    expect(offOrigin(null, 'http://a/')).toBe(false)
    expect(offOrigin('http://a/', null)).toBe(false)
  })
})

describe('offOrigin и алиас вместе', () => {
  it('подмена алиасом не превращается во вторую тревогу', () => {
    // Живая проверка круга 13 показала обе надписи разом про одно и то же:
    // «адрес подменён алиасом» и «страница ушла с проверяемого сайта».
    expect(offOrigin('http://89.125.68.35:8787/', 'http://voicechat:8787/', true)).toBe(false)
  })
  it('без алиаса смена хоста по-прежнему тревога', () => {
    expect(offOrigin('http://89.125.68.35:8787/', 'https://accounts.example.com/', false)).toBe(true)
  })
})
