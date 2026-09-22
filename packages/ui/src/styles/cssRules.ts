import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { readFileSync } from 'node:fs'
import { cssRules } from '@voicechat/ui-foundation/test/cssRules'
const css = [require.resolve('@voicechat/ui-foundation/styles.css'), new URL('./app.css', import.meta.url)].map(url => readFileSync(url, 'utf8')).join('\n')
export const { decl, atRuleBody, atRuleBodies, mediaBody } = cssRules(css)
