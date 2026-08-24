import { describe, expect, it } from 'vitest'
import { scenarioToPlaywright } from './playwrightExport'

describe('scenarioToPlaywright', () => {
  it('генерирует goto/click/fill/press и не встраивает секреты', () => {
    const spec = scenarioToPlaywright('http://agent-1.machine.internal:5173/', [
      { kind: 'click', selector: '#login-link', text: 'Войти', sensitive: false },
      { kind: 'type', selector: '#user', text: "o'hara", sensitive: false },
      { kind: 'type', selector: '#password', text: '', sensitive: true, submit: true }
    ])
    expect(spec).toContain("await page.goto('http://agent-1.machine.internal:5173/')")
    expect(spec).toContain("await page.click('#login-link')")
    expect(spec).toContain("await page.fill('#user', 'o\\'hara')")
    expect(spec).toContain("process.env.SCENARIO_SECRET_1 ?? ''")
    expect(spec).toContain("await page.press('#password', 'Enter')")
    expect(spec).not.toContain('hunter')
  })
})
