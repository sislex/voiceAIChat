import { describe, expect, it } from 'vitest'
import { deviceKey, hash32, localGeo, normalizeIp } from './deviceKey'

describe('normalizeIp', () => {
  it('снимает IPv4-mapped префикс, скобки и порт', () => {
    expect(normalizeIp('::ffff:203.0.113.7').address).toBe('203.0.113.7')
    expect(normalizeIp('203.0.113.7:54321').address).toBe('203.0.113.7')
    expect(normalizeIp('[2001:db8::1]').address).toBe('2001:db8::1')
    // У голого IPv6 двоеточия — часть адреса, отрезать хвост нельзя.
    expect(normalizeIp('2001:db8::1').address).toBe('2001:db8::1')
  })

  it('различает приватные и публичные адреса', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.254', '169.254.1.1', '::1', 'fe80::1', 'fd00::5']) {
      expect(normalizeIp(ip).private, ip).toBe(true)
    }
    for (const ip of ['203.0.113.7', '8.8.8.8', '172.32.0.1', '2001:db8::1']) {
      expect(normalizeIp(ip).private, ip).toBe(false)
    }
  })

  it('считает подсеть: /24 для IPv4 и /64 для IPv6', () => {
    expect(normalizeIp('203.0.113.7').subnet).toBe('203.0.113.0/24')
    expect(normalizeIp('203.0.113.250').subnet).toBe('203.0.113.0/24')
    expect(normalizeIp('2001:db8::1').subnet).toBe('2001:0db8:0000:0000::/64')
  })

  it('пустой адрес не считается приватным и не даёт подсеть', () => {
    expect(normalizeIp('')).toMatchObject({ address: '', family: 'unknown', private: false, subnet: '' })
    expect(normalizeIp(null).address).toBe('')
  })
})

describe('localGeo', () => {
  it('приватный адрес — локальная сеть, публичный оставляем внешнему резолверу', () => {
    expect(localGeo('192.168.1.10')).toMatchObject({ local: true, label: 'локальная сеть' })
    expect(localGeo('203.0.113.7')).toBeNull()
    expect(localGeo('')).toBeNull()
  })
})

describe('deviceKey', () => {
  const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
  const chromeMacNewVersion = chromeMac.replace('128', '131')

  it('не меняется при обновлении браузера и при смене адреса внутри подсети', () => {
    const base = deviceKey({ userAgent: chromeMac, ip: '203.0.113.7' })
    expect(deviceKey({ userAgent: chromeMacNewVersion, ip: '203.0.113.7' })).toBe(base)
    expect(deviceKey({ userAgent: chromeMac, ip: '203.0.113.99' })).toBe(base)
  })

  it('меняется при смене браузера, ОС или сети', () => {
    const base = deviceKey({ userAgent: chromeMac, ip: '203.0.113.7' })
    expect(deviceKey({ userAgent: chromeMac.replace('Chrome', 'Firefox'), ip: '203.0.113.7' })).not.toBe(base)
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
    expect(deviceKey({ userAgent: chromeWin, ip: '203.0.113.7' })).not.toBe(base)
    expect(deviceKey({ userAgent: chromeMac, ip: '198.51.100.7' })).not.toBe(base)
  })

  it('приложение и браузер на одной машине — разные устройства', () => {
    const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/33.0.0 Chrome/130.0.0.0 Safari/537.36'
    expect(deviceKey({ userAgent: electron, ip: '203.0.113.7' })).not.toBe(deviceKey({ userAgent: chromeMac, ip: '203.0.113.7' }))
  })

  it('пустой UA и пустой адрес дают стабильный ключ, а не исключение', () => {
    expect(deviceKey({ userAgent: '', ip: '' })).toBe(deviceKey({ userAgent: null, ip: null }))
  })
})

describe('hash32', () => {
  it('детерминирован, короткий и различает близкие строки', () => {
    expect(hash32('abc')).toBe(hash32('abc'))
    expect(hash32('abc')).toHaveLength(8)
    expect(hash32('abc')).not.toBe(hash32('abd'))
  })
})
