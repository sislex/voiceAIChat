import { describe, expect, it } from 'vitest'
import { isMachinePreviewUrl, machinePreviewUrl, PLAYWRIGHT_READER_CORE_METHODS, PLAYWRIGHT_READER_SERVICE_METHODS } from './playwrightReader'
import { previewResultJson } from './previewActions'

describe('граница Playwright Reader', () => {
  it('открывает машину через прокси, публичный сайт — напрямую', () => {
    const raw = 'http://dev.machine.internal:5173/page?q=1#section'
    expect(isMachinePreviewUrl(raw)).toBe(true)
    expect(machinePreviewUrl('http://core:8787/', raw)).toBe(`http://core:8787/api/preview?url=${encodeURIComponent(raw)}`)
    for (const other of ['https://example.com', 'http://dev.machine.internal.evil/', 'bad url']) {
      expect(isMachinePreviewUrl(other)).toBe(false)
      expect(machinePreviewUrl('http://core', other)).toBe(other)
    }
  })

  it('RPC ограничен портами приложения, результаты Chromium проходят общий лимит MCP', () => {
    expect(PLAYWRIGHT_READER_CORE_METHODS).toEqual(['conversation', 'modelTarget', 'issuePreviewRunKey', 'logBrowserShot'])
    expect(PLAYWRIGHT_READER_SERVICE_METHODS).toEqual(['execute', 'screenshot'])
    expect(previewResultJson({ ok: true, text: 'Страница' })).toBe('{"ok":true,"text":"Страница"}')
    expect(previewResultJson({ ok: true, text: 'x'.repeat(150_000) })).toBeNull()
  })
})
