// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { installTrustedCa, readExtraCaPem, splitPemCertificates } from './trustedCa.js'

const cert = (body: string): string => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`

describe('splitPemCertificates', () => {
  it('разбирает связку из нескольких сертификатов', () => {
    expect(splitPemCertificates(`${cert('AAA')}\n${cert('BBB')}\n`)).toEqual([cert('AAA'), cert('BBB')])
  })
  it('игнорирует текст между блоками — Caddy кладёт рядом комментарии', () => {
    expect(splitPemCertificates(`# Caddy Local Authority\n${cert('AAA')}\nхвост`)).toEqual([cert('AAA')])
  })
  it('пустой ввод даёт пустой список, а не бросает', () => {
    expect(splitPemCertificates('')).toEqual([])
    expect(splitPemCertificates('совсем не PEM')).toEqual([])
  })
})

describe('readExtraCaPem', () => {
  it('inline-значение важнее файла: его задают точечно', () => {
    expect(readExtraCaPem({ pem: cert('AAA'), file: '/нет/такого' }).pem).toBe(cert('AAA'))
  })
  it('нечитаемый файл возвращает причину, а не исключение', () => {
    const result = readExtraCaPem({ file: '/нет/такого' }, () => { throw new Error('ENOENT') })
    expect(result.pem).toBeNull()
    expect(result.error).toBe('ENOENT')
  })
  it('пустой источник — просто «нечего добавлять»', () => {
    expect(readExtraCaPem({})).toEqual({ pem: null })
  })
  it('значение без PEM-блока не принимается за сертификат', () => {
    expect(readExtraCaPem({ pem: 'да' })).toEqual({ pem: null })
  })
})

describe('installTrustedCa', () => {
  it('создаёт базу и добавляет каждый сертификат как доверенный центр', async () => {
    const calls: string[][] = []
    const run = vi.fn(async (args: string[]) => { calls.push(args); return { ok: true, output: '' } })
    expect(await installTrustedCa(`${cert('AAA')}\n${cert('BBB')}`, '/home/pwuser/.pki/nssdb', run)).toEqual({ added: 2 })
    expect(calls[0]).toEqual(['-N', '--empty-password', '-d', 'sql:/home/pwuser/.pki/nssdb'])
    expect(calls[1]).toEqual(expect.arrayContaining(['-A', '-t', 'C,,']))
    expect(calls).toHaveLength(3)
  })

  it('отказ certutil возвращается причиной и не бросает', async () => {
    const run = vi.fn(async (args: string[]) => ({ ok: args[0] === '-N', output: 'certutil: not found\nтрассировка' }))
    expect(await installTrustedCa(cert('AAA'), '/db', run)).toEqual({ added: 0, error: 'certutil: not found' })
  })

  it('PEM без сертификатов объясняется, а не считается успехом', async () => {
    expect(await installTrustedCa('пусто', '/db', vi.fn())).toEqual({ added: 0, error: 'в PEM нет ни одного сертификата' })
  })
})
