import { describe, expect, it } from 'vitest'
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib'
import { decodePreviewText, decodePreviewResponse, previewContentType, previewRedirect } from './previewResponse.js'
const cp1251 = Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2])
const legacy = (before: string, after = '') => Buffer.concat([Buffer.from(before), cp1251, Buffer.from(after)])

describe('текст и сжатие ответов Web Reader', () => {
  it('текст без charset остаётся UTF-8 и объявляется таким браузеру', () => {
    expect(decodePreviewText(Buffer.from('<h1>Привет</h1>'), 'text/html')).toContain('Привет'); expect(previewContentType('text/html')).toBe('text/html; charset=utf-8')
  })
  it('явный HTTP charset имеет приоритет над meta и заменяется в ответе', () => {
    expect(decodePreviewText(legacy('<meta charset="utf-8"><h1>', '</h1>'), 'text/html; charset="windows-1251"')).toContain('Привет')
    expect(previewContentType('text/html; charset="windows-1251"; custom=yes')).toBe('text/html; custom=yes; charset=utf-8')
  })
  it.each(['<meta charset=windows-1251>', '<meta content="text/html; charset=windows-1251" http-equiv="Content-Type">'])('понимает декларацию HTML %s', prefix => {
    expect(decodePreviewText(legacy(prefix + '<h1>', '</h1>'), 'text/html')).toContain('Привет')
  })
  it('ложная meta в комментарии не меняет кодировку', () => { expect(decodePreviewText(Buffer.from('<!--<meta charset=windows-1251>--><p>Привет</p>'), 'text/html')).toContain('Привет') })
  it('BOM определяет UTF-16 даже при неверном заголовке', () => {
    const le = Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('<h1>Привет</h1>', 'utf16le')]); expect(decodePreviewText(le, 'text/html; charset=windows-1251')).toContain('Привет')
    const be = Buffer.from(le).swap16(); expect(decodePreviewText(be, 'application/xhtml+xml')).toContain('Привет')
  })
  it('XML-декларация определяет XHTML без HTTP charset', () => { expect(decodePreviewText(legacy('<?xml version="1.0" encoding="windows-1251"?><html><h1>', '</h1></html>'), 'application/xhtml+xml')).toContain('Привет') })
  it('CSS @charset и JS HTTP charset читаются до переписывания', () => {
    expect(decodePreviewText(legacy('@charset "windows-1251";a::after{content:"','"}'), 'text/css')).toContain('Привет')
    expect(decodePreviewText(legacy('globalThis.message="','"'), 'application/javascript; charset=windows-1251')).toContain('Привет')
  })
  it('не меняет content-type бинаря и JSON', () => {
    expect(previewContentType('image/png')).toBe('image/png'); expect(previewContentType('application/json; charset=windows-1251')).toBe('application/json; charset=windows-1251')
  })
  it.each([['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]] as const)('распаковывает %s', async (encoding, compress) => {
    const body = Buffer.from([0,255,128,42]); expect(await decodePreviewResponse(compress(body), encoding)).toEqual(body)
  })
  it('пустой HEAD/204 не отправляется в декомпрессор', async () => { expect(await decodePreviewResponse(Buffer.alloc(0), 'gzip')).toEqual(Buffer.alloc(0)) })
  it('распаковывает цепочку кодировок в обратном порядке', async () => { const body = Buffer.from('Привет'); expect(await decodePreviewResponse(brotliCompressSync(gzipSync(body)), 'gzip, br')).toEqual(body) })
  it('невалидное/неизвестное сжатие объясняет ошибкой', async () => {
    await expect(decodePreviewResponse(Buffer.from('wrong'), 'gzip')).rejects.toMatchObject({ status: 502 }); await expect(decodePreviewResponse(Buffer.from('wrong'), 'future')).rejects.toMatchObject({ status: 502 })
  })
  it('лимит проверяется после распаковки', async () => { await expect(decodePreviewResponse(gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1)), 'gzip')).rejects.toMatchObject({ status: 413 }) })
})
describe('redirect одинаков для проекта, машины и публичного сайта', () => {
  const url = new URL('https://example.com/a#/deep'), headers = { authorization: 'nested-token', 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-language': 'ru' }
  it.each([301,302])('код %s сохраняет PUT и тело, но переводит POST в GET', status => {
    expect(previewRedirect(url,'/b',status,'PUT','value',headers)).toMatchObject({ method: 'PUT', body: 'value', headers })
    expect(previewRedirect(url,'/b',status,'POST','value',headers)).toMatchObject({ method: 'GET', body: undefined, headers: { authorization: 'nested-token' } })
  })
  it('303 сохраняет HEAD, 307/308 сохраняют POST', () => {
    expect(previewRedirect(url,'/b',303,'HEAD',undefined,headers).method).toBe('HEAD')
    for (const status of [307,308]) expect(previewRedirect(url,'/b',status,'POST','value',headers)).toMatchObject({ method: 'POST', body: 'value', headers })
  })
  it('чужому origin не передаётся авторизация страницы', () => {
    expect(previewRedirect(url,'https://other.example/b',307,'POST','value',headers).headers).not.toHaveProperty('authorization'); expect(headers.authorization).toBe('nested-token')
  })
  it('неявный fragment наследуется, явный пустой сбрасывает', () => {
    expect(previewRedirect(url,'/b',302,'GET',undefined,{}).url.hash).toBe('#/deep')
    expect(previewRedirect(url,'/b#',302,'GET',undefined,{}).url.hash).toBe('')
  })
})
