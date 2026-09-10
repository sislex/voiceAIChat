// @vitest-environment jsdom
/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import fastify from 'fastify'
import { previewErrorPage, registerPreviewProxy } from './previewProxy.js'

afterEach(() => { document.body.innerHTML = '' })

describe('страница ошибки Web Reader', () => {
  // @testCase TC1
  it('ошибка обычного сайта → видимая загрузка → новый запрос текущего адреса → восстановление', async () => {
    let available = false
    const http = vi.fn(async () => {
      if (!available) throw new Error('Сайт не ответил вовремя')
      return { status: 200, headers: { 'content-type': 'text/html' }, bodyBase64: Buffer.from('<h1>Приложение восстановлено</h1>').toString('base64') }
    })
    const app = fastify()
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'error-qa', role: 'user' }
    })
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http } } })
    const address = '/api/preview?url=' + encodeURIComponent('http://error-qa.machine.internal:5173/app#/saved')
    const request = () => app.inject({ method: 'GET', url: address, headers: { accept: 'text/html' } })
    try {
      const failed = await request()
      expect(failed.statusCode).toBe(502)
      document.documentElement.innerHTML = failed.body
      expect(document.body.textContent).toContain('Сайт не загрузился')
      expect(document.body.textContent).toContain('Сайт не ответил вовремя')
      expect(document.body.textContent).not.toContain('Storybook')
      const button = document.querySelector('button')!
      expect(button.textContent).toBe('Повторить')
      available = true
      let retry: ReturnType<typeof request> | undefined
      // Location — граница браузера: reload исполняет тот же HTTP-запрос,
      // а DOM и обработчик кнопки берутся из настоящего ответа прокси.
      const reload = vi.fn(() => { retry = request() })
      const paint: FrameRequestCallback[] = []
      const timers: (() => void)[] = []
      const click = new Function('document', 'location', 'requestAnimationFrame', 'setTimeout', button.getAttribute('onclick')!)
      click.call(button, document, { reload }, (callback: FrameRequestCallback) => paint.push(callback), (callback: () => void) => timers.push(callback))
      expect(button.disabled).toBe(true)
      expect(Array.from(document.querySelectorAll('p')).every((paragraph) => paragraph.hidden)).toBe(true)
      expect(document.querySelector('[role="status"]')?.textContent).toContain('Загрузка сайта…')
      expect(reload).not.toHaveBeenCalled()
      paint[0]!(0)
      timers[0]!()
      expect(reload).toHaveBeenCalledOnce()
      const restored = await retry!
      expect(restored.statusCode).toBe(200)
      document.documentElement.innerHTML = restored.body
      expect(document.body.textContent).toContain('Приложение восстановлено')
      expect(document.body.textContent).not.toContain('Сайт не загрузился')
      expect(http).toHaveBeenCalledTimes(2)
      expect(http.mock.calls[1]).toEqual(http.mock.calls[0])
      expect(restored.body).toContain('#/saved')
    } finally { await app.close() }
  })

  // @testCase TC1
  it('экранирует причину сбоя как текст, не исполняемый HTML', () => {
    document.documentElement.innerHTML = previewErrorPage('<img src=x onerror="alert(1)"> & отказ')
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.textContent).toContain('<img src=x onerror="alert(1)"> & отказ')
  })
})
