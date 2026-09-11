import { nativeDomPrelude } from './nativeDom.js'
import { isPreviewAuditOptions, type PreviewAuditOptions } from '@voicechat/shared'
import { previewAuditHelpers } from './runtime.js'
import { previewReadingHelpers } from './reading.js'

/** Generate only trusted built-in checks; model-supplied evaluate code uses its separate policy. */
export function nativeAuditExpression(options: PreviewAuditOptions): string {
  if (!isPreviewAuditOptions(options)) throw new Error('Invalid audit options.')
  const { group, selector, rules, mode, offset, limit } = options
  return String.raw`(()=>{
${nativeDomPrelude()}
${previewReadingHelpers()}
${previewAuditHelpers('chromium')}
return runAudit(${JSON.stringify({ group, selector, rules, mode, offset, limit })});
})()`
}
