// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { makeBrowserBridge } from './index'
import { setCsrf, setToken } from './session'

afterEach(() => { vi.unstubAllGlobals(); setCsrf(null); setToken(null) })
it('остановка Reader использует CSRF cookie-сессии', async () => {
  setToken(null); setCsrf('csrf-test-only')
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  await makeBrowserBridge('http://core').stop('c1')
  expect(fetch).toHaveBeenCalledWith('http://core/api/browser/c1', expect.objectContaining({ method: 'DELETE', credentials: 'include', headers: { 'x-vc-csrf': 'csrf-test-only' } }))
})
it('отказ остановки не выдаётся панели за успех', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'csrf' }), { status: 403 })))
  await expect(makeBrowserBridge('http://core').stop('c1')).rejects.toThrow('csrf')
})
