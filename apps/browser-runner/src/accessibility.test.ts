import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import type { PreviewAccessibilityResult } from '@voicechat/shared'
import { isPreviewAccessibilityResult } from '@voicechat/shared'
import { readNativeAccessibility } from './accessibility'

let browser: Browser
let page: Page

async function inspect(html: string, setup?: (page: Page) => Promise<void>): Promise<PreviewAccessibilityResult> {
  await page.setContent('<!doctype html>' + html)
  await setup?.(page)
  const result = await readNativeAccessibility(page, { selector: '#target' })
  expect(result.ok, result.error).toBe(true)
  const report = { page: result.page, accessibility: result.accessibility }
  expect(isPreviewAccessibilityResult(report)).toBe(true)
  return report as PreviewAccessibilityResult
}

describe('native Chromium accessibility evidence', () => {
  beforeAll(async () => { browser = await chromium.launch() })
  beforeEach(async () => { page = await browser.newPage() })
  afterEach(async () => { await page.close() })
  afterAll(async () => { await browser.close() })

  it('reports the browser-computed role and fallback semantics', async () => {
    const result = await inspect('<button id="target">Save</button>')
    expect(result.accessibility.node).toMatchObject({ role: 'button', name: 'Save', ignored: false })
  })

  it('includes browser-computed generated text in a name', async () => {
    const result = await inspect('<style>#target::before{content:"Save"}</style><button id="target"></button>')
    expect(result.accessibility.node.name).toBe('Save')
  })

  it('reports name precedence without returning raw attribute values', async () => {
    const result = await inspect('<button id="target" aria-label="Current" title="Superseded">Body</button>')
    expect(result.accessibility.node.name).toBe('Current')
    expect(result.accessibility.node.nameSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribute: 'aria-label' }),
      expect.objectContaining({ superseded: true })
    ]))
    expect(JSON.stringify(result.accessibility.node.nameSources)).not.toContain('Superseded')
  })

  it('reports the browser-computed description', async () => {
    const result = await inspect('<button id="target" aria-description="Explains the action">Save</button>')
    expect(result.accessibility.node.description).toBe('Explains the action')
  })

  it('reports ignored status and native reasons for hidden content', async () => {
    const result = await inspect('<div id="target" hidden>Hidden</div>')
    expect(result.accessibility.node.ignored).toBe(true)
    expect(result.accessibility.node.ignoredReasons.length).toBeGreaterThan(0)
  })

  const properties: Array<[string, string, string | number | boolean, ((page: Page) => Promise<void>)?]> = [
    ['focusable', '<button id="target">Save</button>', true],
    ['focused', '<input id="target">', true, async page => { await page.locator('#target').focus() }],
    ['disabled', '<button id="target" disabled>Save</button>', true],
    ['editable', '<div id="target" contenteditable>Text</div>', 'richtext'],
    ['readonly', '<input id="target" readonly>', true],
    ['required', '<input id="target" required>', true],
    ['invalid', '<input id="target" aria-invalid="true">', 'true'],
    ['autocomplete', '<input id="target" role="combobox" aria-autocomplete="list" aria-expanded="false">', 'list'],
    ['hasPopup', '<button id="target" aria-haspopup="dialog">Open</button>', 'dialog'],
    ['level', '<div id="target" role="heading" aria-level="3">Heading</div>', 3],
    ['multiselectable', '<div id="target" role="listbox" aria-multiselectable="true"><div role="option">One</div></div>', true],
    ['orientation', '<div id="target" role="slider" aria-valuenow="2" aria-orientation="vertical" tabindex="0"></div>', 'vertical'],
    ['multiline', '<div id="target" role="textbox" aria-multiline="true" contenteditable>Text</div>', true],
    ['valuemin', '<div id="target" role="slider" aria-valuenow="5" aria-valuemin="2" aria-valuemax="10" tabindex="0"></div>', 2],
    ['valuemax', '<div id="target" role="slider" aria-valuenow="5" aria-valuemin="2" aria-valuemax="10" tabindex="0"></div>', 10],
    ['checked', '<div id="target" role="checkbox" aria-checked="mixed" tabindex="0">Choice</div>', 'mixed'],
    ['expanded', '<button id="target" aria-expanded="true">Show</button>', true],
    ['modal', '<dialog id="target"><button>Close</button></dialog>', true, async page => { await page.locator('#target').evaluate((node: any) => node.showModal()) }],
    ['pressed', '<button id="target" aria-pressed="mixed">Toggle</button>', 'mixed'],
    ['selected', '<div role="tablist"><button id="target" role="tab" aria-selected="true">One</button></div>', true],
    ['live', '<div id="target" aria-live="polite">Update</div>', 'polite'],
    ['atomic', '<div id="target" aria-live="polite" aria-atomic="true">Update</div>', true],
    ['relevant', '<div id="target" aria-live="polite" aria-relevant="additions removals">Update</div>', 'additions removals']
  ]

  it.each(properties)('reports the native %s property without inventing missing state', async (name, html, value, setup) => {
    const result = await inspect(html, setup)
    expect(result.accessibility.node.properties).toContainEqual(expect.objectContaining({ name, value }))
    expect(result.accessibility.node.properties.every(item => item.value !== undefined || item.related?.length)).toBe(true)
  })

  it('maps browser relationships to bounded, reusable selectors', async () => {
    const result = await inspect('<label id="label" for="target">Choice</label><p id="description">Instructions</p><input id="target" role="combobox" aria-controls="popup" aria-expanded="true" aria-activedescendant="option" aria-describedby="description"><div id="popup" role="listbox"><div id="option" role="option">One</div></div>')
    const byName = new Map(result.accessibility.node.properties.map(item => [item.name, item]))
    expect(byName.get('controls')?.related).toContainEqual({ selector: '#popup', idref: 'popup' })
    expect(byName.get('describedby')?.related).toContainEqual({ selector: '#description', idref: 'description' })
    expect(byName.get('activedescendant')?.related).toContainEqual({ selector: '#option', idref: 'option' })
    expect(result.accessibility.node.nameSources.flatMap(source => source.related ?? [])).toContainEqual({ selector: '#label', idref: 'label' })
  })

  it('identifies native evidence separately when a DOM snapshot disagrees', async () => {
    await page.setContent('<!doctype html><button id="target"><img alt="" title="Save"></button>')
    expect(await page.locator('#target').ariaSnapshot()).toContain('Save')
    const result = await readNativeAccessibility(page, { selector: '#target' })
    expect(result.ok).toBe(true)
    expect(result.accessibility).toMatchObject({ source: 'chromium-accessibility', node: { name: '' } })
  })

  it('does not expose control values or mutate DOM, focus, selection, or scroll', async () => {
    await page.setContent('<!doctype html><style>body{height:2000px}</style><input id="target" type="password" value="native-ax-secret"><button id="focus">Focus</button>')
    await page.locator('#focus').focus()
    await page.evaluate('document.getSelection()?.selectAllChildren(document.body); scrollTo(0, 100)')
    const before = await page.evaluate('({html:document.documentElement.outerHTML,focus:document.activeElement?.id,selection:document.getSelection()?.toString(),scrollY})')
    const result = await readNativeAccessibility(page, { selector: '#target' })
    const after = await page.evaluate('({html:document.documentElement.outerHTML,focus:document.activeElement?.id,selection:document.getSelection()?.toString(),scrollY})')
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('native-ax-secret')
    expect(after).toEqual(before)
  })

  it('bounds related-node evidence and marks the omitted remainder', async () => {
    const ids = Array.from({ length: 30 }, (_, index) => 'target-' + index)
    const html = `<button id="target" aria-controls="${ids.join(' ')}">Open</button>` + ids.map(id => `<div id="${id}"></div>`).join('')
    const result = await inspect(html)
    const controls = result.accessibility.node.properties.find(property => property.name === 'controls')
    expect(controls?.related).toHaveLength(24)
    expect(result.accessibility).toMatchObject({ truncated: true, limitations: expect.arrayContaining([expect.stringContaining('24')]) })
  })

  it('detaches its short-lived CDP session after successful inspection', async () => {
    await page.setContent('<button id="target">Save</button>')
    const context = page.context(), create = context.newCDPSession.bind(context)
    let closed = false
    vi.spyOn(context, 'newCDPSession').mockImplementation(async target => {
      const session = await create(target)
      session.once('close', () => { closed = true })
      return session
    })
    expect(await readNativeAccessibility(page, { selector: '#target' })).toMatchObject({ ok: true })
    expect(closed).toBe(true)
  })

  it('rejects ambiguous, frame/code and stale Reader-reference requests', async () => {
    await page.setContent('<button class="duplicate">One</button><button class="duplicate">Two</button><button id="target" data-voicechat-reader-ref="stale">Target</button>')
    expect(await readNativeAccessibility(page, { selector: '.duplicate' })).toMatchObject({ ok: false, error: expect.stringContaining('exactly one') })
    expect(await readNativeAccessibility(page, { selector: '#target', frame: '#child' } as never)).toMatchObject({ ok: false })
    expect(await readNativeAccessibility(page, { selector: '#target', code: 'document.body.remove()' } as never)).toMatchObject({ ok: false })
    expect(await readNativeAccessibility(page, { selector: '#target' })).toMatchObject({ ok: false, error: expect.stringContaining('stale_element_ref') })
  })
})
