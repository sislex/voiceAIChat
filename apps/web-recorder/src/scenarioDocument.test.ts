import { expect, it } from 'vitest'
import { exportScenarioDocument, parseScenarioDocument } from './scenarioDocument'
const step = { kind: 'click', selector: '#go', text: '', sensitive: false } as const
const doc = (extra: object = {}) => JSON.stringify({ format: 'web-reader-scenario', version: 1, pageUrl: 'https://example.test/path?q=1#tab', steps: [step], ...extra })
it('round trips versioned scenarios and preserves the source URL', () => {
  const original = parseScenarioDocument(doc()); expect(parseScenarioDocument(exportScenarioDocument(original.pageUrl, original.steps))).toEqual(original)
})
it.each([2, '1', null])('rejects unsupported version %s', version => { expect(() => parseScenarioDocument(doc({ version }))).toThrow('версия') })
it('reports malformed JSON', () => { expect(() => parseScenarioDocument('{')).toThrow('JSON') })
it('reports the exact invalid step without silently dropping it', () => { expect(() => parseScenarioDocument(doc({ steps: [step, { ...step, selector: '' }] }))).toThrow('Шаг 2') })
it('limits UTF-8 bytes and total steps', () => {
  expect(() => parseScenarioDocument('я'.repeat(500001))).toThrow('1 МБ')
  expect(() => parseScenarioDocument(doc({ steps: Array(201).fill(step) }))).toThrow('200')
  expect(() => parseScenarioDocument(doc({ steps: [] }))).toThrow('200')
})
it('redacts secret values both on import and export', () => {
  const secret = { ...step, kind: 'type' as const, text: 'do-not-share', sensitive: true }
  expect(exportScenarioDocument('https://example.test', [secret])).not.toContain('do-not-share')
  expect(parseScenarioDocument(doc({ steps: [secret] })).steps[0].text).toBe('')
})
it('rejects executable source URLs', () => { expect(() => parseScenarioDocument(doc({ pageUrl: 'javascript:alert(1)' }))).toThrow('HTTP') })
