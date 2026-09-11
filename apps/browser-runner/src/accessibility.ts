import type { CDPSession, Page } from 'playwright'
import {
  ACCESSIBILITY_PROPERTIES, PREVIEW_ACCESSIBILITY_LIMITS as L,
  isPreviewAccessibilityOptions, isPreviewAccessibilityResult,
  type AccessibilityRelatedElement, type AccessibilityNameSource,
  type PreviewAccessibilityOptions, type PreviewAccessibilityResult, type BrowserInspectResult
} from '@voicechat/shared'

// Keep protocol-only values inside the runner: names are intentional output,
// while editable values, raw source attributes and CDP identities are not.
interface AXValue {
  type: string
  value?: unknown
  relatedNodes?: Array<{ backendDOMNodeId: number; idref?: string }>
  sources?: Array<{
    type: string; attribute?: string; nativeSource?: string
    superseded?: boolean; invalid?: boolean
    value?: AXValue; attributeValue?: AXValue; nativeSourceValue?: AXValue
  }>
}

const selectTarget = (selector: string) => `(() => {
  const matches=document.querySelectorAll(${JSON.stringify(selector)});
  if(matches.length!==1)throw new Error('Accessibility selector must identify exactly one element; found '+matches.length+'.');
  const el=matches[0],ref=el.getAttribute('data-voicechat-reader-ref');
  if(ref&&globalThis.__voicechatReaderReferences?.nodes?.get(el)!==ref)throw new Error('stale_element_ref: Find the element again before inspecting accessibility.');
  return el;
})()`

// Related nodes may have duplicate/missing IDs. Verify a complete selector instead
// of returning a clipped or ambiguous locator that could act on another element.
const relatedSelector = `function() {
  if(!this.isConnected||this.nodeType!==1||this.getRootNode()!==document)return null;
  const exact=selector=>{const nodes=document.querySelectorAll(selector);return nodes.length===1&&nodes[0]===this};
  if(this.id){const selector='#'+CSS.escape(this.id);if(selector.length<=${L.relatedSelector}&&exact(selector))return selector}
  const parts=[];let node=this;
  for(let depth=0;node&&depth<64;depth++,node=node.parentElement){
    let index=1;for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling)if(sibling.localName===node.localName)index++;
    parts.unshift(CSS.escape(node.localName)+':nth-of-type('+index+')');
    const selector=parts.join(' > ');if(selector.length>${L.relatedSelector})return null;if(exact(selector))return selector;
  }
  return null;
}`

/** Read one live native AX node using a short-lived CDP session, without mutation. */
export async function readNativeAccessibility(page: Page, options: PreviewAccessibilityOptions): Promise<BrowserInspectResult> {
  if (!isPreviewAccessibilityOptions(options)) return { ok: false, error: 'Accessibility requires one CSS selector (1–1000 characters), without frame or code.' }
  const started = performance.now()
  let cdp: CDPSession | undefined, expired = false, timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('Native accessibility inspection exceeded 5000 ms.')) }, L.timeoutMs)
  })
  const work = async (): Promise<PreviewAccessibilityResult> => {
    const session = await page.context().newCDPSession(page)
    cdp = session
    if (expired) { await session.detach().catch(() => {}); throw new Error('Accessibility inspection expired.') }
    const selected = await session.send('Runtime.evaluate', { expression: selectTarget(options.selector), returnByValue: false, timeout: L.timeoutMs })
    if (selected.exceptionDetails || !selected.result.objectId) throw new Error(selected.exceptionDetails?.exception?.description?.split('\n')[0] ?? 'Accessibility target was not resolved.')
    const objectId = selected.result.objectId
    const { node: dom } = await session.send('DOM.describeNode', { objectId })
    const tree = await session.send('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false })
    const raw = tree.nodes.find(node => node.backendDOMNodeId === dom.backendNodeId)
    if (!raw) throw new Error('Chromium returned no native accessibility node for the selected DOM element.')
    const report: PreviewAccessibilityResult = {
      page: { url: '', title: '' },
      accessibility: {
        version: 1, surface: 'chromium', source: 'chromium-accessibility', selector: options.selector,
        node: { ignored: raw.ignored, properties: [], nameSources: [], ignoredReasons: [] },
        truncated: false, elapsedMs: 0,
        limitations: [
          'This is one live Chromium accessibility node, not a complete screen-reader or application scenario test.',
          'Frame and shadow-root traversal are not included. Missing properties mean the browser did not expose them; do not infer false.',
          'Control values, value text, raw name-source attributes and CDP identifiers are omitted. Names and descriptions are application text.'
        ]
      }
    }
    const a = report.accessibility, node = a.node
    const limit = (message: string) => { a.truncated = true; if (!a.limitations.includes(message)) a.limitations.push(message) }
    const bounded = (value: string, max: number) => { if (value.length > max) limit('Text was clipped to the documented output limits.'); return value.slice(0, max) }
    for (const key of ['role', 'name', 'description'] as const) if (typeof raw[key]?.value === 'string') node[key] = bounded(raw[key]!.value, key === 'role' ? 80 : L.text)
    let relatedCount = 0
    const selectorCache = new Map<number, string | null>()
    const relations = async (value?: AXValue): Promise<AccessibilityRelatedElement[] | undefined> => {
      if (!value?.relatedNodes?.length) return undefined
      const output: AccessibilityRelatedElement[] = []
      for (const item of value.relatedNodes) {
        if (relatedCount >= L.related) { limit('Related-node evidence stopped at 24 entries.'); break }
        relatedCount++
        let selector = selectorCache.get(item.backendDOMNodeId)
        if (selector === undefined) {
          try {
            const resolved = await session.send('DOM.resolveNode', { backendNodeId: item.backendDOMNodeId })
            if (!resolved.object.objectId) throw new Error('No live related node.')
            const result = await session.send('Runtime.callFunctionOn', { objectId: resolved.object.objectId, functionDeclaration: relatedSelector, returnByValue: true })
            selector = !result.exceptionDetails && typeof result.result.value === 'string' ? result.result.value : null
          } catch { selector = null }
          selectorCache.set(item.backendDOMNodeId, selector)
        }
        if (!selector) limit('Some related nodes had no bounded unique selector in this document.')
        const idref = item.idref && item.idref.length <= L.idref ? item.idref : undefined
        if (item.idref && !idref) limit('An ID reference exceeded 200 characters and was omitted.')
        if (selector || idref) output.push({ ...(selector ? { selector } : {}), ...(idref ? { idref } : {}) })
      }
      return output.length ? output : undefined
    }
    for (const property of raw.properties ?? []) {
      if (!(ACCESSIBILITY_PROPERTIES as readonly string[]).includes(property.name)) continue
      if (node.properties.length >= L.properties) { limit('Property storage reached its limit.'); break }
      // ID-reference scalar values are redundant with the bounded relation list.
      const rawValue = property.value.relatedNodes ? undefined : property.value.value
      const value = typeof rawValue === 'string' ? bounded(rawValue, L.scalarText) :
        typeof rawValue === 'boolean' || typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : undefined
      const related = await relations(property.value)
      if (value !== undefined || related) node.properties.push({ name: property.name as typeof ACCESSIBILITY_PROPERTIES[number], ...(value !== undefined ? { value } : {}), ...(related ? { related } : {}) })
    }
    for (const source of raw.name?.sources ?? []) {
      if (node.nameSources.length >= L.sources) { limit('Name-source storage stopped at 12 entries.'); break }
      const output: AccessibilityNameSource = { type: bounded(source.type, 80) }
      for (const key of ['attribute', 'nativeSource'] as const) if (source[key] !== undefined) output[key] = bounded(source[key], 80)
      for (const key of ['superseded', 'invalid'] as const) if (source[key] !== undefined) output[key] = source[key]
      const related = await relations(source.value?.relatedNodes ? source.value : source.attributeValue?.relatedNodes ? source.attributeValue : source.nativeSourceValue)
      if (related) output.related = related
      node.nameSources.push(output)
    }
    for (const reason of raw.ignoredReasons ?? []) {
      if (node.ignoredReasons.length >= L.reasons) { limit('Ignored-reason storage stopped at 16 entries.'); break }
      const related = await relations(reason.value)
      node.ignoredReasons.push({ reason: bounded(reason.name, 80), ...(related ? { related } : {}) })
    }
    const final = await session.send('Runtime.callFunctionOn', {
      objectId, returnByValue: true,
      functionDeclaration: `function() {
        const targets=document.querySelectorAll(${JSON.stringify(options.selector)});
        if(!this.isConnected||targets.length!==1||targets[0]!==this)throw new Error('stale_element_ref: The target changed during accessibility inspection.');
        return {url:location.href.slice(0,4096),title:document.title.slice(0,300)};
      }`
    })
    if (final.exceptionDetails || !final.result.value) throw new Error('stale_element_ref: The page or target changed during accessibility inspection.')
    report.page = final.result.value
    a.elapsedMs = Math.round((performance.now() - started) * 100) / 100
    while (JSON.stringify(report).length > L.resultJson) {
      limit('Low-priority evidence was omitted to keep the response below 26000 characters.')
      if (node.nameSources.length) node.nameSources.pop()
      else if (node.ignoredReasons.length) node.ignoredReasons.pop()
      else if (node.properties.length) node.properties.pop()
      else throw new Error('Native accessibility evidence exceeded its output limit.')
    }
    if (!isPreviewAccessibilityResult(report)) throw new Error('Chromium returned unsupported accessibility evidence.')
    return report
  }
  try { return { ok: true, ...await Promise.race([work(), timeout]) } }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message.split('\n')[0] : 'Native accessibility inspection failed.' } }
  finally {
    expired = true
    if (timer) clearTimeout(timer)
    await cdp?.detach().catch(() => {})
  }
}
