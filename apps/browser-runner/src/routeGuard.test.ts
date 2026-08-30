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
import { aliasTargets, applyHostAlias, isBlockedAddress, parseHostAliases, validatePublicUrl } from './security.js'

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
