import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { previewContextScript } from './previewProxy.js'

let dom: JSDOM
const base = 'https://example.test/catalog/page'
const setup = (html: string) => {
  dom = new JSDOM(html, { url: 'https://reader.test/api/preview?url=' + encodeURIComponent(base), runScripts: 'outside-only' })
  dom.window.eval(previewContextScript(base).replace(/^<script>/, '').replace(/<\/script>$/, ''))
  return dom.window
}
const proxyTarget = (el: Element, attr: string) => new URL(el.getAttribute(attr)!, 'https://reader.test').searchParams.get('url')
afterEach(() => dom?.window.close())

describe('context: динамическая нативная навигация', () => {
  it('динамическая ссылка получает базу страницы', () => {
    const w = setup('<a href="./next">Next</a>'); const a = w.document.querySelector('a')!
    w.addEventListener('click', e => e.preventDefault())
    a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(proxyTarget(a, 'href')).toBe('https://example.test/catalog/next')
  })
  it('повторный click не вкладывает прокси в прокси', () => {
    const w = setup('<a href="/next">Next</a>'); const a = w.document.querySelector('a')!
    w.addEventListener('click', e => e.preventDefault())
    for (let i = 0; i < 2; i++) a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(proxyTarget(a, 'href')).toBe('https://example.test/next')
  })
  it.each(['#chapter', 'mailto:qa@example.test', 'tel:+100'])('не меняет локальную или специальную ссылку %s', href => {
    const w = setup(`<a href="${href}">Next</a>`); const a = w.document.querySelector('a')!
    w.addEventListener('click', e => e.preventDefault())
    a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(a.getAttribute('href')).toBe(href)
  })
  it('не меняет ссылку после отмены обработчиком приложения', () => {
    const w = setup('<a href="/handled">Next</a>'); const a = w.document.querySelector('a')!
    a.addEventListener('click', e => e.preventDefault())
    a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(a.getAttribute('href')).toBe('/handled')
  })
  it('POST сохраняет нативную отправку и применяет override кнопки', () => {
    const w = setup('<form action="/original"><button formaction="/save" formmethod="post" formtarget="_blank">Send</button></form>')
    const form = w.document.querySelector('form')!, button = w.document.querySelector('button')!
    const event = new w.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button })
    form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false); expect(proxyTarget(button, 'formaction')).toBe('https://example.test/save')
    expect(button.getAttribute('formtarget')).toBe('_self')
  })
  it('отмена submit сохраняет action приложения', () => {
    const w = setup('<form method="post" action="/save"></form>'), form = w.document.querySelector('form')!
    form.addEventListener('submit', e => e.preventDefault()); form.dispatchEvent(new w.SubmitEvent('submit', { bubbles: true, cancelable: true }))
    expect(form.getAttribute('action')).toBe('/save')
  })
  it('dialog закрывается по нативной семантике', () => {
    const w = setup('<form method="dialog" action="/unchanged"></form>'), form = w.document.querySelector('form')!
    const event = new w.SubmitEvent('submit', { bubbles: true, cancelable: true }); form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false); expect(form.getAttribute('action')).toBe('/unchanged')
  })
  it('не меняет адрес download при обычном клике', () => {
    const w = setup('<a href="/file" download>Download</a>'), a = w.document.querySelector('a')!
    w.addEventListener('click', e => e.preventDefault()); a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(a.getAttribute('href')).toBe('/file')
  })
})
