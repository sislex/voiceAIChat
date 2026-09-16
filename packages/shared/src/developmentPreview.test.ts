import { describe, expect, it } from 'vitest'
import { DEFAULT_DEVELOPMENT_PREVIEW, normalizeDevelopmentPreview, developmentPreviewValidationError, browserEvidenceComplete, type DevelopmentBrowserEvidence } from './developmentPreview'
import { DEFAULT_CI_BROWSER_CHECK, normalizeCiBrowserCheck } from './ci'
describe('development preview contract', () => {
  it('keeps old tasks off and defaults failures to continue', () => {
    expect(normalizeDevelopmentPreview(undefined)).toEqual(DEFAULT_DEVELOPMENT_PREVIEW)
    expect(normalizeCiBrowserCheck(undefined)).toEqual(DEFAULT_CI_BROWSER_CHECK)
    expect(normalizeCiBrowserCheck({mode:'chromium'}).failurePolicy).toBe('continue')
    expect(normalizeCiBrowserCheck({failurePolicy:'block'}).failurePolicy).toBe('block')
  })
  it.each([
    {database:{mode:'production'}}, {database:{dsn:'postgres://prod/db'}},
    {database:{volume:'production'}}, {env:{HOME:'/root'}}, {cli:{source:'local'}},
    {runtime:'host'}, {enabled:'true'}, {containerPort:80}, {healthPath:'//prod'},
    {ttlMs:Infinity}, {startupTimeoutMs:0}
  ])('rejects unsafe settings %j', (value) => expect(developmentPreviewValidationError(value)).not.toBeNull())
  it('validates the default and independent enabled setting', () => {
    expect(developmentPreviewValidationError(DEFAULT_DEVELOPMENT_PREVIEW)).toBeNull()
    expect(normalizeDevelopmentPreview({enabled:true}).enabled).toBe(true)
    expect(normalizeCiBrowserCheck({}).mode).toBe('off')
  })
  it('requires target identity, screenshots and successful mandatory browser calls', () => {
    const e: DevelopmentBrowserEvidence = {url:'http://a/',sha:'sha',configDigest:'digest',viewport:{width:800,height:600},
      calls:['open','read','screenshot','errors','network','a11y','styles'].map(tool=>({tool,at:1,ok:true})),
      screenshots:['/shot.png'],findings:{console:[],runtime:[],network:[],a11y:[],styles:[]}}
    expect(browserEvidenceComplete(e,e.url,e.sha,e.configDigest)).toBe(true)
    expect(browserEvidenceComplete(e,'http://other/',e.sha,e.configDigest)).toBe(false)
    expect(browserEvidenceComplete({...e,calls:e.calls.slice(1)},e.url,e.sha,e.configDigest)).toBe(false)
    expect(browserEvidenceComplete({...e,screenshots:[]},e.url,e.sha,e.configDigest)).toBe(false)
  })
})
