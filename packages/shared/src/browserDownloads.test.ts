import { expect, it } from 'vitest'
import {
  browserDownloadFilename,
  browserDownloadList,
  isBrowserDownloadListResult,
  isBrowserDownloadReadResult,
  normalizeBrowserDownloadRead,
  type BrowserDownloadInfo
} from './browserDownloads'
const info = (id = 'd'): BrowserDownloadInfo => ({
  id,
  tabId: 't',
  filename: 'Отчёт.txt',
  url: 'https://project.test/export',
  state: 'completed',
  startedAt: 1,
  bytes: 6
})
it('имя вложения не превращается в путь или подмену направления текста', () => {
  expect(browserDownloadFilename('../a\\b\u202e.txt')).toBe('_a_b_.txt')
  expect(browserDownloadFilename('...')).toBe('download')
  expect(browserDownloadFilename('Отчёт 😀.txt')).toBe('Отчёт 😀.txt')
  expect(browserDownloadFilename('x'.repeat(1000))).toHaveLength(180)
})
it('диапазон чтения проверяется до обращения к файлу', () => {
  expect(normalizeBrowserDownloadRead()).toEqual({ encoding: 'text', offset: 0, limit: 12000 })
  expect(normalizeBrowserDownloadRead({ encoding: 'base64' }).limit).toBe(8192)
  for (const value of [
    { offset: -1 },
    { offset: 1.5 },
    { limit: 0 },
    { limit: 12001 },
    { encoding: 'ascii' },
    { encoding: 'base64', limit: 524289 }
  ])
    expect(() => normalizeBrowserDownloadRead(value as never)).toThrow()
})
it('каталог фильтрует вкладку и продолжает ограниченную выдачу', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    ...info(String(i)),
    url: 'https://project.test/' + 'x'.repeat(3000)
  }))
  const first = browserDownloadList(rows)
  expect(first.total).toBe(20)
  expect(first.nextOffset).toBe(first.downloads.length)
  expect(first.downloads[0].urlTruncated).toBe(true)
  expect(JSON.stringify(first).length).toBeLessThan(12000)
  expect(browserDownloadList(rows, { offset: first.nextOffset }).downloads[0].id).toBe(String(first.nextOffset))
  expect(browserDownloadList(rows, { tabId: 'other' }).downloads).toEqual([])
  expect(rows[0].url.length).toBeGreaterThan(2000)
})
it('старый ready и повреждённые результаты не подтверждают файл', () => {
  expect(isBrowserDownloadListResult(browserDownloadList([info()]))).toBe(true)
  expect(
    isBrowserDownloadReadResult({
      ok: true,
      download: info(),
      encoding: 'base64',
      base64: 'AP8BAgOA',
      total: 6,
      offset: 0
    })
  ).toBe(true)
  for (const value of [{ state: 'ready' }, { ok: true }, { ok: true, downloads: [], total: -1, offset: 0 }])
    expect(isBrowserDownloadListResult(value)).toBe(false)
  expect(
    isBrowserDownloadReadResult({ ok: true, download: info(), encoding: 'text', text: 'x', total: 0, offset: 1 })
  ).toBe(false)
})
