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
  it('относительный путь без сайта сообщает понятную ошибку', () => expect(normalizeReaderAddress('/settings', null).error).toContain('Сначала'))
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://' + 'x'.repeat(5000)])('не исполняет неподдержанный адрес %s', value => expect(normalizeReaderAddress(value, base).error).toBeTruthy())
})
