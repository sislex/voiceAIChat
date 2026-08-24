import { describe, expect, it, vi } from 'vitest'
import type { PreviewAction, PreviewActionResult } from '@voicechat/shared'
import { isWebReaderDiagnosticsCommand, runWebReaderDiagnostics, WEB_READER_DIAGNOSTICS_CAPABILITIES } from './webReaderDiagnostics'

describe('Web Reader diagnostics', () => {
  it('распознаёт только две поддерживаемые команды', () => {
    expect(isWebReaderDiagnosticsCommand('  Самодиагностика Web Reader  ')).toBe(true)
    expect(isWebReaderDiagnosticsCommand('/web-reader-diagnostics')).toBe(true)
    expect(isWebReaderDiagnosticsCommand('самодиагностика')).toBe(false)
  })

  it('публикует перечень до действий и выполняет детерминированный сценарий', async () => {
    const published: string[] = []
    const actions: string[] = []
    const run = vi.fn(async (action: PreviewAction): Promise<{ ok: boolean; result: PreviewActionResult }> => {
      actions.push(action.kind)
      if (action.kind === 'open') return { ok: true, result: { url: 'http://localhost/api/preview/diagnostics' } }
      if (action.kind === 'find') return { ok: true, result: { page: { url: '', title: '' }, elements: [], total: 1 } }
      if (action.kind === 'styles') return { ok: true, result: { page: { url: '', title: '' }, selector: '#diagnostic-style', styles: { display: 'block', color: 'rgb(12, 34, 56)' } } }
      if (action.kind === 'type') return { ok: true, result: { page: { url: '', title: '' }, typed: { selector: '#diagnostic-input', tag: 'input', text: '' }, submitted: true } }
      if (action.kind === 'click') return { ok: true, result: { page: { url: '', title: '' }, clicked: { selector: '#diagnostic-nav', tag: 'a', text: '' } } }
      if (action.kind === 'hover') return { ok: true, result: { page: { url: '', title: '' }, hovered: { selector: '#hover-target', tag: 'p', text: '' } } }
      if (action.kind === 'scroll') return { ok: true, result: { page: { url: '', title: '' }, target: 'window', scrolled: { top: 2600, left: 0, maxTop: 2600 } } }
      if (action.kind === 'press') return { ok: true, result: { page: { url: '', title: '' }, pressed: { key: 'Escape', selector: 'body' } } }
      if (action.kind === 'screenshot') return { ok: true, result: { page: { url: '', title: '' }, rect: { x: 0, y: 0, width: 100, height: 40 }, dataUrl: 'data:image/png;base64,AAAA' } }
      const text = action.selector === '#event-status' ? 'input:1 change:1' : action.selector === '#submit-status' ? 'submitted:diagnostic-input' : action.selector === '#hover-status' ? 'hover:1' : action.selector === '#key-status' ? 'key:Escape' : actions.includes('click') ? 'Diagnostics destination' : 'VoiceChat Web Reader Diagnostics'
      return { ok: true, result: { page: { url: '', title: '' }, headings: [], links: [], buttons: [], inputs: [], text } }
    })
    const results = await runWebReaderDiagnostics({
      origin: 'http://localhost',
      run,
      ensurePreview: async () => true,
      signal: new AbortController().signal,
      publish: async (text) => { published.push(text) }
    })
    expect(published[0]).toContain(WEB_READER_DIAGNOSTICS_CAPABILITIES[0])
    expect(actions).toEqual(['open', 'read', 'find', 'find', 'styles', 'hover', 'read', 'scroll', 'press', 'read', 'screenshot', 'type', 'read', 'type', 'read', 'click', 'read'])
    expect(results.every((step) => step.ok && step.durationMs >= 0)).toBe(true)
    expect(run.mock.calls.every(([action]) => action.diagnostic === true)).toBe(true)
  })
})

