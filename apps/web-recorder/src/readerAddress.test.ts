import { describe, expect, it } from 'vitest'
import { normalizeReaderAddress } from './readerAddress'
const base = 'http://project.machine.internal:5173/catalog/page?old=1#/tab'
describe('адресная строка Reader', () => {
  it('пустой адрес очищает страницу', () => expect(normalizeReaderAddress('  ', base)).toEqual({ url: null }))
  it('HTTP URL нормализует пробелы вокруг', () => expect(normalizeReaderAddress(' https://example.com/page ', base)).toEqual({ url: 'https://example.com/page' }))
  it('публичное имя без схемы открывается через HTTPS', () => expect(normalizeReaderAddress('gmail.com', null)).toEqual({ url: 'https://gmail.com/' }))
  it('машина с портом открывается через HTTP', () => expect(normalizeReaderAddress('project.machine.internal:5173/a', null)).toEqual({ url: 'http://project.machine.internal:5173/a' }))
  it('явный прикладной порт не принимается за схему URL', () => expect(normalizeReaderAddress('example.com:8787', null)).toEqual({ url: 'http://example.com:8787/' }))
  it('абсолютный путь остаётся на сайте проекта', () => expect(normalizeReaderAddress('/settings', base)).toEqual({ url: 'http://project.machine.internal:5173/settings' }))
  it('относительный путь сохраняет каталог исходной страницы', () => expect(normalizeReaderAddress('../next', base)).toEqual({ url: 'http://project.machine.internal:5173/next' }))
  it('hash и query используют настоящий URL, не origin оболочки', () => {
    expect(normalizeReaderAddress('#/machines', base).url).toBe('http://project.machine.internal:5173/catalog/page?old=1#/machines')
    expect(normalizeReaderAddress('?new=2', base).url).toBe('http://project.machine.internal:5173/catalog/page?new=2')
  })
  it('путь без открытого сайта ведёт в текущий проект', () => expect(normalizeReaderAddress('/settings', null).url).toBe('https://app.internal/settings'))
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://' + 'x'.repeat(5000)])('не исполняет неподдержанный адрес %s', value => expect(normalizeReaderAddress(value, base).error).toBeTruthy())
})

describe('local address inference', () => {
  it.each(['127.0.0.1', '127.2.3.4'])('uses HTTP for loopback %s', value => expect(normalizeReaderAddress(value, null).url).toBe(`http://${value}/`))
  it.each(['10.2.3.4', '192.168.1.10', '172.16.0.1', '172.31.255.254'])('uses HTTP for private IPv4 %s', value => expect(normalizeReaderAddress(value, null).url).toBe(`http://${value}/`))
  it('keeps public IPv4 and adjacent ranges on HTTPS', () => {
    for (const value of ['8.8.8.8', '172.15.0.1', '172.32.0.1']) expect(normalizeReaderAddress(value, null).url).toBe(`https://${value}/`)
  })
  it('accepts bracketed loopback IPv6 with and without a port', () => {
    expect(normalizeReaderAddress('[::1]', null).url).toBe('http://[::1]/')
    expect(normalizeReaderAddress('[::1]:5173/a', null).url).toBe('http://[::1]:5173/a')
  })
  it('recognizes localhost subdomains without confusing public suffixes', () => {
    expect(normalizeReaderAddress('dev.localhost', null).url).toBe('http://dev.localhost/')
    expect(normalizeReaderAddress('localhost.example.com', null).url).toBe('https://localhost.example.com/')
  })
  it('inherits the current scheme for scheme-relative links', () => {
    expect(normalizeReaderAddress('//other.test/path', 'http://current.test/').url).toBe('http://other.test/path')
    expect(normalizeReaderAddress('//other.test/path', null).url).toBe('https://other.test/path')
  })
  it('treats explicit 443 as HTTPS, including leading zeros and local hosts', () => {
    for (const value of ['localhost:443', 'example.com:0443', '[::1]:443']) expect(normalizeReaderAddress(value, null).url).toMatch(/^https:/)
  })
})
