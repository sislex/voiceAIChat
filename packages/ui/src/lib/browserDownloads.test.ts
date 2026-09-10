import { expect, it, vi } from 'vitest'
import { browserDownloadBytes, listAllBrowserDownloads } from './browserDownloads'
import type { BrowserDownloadInfo } from '@shared/browserDownloads'
const item: BrowserDownloadInfo = {
  id: 'd',
  tabId: 't',
  filename: 'data.bin',
  url: 'https://site.test/file',
  state: 'completed',
  bytes: 6,
  startedAt: 1
}
const part = (offset: number, base64: string, nextOffset?: number) => ({
  ok: true,
  encoding: 'base64',
  download: item,
  offset,
  total: 6,
  base64,
  ...(nextOffset !== undefined ? { nextOffset, truncated: true } : {})
})
it('собирает двоичный файл в исходном порядке, не теряя нулевые байты', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(part(0, 'AP8=', 2))
    .mockResolvedValueOnce(part(2, 'AQIDgA=='))
  expect(await browserDownloadBytes(send, item)).toEqual(new Uint8Array([0, 255, 1, 2, 3, 128]))
  expect(send).toHaveBeenLastCalledWith({
    type: 'readDownload',
    downloadId: 'd',
    encoding: 'base64',
    offset: 2,
    limit: 524288
  })
})
it('нулевой файл подтверждается отдельным ответом раннера', async () => {
  const empty = { ...item, bytes: 0 }
  expect(await browserDownloadBytes(async () => ({ ...part(0, ''), total: 0, download: empty }), empty)).toHaveLength(0)
})
it.each([
  { state: 'ready' },
  { ...part(0, 'AP8='), nextOffset: 1 },
  part(1, 'AP8='),
  { ...part(0, 'AP8='), download: { ...item, id: 'other' } },
  { ...part(0, 'AP8='), total: 10 },
  part(0, 'invalid!'),
  { ...part(0, 'AP8BAgOA'), nextOffset: 6 }
])('повреждённый или чужой ответ не сохраняется как файл', async (value) => {
  await expect(browserDownloadBytes(async () => value, item)).rejects.toThrow()
})
it('исчезнувший файл прерывает сборку, смена сессии отменяет выдачу', async () => {
  await expect(
    browserDownloadBytes(
      vi
        .fn()
        .mockResolvedValueOnce(part(0, 'AP8=', 2))
        .mockRejectedValueOnce(new Error('stale_download')),
      item
    )
  ).rejects.toThrow('stale_download')
  const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
  await expect(browserDownloadBytes(async () => part(0, 'AP8BAgOA'), item, current)).rejects.toThrow('отменено')
})
it('каталог дочитывается и не зацикливается при неверном nextOffset', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, downloads: [item], offset: 0, total: 2, nextOffset: 1 })
    .mockResolvedValueOnce({ ok: true, downloads: [{ ...item, id: 'second' }], offset: 1, total: 2 })
  expect((await listAllBrowserDownloads(send)).map((item) => item.id)).toEqual(['d', 'second'])
  await expect(
    listAllBrowserDownloads(async () => ({ ok: true, downloads: [], offset: 0, total: 1, nextOffset: 0 }))
  ).rejects.toThrow('не продвигается')
})
