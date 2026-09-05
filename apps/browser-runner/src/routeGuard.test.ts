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
import { aliasTargets, applyHostAlias, isBlockedAddress, parseHostAliases, previewOriginTarget, validatePublicUrl } from './security.js'

describe('решение перехватчика', () => {
  const aliases = parseHostAliases('89.125.68.35:8787=voicechat:8787')
  const targets = aliasTargets(aliases)

  const decide = (raw: string, resolved: string[] | 'dns-fail'): string => {
    let url: URL
    try { url = validatePublicUrl(raw) } catch { return 'blockedbyclient' }
    const aliased = applyHostAlias(url, aliases)
    const port = aliased.port || (aliased.protocol === 'https:' ? '443' : '80')
    if (targets.has(`${aliased.hostname.toLowerCase()}:${port}`) || targets.has(aliased.hostname.toLowerCase())) return 'continue'
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
    targets.add(origin.split(':')[0])
    const decide = (raw: string, resolved: string[]): string => {
      const url = validatePublicUrl(raw)
      const port = url.port || (url.protocol === 'https:' ? '443' : '80')
      if (targets.has(`${url.hostname.toLowerCase()}:${port}`) || targets.has(url.hostname.toLowerCase())) return 'continue'
      return resolved.some(isBlockedAddress) ? 'blockedbyclient' : 'continue'
    }
    expect(decide('http://voicechat:8787/api/preview?url=http%3A%2F%2Fx', ['192.168.65.254'])).toBe('continue')
    expect(decide('http://internal-service:9000/', ['172.18.0.7'])).toBe('blockedbyclient')
  })
})
