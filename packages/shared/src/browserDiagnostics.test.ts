import { expect, it } from 'vitest'
import {
  browserConsoleLevel,
  browserDiagnosticsRequireChromium,
  normalizeBrowserDiagnosticOptions
} from './browserDiagnostics'
import { isPreviewAction } from './previewActions'
import { planModelAction } from './browserActions'
it('нормализует native уровни и ограничивает размер порции', () => {
  expect(['warning', 'assert', 'info', 'debug'].map(browserConsoleLevel)).toEqual(['warn', 'error', 'info', 'log'])
  expect(normalizeBrowserDiagnosticOptions({ limit: 1000 }).limit).toBe(200)
})
it.each([
  { since: -1 },
  { before: 1.5 },
  { since: 2, before: 1 },
  { allTabs: true, tabId: 't' },
  { tabId: '' },
  { limit: 1.5 },
  { allTabs: 'yes' }
])('контракт отвергает некорректные параметры %j', (options) => {
  expect(isPreviewAction({ kind: 'console', ...options })).toBe(false)
})
it('mapper не теряет scope/cursors и использует буквальный pattern', () => {
  expect(planModelAction({ kind: 'console', pattern: '[x]', tabId: 't', since: 2, before: 10, clear: true })).toEqual({
    kind: 'command',
    command: {
      type: 'inspect',
      action: { kind: 'console', pattern: '[x]', tabId: 't', since: 2, before: 10, clear: true, regex: false }
    }
  })
  expect(planModelAction({ kind: 'network', failedOnly: true, resourceType: 'fetch', state: 'failed' })).toMatchObject({
    command: { action: { failedOnly: true, resourceType: 'fetch', state: 'failed' } }
  })
})
it('только расширенные параметры требуют Chromium', () => {
  expect(browserDiagnosticsRequireChromium({ limit: 5, clear: true })).toBe(false)
  expect(browserDiagnosticsRequireChromium({ since: 0 })).toBe(true)
  expect(isPreviewAction({ kind: 'network', state: 'unknown' })).toBe(false)
  expect(isPreviewAction({ kind: 'network', failedOnly: 'true' })).toBe(false)
})
