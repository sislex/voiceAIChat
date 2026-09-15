// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Круг 16: место по сторонам, картинки и оверлеи, dismiss, peek и мосты
// ссылки/жестов/режима чтения — то, что человек видит и делает первым делом.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, type PreviewActionResultMessage, type PreviewClickResult, type PreviewDismissResult, type PreviewDomAction, type PreviewFindResult, type PreviewReadResult, type PreviewScrollResult } from '@voicechat/shared'
import { previewInspectorScript } from './previewProxy.js'

let counter = 0
function act(action: PreviewDomAction): Promise<PreviewActionResultMessage> {
  const requestId = `c16-${++counter}`
  return new Promise((resolve) => {
    const listener = (event: MessageEvent): void => {
      const data = event.data as PreviewActionResultMessage | undefined
      if (!data || data.type !== PREVIEW_ACTION_RESULT_TYPE || data.requestId !== requestId) return
      window.removeEventListener('message', listener)
      resolve(data)
    }
    window.addEventListener('message', listener)
    window.dispatchEvent(new MessageEvent('message', { data: { type: PREVIEW_ACTION_COMMAND_TYPE, requestId, action }, origin: window.location.origin, source: window }))
  })
}
/** Сообщение оболочки странице (режим чтения и т. п.). */
function fromParent(data: object): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window }))
}
/** Геометрия из data-rect="x,y,w,h": jsdom не считает раскладку, а стороны и оверлеи живут на ней. */
const originalRect = Element.prototype.getBoundingClientRect
function rectFromData(this: Element): DOMRect {
  const raw = this.getAttribute('data-rect')
  const [x, y, width, height] = raw ? raw.split(',').map(Number) : [0, 0, 0, 0]
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect
}

beforeAll(() => {
  const body = previewInspectorScript().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
})
beforeEach(() => { Element.prototype.getBoundingClientRect = rectFromData })
afterEach(() => { Element.prototype.getBoundingClientRect = originalRect })

describe('круг 16: место по сторонам, как показывает человек', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section aria-label="Товар">
        <h2 data-rect="10,10,200,30">Ноутбук</h2>
        <p data-rect="10,50,100,20">Цена: 1000 ₽</p>
        <button data-rect="10,80,100,30" id="buy-under">Купить</button>
        <button data-rect="300,50,100,30" id="buy-right">Купить</button>
        <button data-rect="10,400,100,30" id="buy-far">Купить</button>
      </section>`
  })
  it('find {below} отдаёт ближайшее под ориентиром первым, {rightOf} — то, что правее', async () => {
    const below = (await act({ kind: 'find', text: 'Купить', below: 'Цена' })).result as PreviewFindResult
    expect(below.elements.map(el => el.selector)).toEqual(['#buy-under', '#buy-far'])
    const right = (await act({ kind: 'find', text: 'Купить', rightOf: 'Цена' })).result as PreviewFindResult
    expect(right.elements.map(el => el.selector)).toEqual(['#buy-right'])
  })
  it('click с ориентиром нажимает ближайшего кандидата, а без него честно жалуется на неоднозначность', async () => {
    const plain = await act({ kind: 'click', text: 'Купить', confirm: true })
    expect(plain.ok).toBe(false); expect(String(plain.error)).toContain('неоднозначен')
    const clicked = (await act({ kind: 'click', text: 'Купить', below: 'Цена', confirm: true })).result as PreviewClickResult
    expect(clicked.clicked.selector).toBe('#buy-under')
  })
  it('неизвестный ориентир — понятная ошибка', async () => {
    const res = await act({ kind: 'find', text: 'Купить', above: 'Скидка' })
    expect(res.ok).toBe(false); expect(String(res.error)).toContain('Ориентир не найден')
  })
  it('find {details} добавляет атрибуты, размер и путь по ориентирам', async () => {
    document.body.innerHTML = `<main><form aria-label="Вход"><input id="login" name="login" type="email" data-rect="20,30,200,32" class="field wide" aria-required="true"></form></main>`
    const found = (await act({ kind: 'find', selector: '#login', details: true })).result as PreviewFindResult
    expect(found.elements[0].details).toEqual({ id: 'login', classes: ['field', 'wide'], attributes: expect.objectContaining({ name: 'login', type: 'email', 'aria-required': 'true' }), box: { x: 20, y: 30, width: 200, height: 32 }, path: 'main › form «Вход»' })
    const plain = (await act({ kind: 'find', selector: '#login' })).result as PreviewFindResult
    expect(plain.elements[0].details).toBeUndefined()
  })
})

describe('круг 16: peek — куда ведёт ссылка', () => {
  it('peek не переходит и отдаёт адрес, признак другого сайта и новой вкладки', async () => {
    document.body.innerHTML = `<a href="https://other.example/docs" target="_blank" id="ext">Документация</a><a href="/about" id="int">О нас</a><button id="btn">Кнопка</button>`
    let navigated = false
    document.getElementById('ext')!.addEventListener('click', () => { navigated = true })
    const ext = (await act({ kind: 'click', text: 'Документация', peek: true })).result as PreviewClickResult
    expect(ext).toMatchObject({ peeked: true, href: 'https://other.example/docs', external: true, newTab: true })
    expect(navigated).toBe(false)
    const int = (await act({ kind: 'click', selector: '#int', peek: true })).result as PreviewClickResult
    expect(int.href).toContain('/about'); expect(int.newTab).toBe(false)
    const btn = (await act({ kind: 'click', selector: '#btn', peek: true })).result as PreviewClickResult
    expect(btn.peeked).toBe(true); expect(btn.href).toBeUndefined()
  })
})

describe('круг 16: картинки и оверлеи в read', () => {
  it('без parts — до пяти подписанных картинок, с parts images — все видимые с адресом и размером', async () => {
    document.body.innerHTML = `<img src="/img/cat.jpg" alt="Кот на окне" width="300" height="200"><img src="/img/deco.png" width="100" height="100"><img src="/img/dot.gif" width="1" height="1" alt="пиксель">`
    const plain = (await act({ kind: 'read' })).result as PreviewReadResult
    expect(plain.images).toEqual([expect.objectContaining({ alt: 'Кот на окне', width: 300, height: 200 })])
    expect(plain.images![0].src).toContain('/img/cat.jpg')
    const all = (await act({ kind: 'read', parts: ['images'] })).result as PreviewReadResult
    expect(all.images).toHaveLength(2)
    expect(all.headings).toEqual([])
  })
  it('overlays перечисляют баннер cookie, окно и крупную липкую панель', async () => {
    document.body.innerHTML = `
      <div id="cookies" style="position:fixed" data-rect="0,700,1024,68">Мы используем cookie <button>Принять</button> <button>Отклонить</button></div>
      <div role="dialog" id="promo"><h2>Скидка 10%</h2><button aria-label="Закрыть">×</button></div>
      <div id="tiny" style="position:fixed" data-rect="0,0,40,40">чат</div>
      <div id="big" style="position:sticky" data-rect="0,0,1024,120">Шапка сайта</div>
      <p>Текст</p>`
    const page = (await act({ kind: 'read' })).result as PreviewReadResult
    expect(page.overlays).toEqual([
      { selector: '#cookies', text: expect.stringContaining('cookie'), kind: 'cookies' },
      { selector: '#promo', text: expect.stringContaining('Скидка'), kind: 'dialog' },
      { selector: '#big', text: 'Шапка сайта', kind: 'sticky' }
    ])
  })
})

describe('круг 16: dismiss — убрать то, что мешает, как осторожный человек', () => {
  it('cookie: предпочитает «Отклонить», сообщает how и remaining', async () => {
    document.body.innerHTML = `<div id="cookies" style="position:fixed" data-rect="0,700,1024,68">Мы используем cookie <button id="ok">Принять все</button> <button id="no">Отклонить</button></div><p>Текст</p>`
    document.getElementById('no')!.addEventListener('click', () => document.getElementById('cookies')!.remove())
    const res = (await act({ kind: 'dismiss', what: 'cookies' })).result as PreviewDismissResult
    expect(res).toMatchObject({ dismissed: true, how: 'rejected', remaining: 0 })
    expect(res.target?.selector).toContain('#no')
  })
  it('cookie без отказа: закрывает крестиком, а принимает только когда иного выбора нет', async () => {
    document.body.innerHTML = `<div id="cookies" style="position:fixed" data-rect="0,700,1024,68">Файлы cookie <button id="ok">Принять</button> <button id="x" aria-label="Закрыть">×</button></div>`
    document.getElementById('x')!.addEventListener('click', () => document.getElementById('cookies')!.remove())
    expect((await act({ kind: 'dismiss' })).result).toMatchObject({ dismissed: true, how: 'closed' })
    document.body.innerHTML = `<div id="cookies" style="position:fixed" data-rect="0,700,1024,68">Файлы cookie <button id="ok">Принять</button></div>`
    document.getElementById('ok')!.addEventListener('click', () => document.getElementById('cookies')!.remove())
    expect((await act({ kind: 'dismiss' })).result).toMatchObject({ dismissed: true, how: 'accepted' })
  })
  it('окно без кнопок закрывается Escape; когда закрывать нечего — dismissed: false', async () => {
    document.body.innerHTML = `<div role="dialog" id="modal"><p>Подпишитесь</p></div>`
    document.addEventListener('keyup', (event) => { if (event.key === 'Escape') document.getElementById('modal')?.remove() }, { once: true })
    expect((await act({ kind: 'dismiss', what: 'dialog' })).result).toMatchObject({ dismissed: true, how: 'escape', remaining: 0 })
    expect((await act({ kind: 'dismiss' })).result).toMatchObject({ dismissed: false, remaining: 0 })
  })
  it('what: dialog не трогает баннер cookie', async () => {
    document.body.innerHTML = `<div id="cookies" style="position:fixed" data-rect="0,700,1024,68">cookie <button>Отклонить</button></div>`
    expect((await act({ kind: 'dismiss', what: 'dialog' })).result).toMatchObject({ dismissed: false })
  })
})

describe('круг 16: scroll.percent и мосты оболочки', () => {
  it('scroll отдаёт процент прокрутки', async () => {
    document.body.innerHTML = '<div id="box" style="overflow:auto"><p>x</p></div>'
    const box = document.getElementById('box')!
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 1000 }); Object.defineProperty(box, 'clientHeight', { configurable: true, value: 200 })
    const res = (await act({ kind: 'scroll', selector: '#box', percent: 50 })).result as PreviewScrollResult
    expect(res.percent).toBe(50)
  })
  it('ссылка под курсором и долгое нажатие уходят оболочке с адресом, текстом и признаком новой вкладки', () => {
    document.body.innerHTML = `<a id="a" href="https://other.example/x" target="_blank">Туда</a><p id="p">текст</p>`
    const post = vi.spyOn(window, 'postMessage')
    const link = document.getElementById('a')!
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    const hover = post.mock.calls.map(([m]) => m as Record<string, unknown>).find(m => m.type === 'voicechat.preview.link.v1')
    expect(hover).toMatchObject({ href: 'https://other.example/x', text: 'Туда', newTab: true, longPress: false })
    link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.getElementById('p') }))
    const cleared = post.mock.calls.map(([m]) => m as Record<string, unknown>).filter(m => m.type === 'voicechat.preview.link.v1').at(-1)
    expect(cleared).toMatchObject({ href: '' })
    post.mockRestore()
  })
  it('свайп от левого края — жест «назад», долгое нажатие на ссылку — её меню', () => {
    vi.useFakeTimers()
    try {
      document.body.innerHTML = `<a id="a" href="/next">Далее</a>`
      const post = vi.spyOn(window, 'postMessage')
      const touch = (type: string, x: number, y: number, target: Element): void => {
        const event = new Event(type, { bubbles: true }) as Event & { touches: unknown[]; changedTouches: unknown[] }
        event.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }]; event.changedTouches = [{ clientX: x, clientY: y }]
        target.dispatchEvent(event)
      }
      touch('touchstart', 10, 300, document.body); touch('touchend', 200, 310, document.body)
      expect(post.mock.calls.map(([m]) => m as Record<string, unknown>).find(m => m.type === 'voicechat.preview.gesture.v1')).toMatchObject({ gesture: 'back' })
      const link = document.getElementById('a')!
      touch('touchstart', 100, 100, link); vi.advanceTimersByTime(600)
      expect(post.mock.calls.map(([m]) => m as Record<string, unknown>).filter(m => m.type === 'voicechat.preview.link.v1').at(-1)).toMatchObject({ longPress: true, text: 'Далее' })
      post.mockRestore()
    } finally { vi.useRealTimers() }
  })
  it('режим чтения добавляет и убирает стиль страницы', () => {
    fromParent({ type: 'voicechat.preview.reader.v1', enabled: true })
    expect(document.getElementById('voicechat-reader-style')?.textContent).toContain('nav,header,footer')
    fromParent({ type: 'voicechat.preview.reader.v1', enabled: false })
    expect(document.getElementById('voicechat-reader-style')).toBeNull()
  })
})
