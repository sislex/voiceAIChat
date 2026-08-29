// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { aliasTargets, applyHostAlias, parseHostAliases } from './security.js'

describe('parseHostAliases', () => {
  it('разбирает список пар и не спотыкается о пробелы', () => {
    const aliases = parseHostAliases(' 89.125.68.35:8787 = voicechat:8787 , 89.125.68.35:443=caddy:443 ')
    expect(aliases.get('89.125.68.35:8787')).toBe('voicechat:8787')
    expect(aliases.get('89.125.68.35:443')).toBe('caddy:443')
  })
  it('мусор пропускается, пустое значение даёт пустую карту', () => {
    expect(parseHostAliases('без-стрелки,=,a=').size).toBe(0)
    expect(parseHostAliases(undefined).size).toBe(0)
  })
})

describe('applyHostAlias', () => {
  const aliases = parseHostAliases('89.125.68.35:8787=voicechat:8787,89.125.68.35:443=caddy:443,example.org=internal')

  it('подменяет host и порт, сохраняя путь, запрос и хеш', () => {
    expect(applyHostAlias(new URL('http://89.125.68.35:8787/api/health?a=1'), aliases).toString())
      .toBe('http://voicechat:8787/api/health?a=1')
    // Хеш-маршрут интерфейса должен доезжать целиком: именно им открывают доску.
    expect(applyHostAlias(new URL('http://89.125.68.35:8787/#/projects/p1'), aliases).toString())
      .toBe('http://voicechat:8787/#/projects/p1')
  })
  it('порт по умолчанию учитывается: https без порта — это 443', () => {
    const aliased = applyHostAlias(new URL('https://89.125.68.35/api/health'), aliases)
    expect(aliased.hostname).toBe('caddy')
    // 443 у https — порт по умолчанию, URL его не печатает; путь при этом цел.
    expect(aliased.toString()).toBe('https://caddy/api/health')
  })
  it('алиас без порта действует на любой порт этого хоста', () => {
    expect(applyHostAlias(new URL('http://example.org:9000/x'), aliases).hostname).toBe('internal')
  })
  it('чужие адреса не трогаются', () => {
    const url = new URL('https://example.com/page')
    expect(applyHostAlias(url, aliases).toString()).toBe('https://example.com/page')
    expect(applyHostAlias(url, parseHostAliases('')).toString()).toBe('https://example.com/page')
  })
})

describe('aliasTargets', () => {
  it('целями считаются и «host:port», и просто host', () => {
    const targets = aliasTargets(parseHostAliases('89.125.68.35:8787=voicechat:8787'))
    expect(targets.has('voicechat:8787')).toBe(true)
    expect(targets.has('voicechat')).toBe(true)
    expect(targets.has('89.125.68.35:8787')).toBe(false)
  })
  it('пустая карта не разрешает ничего — гейт остаётся закрытым', () => {
    expect(aliasTargets(parseHostAliases('')).size).toBe(0)
  })
})
