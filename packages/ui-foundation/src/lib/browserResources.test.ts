import { afterEach, expect, it, vi } from 'vitest'
import { probeLocalStorybook, readBrowserBlob } from './browserResources'
afterEach(() => vi.unstubAllGlobals())
it('чтение картинки не превращается в произвольный сетевой транспорт', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(readBrowserBlob('https://example.com/private')).rejects.toThrow('локальная')
  expect(fetch).not.toHaveBeenCalled()
  const blob = new Blob(['picture'], { type: 'image/png' })
  fetch.mockResolvedValue({ ok: true, blob: async () => blob })
  expect(await readBrowserBlob('blob:local-picture')).toBe(blob)
})
it('Storybook проверяет диапазон порта и наличие требуемой истории', async () => {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, json: async () => ({ entries: { known: {} } }) }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('window', {})
  expect(await probeLocalStorybook(0, ['known'])).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  expect(await probeLocalStorybook(6006, ['known'])).toBe(true)
  expect(await probeLocalStorybook(6006, ['missing'])).toBe(false)
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:6006/index.json')
})
