import { describe, expect, it } from 'vitest'
import { scenarioToPlaywright } from './playwrightExport'
describe('экспорт исполняемого сценария', () => {
  it('сохраняет многострочный текст, слеши, кавычки и Unicode', () => {
    const text = `строка\n'кавычки' "двойные" \\ \r\t\u2028\u2029`
    const spec = scenarioToPlaywright('https://example.test/', [{ kind: 'type', selector: '[name="text"]', text, sensitive: false }])
    expect(() => new Function(spec.replace(/^import.*\n/, ''))).not.toThrow()
    expect(spec).toContain('\\n'); expect(spec).toContain('\\u2028')
  })
  it('проверяет все секреты перед goto и не подставляет пустую строку', () => {
    const spec = scenarioToPlaywright('https://example.test/', [{ kind: 'type', selector: '#one', text: 'hidden-one', sensitive: true }, { kind: 'type', selector: '#two', text: 'hidden-two', sensitive: true, submit: true }])
    expect(spec.indexOf('if (!secret2)')).toBeLessThan(spec.indexOf('await page.goto'))
    expect(spec).not.toContain('hidden-'); expect(spec).not.toContain("?? ''")
    expect(spec).toContain('await page.fill("#two", secret2)'); expect(spec).toContain("'Enter'")
    expect(() => new Function(spec.replace(/^import.*\n/, ''))).not.toThrow()
  })
})
