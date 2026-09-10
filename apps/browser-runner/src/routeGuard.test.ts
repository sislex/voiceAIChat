// Разбор адреса в перехватчике запросов: что пропускаем, что режем и **чем**
// объясняем отказ.
//
// Несуществующий домен и адрес, запрещённый политикой, — разные беды. До круга
// 22 обе давали ERR_BLOCKED_BY_CLIENT, и человек думал, что его адрес в чёрном
// списке, хотя тот просто не резолвится. Проверено живьём сквозной проверкой
// этапа (`npm run qa-stage:check`).
//
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { aliasTargets, applyHostAlias, browserTarget, isBlockedAddress, parseHostAliases, previewOriginTarget, validatePublicUrl } from './security.js'

describe('решение перехватчика', () => {
  const aliases = parseHostAliases('89.125.68.35:8787=voicechat:8787')
  const targets = aliasTargets(aliases)

  const decide = (raw: string, resolved: string[] | 'dns-fail'): string => {
    let url: URL
    try { url = validatePublicUrl(raw, targets) } catch { return 'blockedbyclient' }
    const aliased = applyHostAlias(url, aliases)
    if (targets.has(browserTarget(aliased))) return 'continue'
    if (resolved === 'dns-fail') return 'namenotresolved'
    return resolved.some(isBlockedAddress) ? 'blockedbyclient' : 'continue'
  }

  it('внешний адрес пропускается', () => {
    expect(decide('https://example.com/', ['93.184.216.34'])).toBe('continue')
  })
  it('цель алиаса пропускается без проверки сети', () => {
    expect(decide('http://89.125.68.35:8787/', 'dns-fail')).toBe('continue')
  })
  it('несуществующий домен — «имя не разрешилось», а не «запрещено»', () => {
    expect(decide('https://нет-такого.example/', 'dns-fail')).toBe('namenotresolved')
  })
  it('приватный адрес запрещается политикой', () => {
    expect(decide('http://внутренний.example/', ['10.0.0.1'])).toBe('blockedbyclient')
    expect(decide('http://127.0.0.1/', [])).toBe('blockedbyclient')
  })
  it('не-http отвергается до всякой сети', () => {
    expect(decide('file:///etc/passwd', [])).toBe('blockedbyclient')
  })
})

// Браузерная проверка задачи ходит на сервер, а его имя в сети compose ведёт в
// приватную сеть: без доверенного origin запрос резался собственным
// SSRF-гейтом. Найдено живым прогоном — Chromium отвечал ERR_BLOCKED_BY_CLIENT.
describe('доверенный origin сервера', () => {
  it('разбирает адрес в host:port и подставляет порт по схеме', () => {
    expect(previewOriginTarget('http://voicechat:8787')).toBe('voicechat:8787')
    expect(previewOriginTarget('http://voicechat')).toBe('voicechat:80')
    expect(previewOriginTarget('https://chatai.example.test/')).toBe('chatai.example.test:443')
  })

  it('мусор и не-HTTP схемы origin не задают', () => {
    for (const raw of [undefined, '', 'не адрес', 'ftp://voicechat:21', 'voicechat:8787']) {
      expect(previewOriginTarget(raw as string | undefined)).toBeNull()
    }
  })

  it('доверенный origin пропускается, несмотря на приватный резолв; чужой приватный — нет', () => {
    const targets = aliasTargets(new Map())
    const origin = previewOriginTarget('http://voicechat:8787')!
    targets.add(origin)
    const decide = (raw: string, resolved: string[]): string => {
      const url = validatePublicUrl(raw, targets)
      if (targets.has(browserTarget(url))) return 'continue'
      return resolved.some(isBlockedAddress) ? 'blockedbyclient' : 'continue'
    }
    expect(decide('http://voicechat:8787/api/preview?url=http%3A%2F%2Fx', ['192.168.65.254'])).toBe('continue')
    expect(decide('http://internal-service:9000/', ['172.18.0.7'])).toBe('blockedbyclient')
    expect(decide('http://voicechat:9000/', ['172.18.0.7'])).toBe('blockedbyclient')
  })

  it('localhost и IPv6 разрешаются только на настроенном порту', () => {
    const trusted = new Set(['127.0.0.1:8799', 'localhost:8799', '[::1]:8799'])
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(validatePublicUrl(`http://${host}:8799/#/projects`, trusted).hash).toBe('#/projects')
      expect(() => validatePublicUrl(`http://${host}:9000/`, trusted)).toThrow('private network')
      expect(() => validatePublicUrl(`http://${host}:8799/`)).toThrow('private network')
    }
    expect(previewOriginTarget('http://[::1]:8799')).toBe('[::1]:8799')
    expect(() => validatePublicUrl('file:///tmp/page', trusted)).toThrow('http/https')
  })
})
