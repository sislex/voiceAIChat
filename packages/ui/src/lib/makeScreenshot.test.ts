import { describe, expect, it } from 'vitest'
import { collectInlineCss } from './makeScreenshot'

describe('collectInlineCss (roadmap-3 п.5)', () => {
  it('инлайнит читаемые таблицы и запоминает их href; недоступные (кросс-домен) пропускает', () => {
    const readable = { href: 'http://127.0.0.1/styles.css', cssRules: [{ cssText: 'body{margin:0}' }, { cssText: 'h1{color:red}' }] }
    const blocked = { href: 'https://fonts.googleapis.com/css2?family=Inter', get cssRules(): CSSRuleList { throw new DOMException('SecurityError') } }
    const inline = { href: null, cssRules: [{ cssText: '.x{y:1}' }] }
    const doc = { styleSheets: [readable, blocked, inline] } as unknown as Document
    const { cssText, inlinedHrefs } = collectInlineCss(doc)
    expect(cssText).toBe('body{margin:0}\nh1{color:red}\n.x{y:1}')
    expect([...inlinedHrefs]).toEqual(['http://127.0.0.1/styles.css'])
  })
})
