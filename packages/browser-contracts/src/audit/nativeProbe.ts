import { isPreviewProbeOptions, type PreviewProbeOptions } from '@voicechat/shared'
import { nativeDomPrelude } from './nativeDom.js'
import { previewProbeHelpers } from './probe.js'

/** Accept only bounded selectors; model-supplied scripts still use the evaluate policy. */
export function nativeProbeExpression(options: PreviewProbeOptions): string {
  if (!isPreviewProbeOptions(options)) throw new Error('Invalid probe options.')
  return String.raw`(()=>{
${nativeDomPrelude()}
${previewProbeHelpers('chromium')}
return runProbe(${JSON.stringify({ selector: options.selector })});
})()`
}
