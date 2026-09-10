import { readFileSync } from 'node:fs'
import { cssRules } from '@voicechat/ui-foundation/test/cssRules'
const css = [new URL('../../../ui-foundation/src/styles.css', import.meta.url), new URL('./app.css', import.meta.url)].map(url => readFileSync(url, 'utf8')).join('\n')
export const { decl, atRuleBody, atRuleBodies, mediaBody } = cssRules(css)
