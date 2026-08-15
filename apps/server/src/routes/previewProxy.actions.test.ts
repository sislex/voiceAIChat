// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Поведение автономного скрипта превью: DOM-действия модели (find/click/type/
// read) исполняются на реальном DOM. jsdom здесь заменяет iframe: parent ===
// window, поэтому команда и ответ ходят через postMessage одного окна.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  PREVIEW_ACTION_COMMAND_TYPE,
  PREVIEW_ACTION_RESULT_TYPE,
  type PreviewActionResultMessage,
  type PreviewDomAction
} from '@voicechat/shared'
import { PreviewProxyError, previewContextScript, previewInspectorScript, publicLookupResult, requestCookieHeader, storeResponseCookies } from './previewProxy.js'

let counter = 0

/** Шлёт команду скрипту и ждёт его ответ с тем же requestId. */
function act(action: PreviewDomAction): Promise<PreviewActionResultMessage> {
  const requestId = `r${++counter}`
  return new Promise((resolve) => {
    const listener = (event: MessageEvent): void => {
      const data = event.data as PreviewActionResultMessage | undefined
      if (!data || data.type !== PREVIEW_ACTION_RESULT_TYPE || data.requestId !== requestId) return
      window.removeEventListener('message', listener)
      resolve(data)
    }
    window.addEventListener('message', listener)
    // jsdom не заполняет event.source у window.postMessage, а скрипт проверяет
    // источник и origin — диспатчим MessageEvent с ними вручную.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PREVIEW_ACTION_COMMAND_TYPE, requestId, action },
        origin: window.location.origin,
        source: window
      })
    )
  })
}

beforeAll(() => {
  const body = previewInspectorScript().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
})

beforeEach(() => {
  document.title = 'Магазин'
  document.body.innerHTML = `
    <nav>
      <a href="/api/preview?url=${encodeURIComponent('https://shop.example/electronics')}"><span>Электроника</span></a>
      <a href="/api/preview?url=${encodeURIComponent('https://shop.example/books')}">Книги</a>
    </nav>
    <main>
      <h1>Группы товаров</h1>
      <h2>Электроника</h2>
      <h2>Книги</h2>
      <form id="search-form"><input id="q" name="q" placeholder="Поиск"><button type="submit">Найти</button></form>
      <input type="password" id="secret" value="тайна">
    </main>`
})

describe('DNS lookup веб-превью', () => {
  const publicAddresses = [
    { address: '93.184.216.34', family: 4 as const },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 as const }
  ]

  it('возвращает весь массив, когда HTTP-клиент запрашивает all: true', () => {
    expect(publicLookupResult(publicAddresses, true)).toEqual(publicAddresses)
  })

  it('возвращает один адрес в обычном режиме lookup', () => {
    expect(publicLookupResult(publicAddresses, false)).toEqual(publicAddresses[0])
  })

  it('отвергает ответ DNS, если хотя бы один адрес непубличный', () => {
    expect(() => publicLookupResult([...publicAddresses, { address: '127.0.0.1', family: 4 }], true))
      .toThrow(PreviewProxyError)
  })
})

describe('контекст браузера веб-превью', () => {
  it('передаёт cookie только тому же пользователю, домену, пути и HTTPS', () => {
    storeResponseCookies('alice', new URL('https://shop.example/login'), ['sid=one; Path=/; Secure; HttpOnly', 'only-cart=yes; Path=/cart'])
    expect(requestCookieHeader('alice', new URL('https://shop.example/cart/1'))).toBe('only-cart=yes; sid=one')
    expect(requestCookieHeader('alice', new URL('http://shop.example/cart/1'))).toBe('only-cart=yes')
    expect(requestCookieHeader('alice', new URL('https://other.example/cart/1'))).toBeUndefined()
    expect(requestCookieHeader('bob', new URL('https://shop.example/cart/1'))).toBeUndefined()
  })

  it('изолирует local/sessionStorage и имена IndexedDB внешнего origin', () => {
    const body = previewContextScript('https://shop.example')
    expect(body).toContain('voicechat.preview.context.v1:https://shop.example:')
    expect(body).toContain("'indexedDB'")
    expect(body).toContain("'localStorage'")
    expect(body).toContain("'sessionStorage'")
  })
})

describe('скрипт превью: DOM-действия', () => {
  it('read отдаёт заголовки, ссылки без прокси-обёртки, кнопки и поля', async () => {
    const res = await act({ kind: 'read' })
    expect(res.ok).toBe(true)
    const page = res.result as {
      page: { title: string }
      headings: { level: number; text: string }[]
      links: { text: string; href: string }[]
      buttons: string[]
      inputs: { type: string; value: string; name: string }[]
      text: string
    }
    expect(page.page.title).toBe('Магазин')
    expect(page.headings).toContainEqual({ level: 2, text: 'Электроника' })
    expect(page.links).toContainEqual({ text: 'Электроника', href: 'https://shop.example/electronics' })
    expect(page.buttons).toContain('Найти')
    expect(page.inputs.find((i) => i.name === 'q')?.type).toBe('text')
    // Значения парольных полей не покидают страницу.
    expect(page.inputs.find((i) => i.type === 'password')?.value).toBe('')
    expect(page.text).toContain('Группы товаров')
  })

  it('read с selector ограничивает область', async () => {
    const res = await act({ kind: 'read', selector: 'nav' })
    expect(res.ok).toBe(true)
    const page = res.result as { headings: unknown[]; links: unknown[] }
    expect(page.headings).toHaveLength(0)
    expect(page.links).toHaveLength(2)
  })

  it('find по тексту находит глубочайший элемент и считает total', async () => {
    const res = await act({ kind: 'find', text: 'Электроника' })
    expect(res.ok).toBe(true)
    const found = res.result as { elements: { tag: string; text: string }[]; total: number }
    expect(found.total).toBeGreaterThanOrEqual(2)
    expect(found.elements[0].text).toBe('Электроника')
  })

  it('click по тексту поднимается до кликабельного предка-ссылки', async () => {
    const link = document.querySelector('nav a') as HTMLAnchorElement
    let clicked = false
    link.addEventListener('click', (e) => { clicked = true; e.preventDefault() })
    const res = await act({ kind: 'click', text: 'Электроника' })
    expect(res.ok).toBe(true)
    expect(clicked).toBe(true)
    expect((res.result as { clicked: { tag: string } }).clicked.tag).toBe('a')
  })

  it('click по отсутствующему элементу — ошибка, а не молчание', async () => {
    const res = await act({ kind: 'click', text: 'Такого нет' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('не найден')
  })

  it('type вводит текст с событиями input/change и submit отправляет форму', async () => {
    const input = document.getElementById('q') as HTMLInputElement
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    document.getElementById('search-form')!.addEventListener('submit', (e) => { events.push('submit'); e.preventDefault() })
    const res = await act({ kind: 'type', selector: '#q', text: 'ноутбук', submit: true })
    expect(res.ok).toBe(true)
    expect(input.value).toBe('ноутбук')
    expect(events).toEqual(['input', 'change', 'submit'])
    expect((res.result as { submitted: boolean }).submitted).toBe(true)
  })

  it('type в не-поле — ошибка', async () => {
    const res = await act({ kind: 'type', selector: 'h1', text: 'x' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('полем ввода')
  })

  it('битый CSS-селектор — понятная ошибка', async () => {
    const res = await act({ kind: 'find', selector: '::!bad' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Некорректный CSS-селектор')
  })
})

// Сетевой шим context-скрипта: fetch/XHR/sendBeacon/навигация переписываются
// на /api/preview. Нативные fetch/XHR/beacon подменяются моками ДО eval —
// шим захватывает их как «нативные», и тесты видят, куда реально ушёл вызов.
describe('контекст превью: сетевой шим', () => {
  const fetchCalls: { input: unknown; init?: RequestInit }[] = []
  const beaconCalls: unknown[][] = []
  const xhrOpenCalls: unknown[][] = []
  const xhrHeaderCalls: [string, string][] = []

  class FakeXhr {
    open(...args: unknown[]): void { xhrOpenCalls.push(args) }
    setRequestHeader(name: string, value: string): void { xhrHeaderCalls.push([name, value]) }
    send(): void {}
  }

  beforeAll(() => {
    ;(window as unknown as { fetch: unknown }).fetch = (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ input, init })
      return Promise.resolve('proxied-response')
    }
    ;(window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => { beaconCalls.push(args); return true }
    })
    const body = previewContextScript('https://shop.example/base/').replace(/^<script>/, '').replace(/<\/script>$/, '')
    ;(0, eval)(body)
  })

  it('fetch с относительным и абсолютным URL уходит в /api/preview с credentials', async () => {
    await window.fetch('/api/data')
    expect(fetchCalls.at(-1)?.input).toBe('/api/preview?url=' + encodeURIComponent('https://shop.example/api/data'))
    expect(fetchCalls.at(-1)?.init?.credentials).toBe('same-origin')
    await window.fetch('https://shop.example/items?page=2')
    expect(fetchCalls.at(-1)?.input).toBe('/api/preview?url=' + encodeURIComponent('https://shop.example/items?page=2'))
  })

  it('fetch не трогает уже обёрнутые и не-http URL', async () => {
    const proxied = '/api/preview?url=' + encodeURIComponent('https://shop.example/x')
    await window.fetch(proxied)
    expect(fetchCalls.at(-1)?.input).toBe(proxied)
    expect(fetchCalls.at(-1)?.init).toBeUndefined()
    await window.fetch('data:text/plain,hi')
    expect(fetchCalls.at(-1)?.input).toBe('data:text/plain,hi')
  })

  it('fetch сохраняет метод, тело и content-type, а Authorization страницы прячет от Bearer-гейта', async () => {
    await window.fetch('/login', { method: 'POST', body: '{"a":1}', headers: { Authorization: 'Bearer site-token', 'Content-Type': 'application/json' } })
    const call = fetchCalls.at(-1)!
    expect(call.init?.method).toBe('POST')
    expect(call.init?.body).toBe('{"a":1}')
    const headers = call.init?.headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-preview-authorization')).toBe('Bearer site-token')
  })

  it('XMLHttpRequest.open переписывает URL, setRequestHeader переименовывает Authorization', () => {
    const xhr = new (window as unknown as { XMLHttpRequest: new () => FakeXhr }).XMLHttpRequest()
    xhr.open('POST', 'submit')
    expect(xhrOpenCalls.at(-1)).toEqual(['POST', '/api/preview?url=' + encodeURIComponent('https://shop.example/base/submit')])
    xhr.open('GET', 'https://shop.example/api/list', true)
    expect(xhrOpenCalls.at(-1)).toEqual(['GET', '/api/preview?url=' + encodeURIComponent('https://shop.example/api/list'), true])
    xhr.setRequestHeader('Authorization', 'Bearer t')
    expect(xhrHeaderCalls.at(-1)).toEqual(['x-preview-authorization', 'Bearer t'])
  })

  it('navigator.sendBeacon заворачивает целевой URL в прокси', () => {
    navigator.sendBeacon('https://shop.example/metrics', 'payload')
    expect(beaconCalls.at(-1)).toEqual(['/api/preview?url=' + encodeURIComponent('https://shop.example/metrics'), 'payload'])
  })

  it('шим содержит best-effort перехват location.assign/replace/href', () => {
    const script = previewContextScript('https://shop.example/base/')
    expect(script).toContain("Object.defineProperty(location,'assign'")
    expect(script).toContain("Object.defineProperty(location,'replace'")
    expect(script).toContain("Object.defineProperty(location,'href'")
  })

  // Тест меняет location через pushState — держим его последним в файле.
  it('history.pushState остаётся внутри /api/preview и сдвигает базу относительных fetch', async () => {
    history.pushState({}, '', '/spa/page')
    expect(location.pathname).toBe('/api/preview')
    expect(location.search).toContain(encodeURIComponent('https://shop.example/spa/page'))
    await window.fetch('next')
    expect(fetchCalls.at(-1)?.input).toBe('/api/preview?url=' + encodeURIComponent('https://shop.example/spa/next'))
  })
})
