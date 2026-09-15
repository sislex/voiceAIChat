// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Поведение автономного скрипта превью: DOM-действия модели (find/click/type/
// read) исполняются на реальном DOM. jsdom здесь заменяет iframe: parent ===
// window, поэтому команда и ответ ходят через postMessage одного окна.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_ACTION_COMMAND_TYPE,
  PREVIEW_ACTION_RESULT_TYPE,
  type PreviewActionResultMessage,
  type PreviewDomAction
} from '@voicechat/shared'
import { PreviewProxyError, previewContextScript, previewDiagnosticsHtml, previewInspectorScript, publicLookupResult, requestCookieHeader, storeResponseCookies } from './previewProxy.js'

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

  // @testCase TC4
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
  it('общие параметры read и find не теряются в iframe-поверхности', async () => {
    const scope = document.createElement('section')
    scope.id = 'reader-pagination'
    scope.textContent = '0123456789'.repeat(30)
    document.body.append(scope)
    const res = await act({ kind: 'read', selector: '#reader-pagination', limit: 100, offset: 250 })
    expect(res.result).toMatchObject({ text: '0123456789'.repeat(5), total: 300, offset: 250 })
    const hidden = document.createElement('button'), shown = document.createElement('button')
    hidden.className = shown.className = 'reader-choice'
    hidden.style.display = 'none'; hidden.textContent = 'Скрытая копия'; shown.textContent = 'Видимая кнопка'
    document.body.append(hidden, shown)
    const found = await act({ kind: 'find', selector: '.reader-choice', visibleOnly: true, limit: 1 })
    expect(found.result).toMatchObject({ total: 1, elements: [{ text: 'Видимая кнопка' }] })
  })

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

  it('computed styles возвращает только запрошенные свойства', async () => {
    const res = await act({ kind: 'styles', selector: '#q', properties: ['display', 'color'], diagnostic: true })
    expect(res.ok).toBe(true)
    expect((res.result as { styles: Record<string, string> }).styles).toEqual(expect.objectContaining({ display: expect.any(String), color: expect.any(String) }))
  })

  it('внутренняя диагностическая страница детерминирована и имеет отдельную цель навигации', () => {
    expect(previewDiagnosticsHtml()).toContain('VoiceChat Web Reader Diagnostics')
    expect(previewDiagnosticsHtml()).toContain('id="diagnostic-input"')
    expect(previewDiagnosticsHtml(true)).toContain('Diagnostics destination')
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

describe('скрипт превью: hover, scroll, press', () => {
  it('hover шлёт pointer/mouse-события по элементу', async () => {
    const target = document.querySelector('nav a') as HTMLAnchorElement
    const events: string[] = []
    for (const type of ['mouseover', 'mouseenter', 'mousemove']) target.addEventListener(type, () => events.push(type))
    const res = await act({ kind: 'hover', text: 'Электроника' })
    expect(res.ok).toBe(true)
    expect((res.result as { hovered: { tag: string } }).hovered.tag).toBe('a')
    expect(events).toEqual(['mouseover', 'mouseenter', 'mousemove'])
  })

  it('hover по отсутствующему элементу — ошибка', async () => {
    const res = await act({ kind: 'hover', text: 'Такого нет' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('не найден')
  })

  it('scroll прокручивает контейнер и возвращает позицию', async () => {
    const main = document.querySelector('main') as HTMLElement
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(main, 'clientHeight', { configurable: true, value: 400 })
    const scrolls: number[] = []
    main.addEventListener('scroll', () => scrolls.push(main.scrollTop))
    const down = await act({ kind: 'scroll', selector: 'main', dy: 300 })
    expect(down.ok).toBe(true)
    expect((down.result as { scrolled: { top: number; maxTop: number } }).scrolled).toMatchObject({ top: 300, maxTop: 1600 })
    const bottom = await act({ kind: 'scroll', selector: 'main', to: 'bottom' })
    expect((bottom.result as { scrolled: { top: number } }).scrolled.top).toBe(2000)
    const top = await act({ kind: 'scroll', selector: 'main', to: 'top' })
    expect((top.result as { scrolled: { top: number }; target: string }).scrolled.top).toBe(0)
    expect(scrolls.length).toBe(3)
  })

  it('press шлёт keydown/keyup c нужной клавишей и фокусирует селектор', async () => {
    const input = document.getElementById('q') as HTMLInputElement
    const keys: string[] = []
    input.addEventListener('keydown', (e) => keys.push('down:' + e.key))
    input.addEventListener('keyup', (e) => keys.push('up:' + e.key))
    const res = await act({ kind: 'press', key: 'Escape', selector: '#q' })
    expect(res.ok).toBe(true)
    expect((res.result as { pressed: { key: string; selector: string } }).pressed).toMatchObject({ key: 'Escape', selector: '#q' })
    expect(keys).toEqual(['down:Escape', 'up:Escape'])
  })
})

describe('скрипт превью: действия как у пользователя (круг 1)', () => {
  it('type по field находит поле по label, placeholder или name; неоднозначность — ошибка со списком', async () => {
    document.body.insertAdjacentHTML('beforeend', `
      <form id="signup"><label for="email">Электронная почта</label><input id="email" name="email">
      <input id="phone" name="phone" placeholder="Телефон"><input id="city" aria-label="Город"><input id="city2" aria-label="Город доставки"></form>`)
    const byLabel = await act({ kind: 'type', field: 'электронная почта', text: 'a@b.c' })
    expect(byLabel.ok).toBe(true)
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('a@b.c')
    expect((byLabel.result as { value: string; typed: { selector: string } }).value).toBe('a@b.c')
    const byPlaceholder = await act({ kind: 'type', field: 'Телефон', text: '+7' })
    expect((document.getElementById('phone') as HTMLInputElement).value).toBe('+7')
    expect(byPlaceholder.ok).toBe(true)
    // Точное совпадение выигрывает у частичного: «Город» не путается с «Город доставки».
    const exact = await act({ kind: 'type', field: 'Город', text: 'Минск' })
    expect(exact.ok).toBe(true)
    expect((document.getElementById('city') as HTMLInputElement).value).toBe('Минск')
    const ambiguous = await act({ kind: 'type', field: 'Горо', text: 'x' })
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.error).toContain('неоднозначна')
    const missing = await act({ kind: 'type', field: 'Фамилия', text: 'x' })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('не найдено по подписи')
  })

  it('type с append дописывает к текущему значению и возвращает итог; секретное поле не раскрывает value', async () => {
    const input = document.getElementById('q') as HTMLInputElement
    input.value = 'ноут'
    const res = await act({ kind: 'type', selector: '#q', text: 'бук', append: true })
    expect(res.ok).toBe(true)
    expect(input.value).toBe('ноутбук')
    expect((res.result as { value: string }).value).toBe('ноутбук')
    const secret = await act({ kind: 'type', selector: '#secret', text: 'пароль' })
    expect(secret.ok).toBe(true)
    expect((secret.result as { value: string }).value).toBe('')
  })

  it('find по role отбирает элементы по роли, в том числе вместе с текстом', async () => {
    const buttons = await act({ kind: 'find', role: 'button' })
    expect(buttons.ok).toBe(true)
    const found = buttons.result as { elements: { text: string; role?: string }[]; total: number }
    expect(found.elements.map((el) => el.text)).toEqual(['Найти'])
    const links = await act({ kind: 'find', role: 'link', text: 'книги' })
    expect((links.result as { elements: { tag: string }[] }).elements).toEqual([expect.objectContaining({ tag: 'a', text: 'Книги' })])
    const headings = await act({ kind: 'find', role: 'heading' })
    expect((headings.result as { total: number }).total).toBe(3)
  })

  it('describe сообщает onScreen — виден ли элемент без прокрутки', async () => {
    const res = await act({ kind: 'find', selector: 'h1' })
    const [element] = (res.result as { elements: { onScreen: boolean }[] }).elements
    // jsdom не раскладывает элементы: rect нулевой — значит не на экране; поле присутствует всегда.
    expect(typeof element.onScreen).toBe('boolean')
  })

  it('scroll to: element показывает элемент и отвечает позицией окна', async () => {
    const heading = document.querySelector('h2') as HTMLElement
    let shown = false
    heading.scrollIntoView = () => { shown = true }
    const res = await act({ kind: 'scroll', selector: 'main h2', to: 'element' })
    expect(res.ok).toBe(true)
    expect(shown).toBe(true)
    expect((res.result as { scrolled: { top: number } }).scrolled).toMatchObject({ top: expect.any(Number) })
  })

  it('wait state hidden/detached ждёт исчезновения, attached считает скрытые узлы', async () => {
    const spinner = document.createElement('div')
    spinner.className = 'spinner'; spinner.textContent = 'Загрузка'
    document.body.append(spinner)
    setTimeout(() => { spinner.style.display = 'none' }, 150)
    const hidden = await act({ kind: 'wait', selector: '.spinner', state: 'hidden', timeoutMs: 2000 })
    expect(hidden.ok).toBe(true)
    expect(hidden.result).toMatchObject({ state: 'hidden' })
    expect((hidden.result as { found?: unknown }).found).toBeUndefined()
    const attached = await act({ kind: 'wait', selector: '.spinner', state: 'attached', timeoutMs: 300 })
    expect(attached.ok).toBe(true)
    setTimeout(() => spinner.remove(), 150)
    const detached = await act({ kind: 'wait', text: 'Загрузка', state: 'detached', timeoutMs: 2000 })
    expect(detached.ok).toBe(true)
    const stuck = document.createElement('div'); stuck.id = 'stuck'; document.body.append(stuck)
    const timeout = await act({ kind: 'wait', selector: '#stuck', state: 'detached', timeoutMs: 200 })
    expect(timeout.ok).toBe(false)
    expect(timeout.error).toContain('не исчез')
  }, 10_000)

  it('press с repeat нажимает клавишу несколько раз одним действием', async () => {
    const input = document.getElementById('q') as HTMLInputElement
    let downs = 0
    input.addEventListener('keydown', () => downs++)
    const res = await act({ kind: 'press', key: 'ArrowDown', selector: '#q', repeat: 3 })
    expect(res.ok).toBe(true)
    expect(downs).toBe(3)
    expect((res.result as { pressed: { repeat?: number } }).pressed.repeat).toBe(3)
  })
})

describe('скрипт превью: что видит пользователь (круг 2)', () => {
  it('describe отдаёт placeholder и значение поля, скрывая секретное', async () => {
    ;(document.getElementById('q') as HTMLInputElement).value = 'ноутбук'
    const res = await act({ kind: 'find', selector: '#q, #secret' })
    const [q, secret] = (res.result as { elements: { placeholder?: string; value?: string }[] }).elements
    expect(q).toMatchObject({ placeholder: 'Поиск', value: 'ноутбук' })
    expect(secret.value).toBeUndefined()
  })

  it('click подсвечивает элемент, сообщает появившийся диалог, фокус и синхронные ошибки', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="open-dialog">Открыть окно</button><div id="modal" role="dialog" style="display:none"><input id="modal-input"></div>`)
    const button = document.getElementById('open-dialog')!
    button.addEventListener('click', () => {
      document.getElementById('modal')!.style.display = 'block'
      ;(document.getElementById('modal-input') as HTMLInputElement).focus()
      console.error('modal opened badly')
    })
    const res = await act({ kind: 'click', text: 'Открыть окно' })
    expect(res.ok).toBe(true)
    expect(button.hasAttribute('data-voicechat-flash')).toBe(true)
    const result = res.result as { dialogs?: string[]; focus?: string; newErrors?: { message: string }[] }
    expect(result.dialogs).toEqual(['#modal'])
    expect(result.focus).toBe('#modal-input')
    expect(result.newErrors?.[0]?.message).toContain('modal opened badly')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(button.hasAttribute('data-voicechat-flash')).toBe(false)
  })

  it('hover возвращает подсказку из title или aria-describedby', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="hint-btn" aria-describedby="hint-text">Сохранить</button><span id="hint-text">Сохраняет черновик</span><a id="titled" href="/x" title="Подсказка ссылки">Ссылка с title</a>`)
    const described = await act({ kind: 'hover', selector: '#hint-btn' })
    expect((described.result as { tooltip?: string }).tooltip).toBe('Сохраняет черновик')
    const titled = await act({ kind: 'hover', selector: '#titled' })
    expect((titled.result as { tooltip?: string }).tooltip).toBe('Подсказка ссылки')
  })

  it('read visible оставляет только видимую область и сообщает viewport', async () => {
    const res = await act({ kind: 'read', visible: true })
    expect(res.ok).toBe(true)
    const result = res.result as { visible?: boolean; viewport?: { width: number }; headings: unknown[] }
    expect(result.visible).toBe(true)
    expect(result.viewport?.width).toBe(window.innerWidth)
    // jsdom не раскладывает элементы (все rect нулевые) — без прокрутки на «экране» ничего нет.
    expect(result.headings).toEqual([])
  })
})

describe('скрипт превью: различать одинаковое, как человек (круг 3)', () => {
  it('near выбирает кнопку по тексту строки, exact отсекает частичные совпадения', async () => {
    document.body.insertAdjacentHTML('beforeend', `<table><tr><td>Заказ №4</td><td><button class="del">Удалить</button></td></tr><tr><td>Заказ №5</td><td><button class="del">Удалить</button></td></tr></table><button id="del-all">Удалить все</button>`)
    const rows = document.querySelectorAll('button.del')
    let clicked: Element | null = null
    for (const button of rows) button.addEventListener('click', () => { clicked = button })
    const ambiguous = await act({ kind: 'click', text: 'Удалить', exact: true })
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.error).toContain('неоднозначен')
    const near = await act({ kind: 'click', text: 'Удалить', near: 'Заказ №5', exact: true })
    expect(near.ok).toBe(true)
    expect(clicked).toBe(rows[1])
    expect((near.result as { clicked: { context?: string } }).clicked.context).toContain('Заказ №5')
    const none = await act({ kind: 'find', text: 'Удалить', near: 'Заказ №9' })
    expect((none.result as { total: number }).total).toBe(0)
    const loose = await act({ kind: 'find', text: 'Удалить' })
    expect((loose.result as { total: number }).total).toBe(3)
    const exact = await act({ kind: 'find', text: 'Удалить', exact: true })
    expect((exact.result as { total: number }).total).toBe(2)
  })

  it('read перечисляет формы с полями и кнопкой отправки и ориентиры страницы', async () => {
    const res = await act({ kind: 'read' })
    const result = res.result as { forms?: { selector: string; fields: string[]; submit?: string }[]; landmarks?: { role: string }[] }
    expect(result.forms).toEqual([{ selector: '#search-form', fields: ['Поиск'], submit: 'Найти' }])
    expect(result.landmarks?.map((item) => item.role)).toEqual(['navigation', 'main'])
  })

  it('ready несёт outline страницы, scroll сообщает край', async () => {
    const messages: unknown[] = []
    const listener = (event: MessageEvent): void => { if ((event.data as { type?: string })?.type === 'voicechat.preview.page-ready.v1') messages.push(event.data) }
    window.addEventListener('message', listener)
    window.dispatchEvent(new Event('hashchange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    window.removeEventListener('message', listener)
    expect(messages.at(-1)).toMatchObject({ outline: { headings: ['Группы товаров', 'Электроника', 'Книги'], links: 2, buttons: 1, inputs: 2 } })
    const main = document.querySelector('main') as HTMLElement
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(main, 'clientHeight', { configurable: true, value: 400 })
    const bottom = await act({ kind: 'scroll', selector: 'main', to: 'bottom' })
    expect(bottom.result).toMatchObject({ atBottom: true, atTop: false })
    const top = await act({ kind: 'scroll', selector: 'main', to: 'top' })
    expect(top.result).toMatchObject({ atTop: true, atBottom: false })
  })
})

describe('скрипт превью: формы и меню как у человека (круг 4)', () => {
  it('fill заполняет поля по подписи и селектору, отправляет форму и отдаёт валидацию', async () => {
    document.body.insertAdjacentHTML('beforeend', `<form id="login"><label for="login-user">Логин</label><input id="login-user" name="user" required><input id="login-pw" type="password" required minlength="4"><button type="submit">Войти</button></form>`)
    document.getElementById('login')!.addEventListener('submit', (event) => event.preventDefault())
    const res = await act({ kind: 'fill', fields: [{ field: 'Логин', value: 'admin' }, { selector: '#login-pw', value: '' }], submit: true })
    expect(res.ok).toBe(true)
    const result = res.result as { filled: { selector: string; value: string }[]; submitted: boolean; validation?: { field: string; message: string }[] }
    expect(result.filled).toEqual([expect.objectContaining({ selector: '#login-user', value: 'admin' }), expect.objectContaining({ selector: '#login-pw', value: '' })])
    expect(result.submitted).toBe(true)
    // Пустое обязательное поле пароля — то, что человек увидел бы подсвеченным после отправки.
    expect(result.validation?.[0]?.field).toBe('#login-pw')
    expect(result.validation?.[0]?.message).toBeTruthy()
  })

  it('choose открывает триггер и нажимает появившийся пункт', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="lang">Язык</button><ul id="lang-menu" role="menu" style="display:none"><li role="menuitem">English</li><li role="menuitem">Русский</li></ul>`)
    document.getElementById('lang')!.addEventListener('click', () => { document.getElementById('lang-menu')!.style.display = 'block' })
    let chosen = ''
    for (const item of document.querySelectorAll('#lang-menu li')) item.addEventListener('click', () => { chosen = item.textContent || '' })
    const res = await act({ kind: 'choose', text: 'Русский', in: 'Язык' })
    expect(res.ok).toBe(true)
    expect(chosen).toBe('Русский')
    expect((res.result as { opened?: { text: string }; chosen: { text: string } })).toMatchObject({ opened: { text: 'Язык' }, chosen: { text: 'Русский' } })
    const missing = await act({ kind: 'choose', text: 'Deutsch', in: 'Язык' })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('Пункт не появился')
  }, 10_000)

  it('type сообщает подсказки datalist, hover — раскрывшиеся пункты, read — фокус', async () => {
    document.body.insertAdjacentHTML('beforeend', `<input id="city" list="cities"><datalist id="cities"><option value="Минск"></option><option value="Москва"></option></datalist>
      <nav><button id="menu-btn">Меню</button><div id="submenu" style="display:none"><a href="/a">Пункт А</a><a href="/b">Пункт Б</a></div></nav>`)
    document.getElementById('menu-btn')!.addEventListener('mouseenter', () => { document.getElementById('submenu')!.style.display = 'block' })
    const typed = await act({ kind: 'type', selector: '#city', text: 'М' })
    expect((typed.result as { options?: string[] }).options).toEqual(['Минск', 'Москва'])
    const hovered = await act({ kind: 'hover', selector: '#menu-btn' })
    expect((hovered.result as { revealed?: { text: string }[] }).revealed?.map((item) => item.text)).toEqual(['Пункт А', 'Пункт Б'])
    ;(document.getElementById('city') as HTMLInputElement).focus()
    const read = await act({ kind: 'read' })
    expect((read.result as { focus?: string }).focus).toBe('#city')
  })

  it('wait enabled/value ждёт состояние контрола в панели', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="save" disabled>Сохранить</button>`)
    setTimeout(() => { (document.getElementById('save') as HTMLButtonElement).disabled = false }, 150)
    const enabled = await act({ kind: 'wait', selector: '#save', enabled: true, timeoutMs: 2000 })
    expect(enabled.ok).toBe(true)
    setTimeout(() => { (document.getElementById('q') as HTMLInputElement).value = 'готово' }, 150)
    const value = await act({ kind: 'wait', selector: '#q', value: 'готово', timeoutMs: 2000 })
    expect(value.ok).toBe(true)
    const never = await act({ kind: 'wait', selector: '#q', value: 'иное', timeoutMs: 200 })
    expect(never.ok).toBe(false)
  }, 10_000)
})

describe('скрипт превью: читать как человек (круг 5)', () => {
  it('текст ищется без учёта кавычек, тире и неразрывных пробелов', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="quoted">Открыть «Корзину» — сейчас</button>`)
    const res = await act({ kind: 'find', text: 'Открыть "Корзину" - сейчас', exact: true })
    expect((res.result as { elements: { selector: string }[] }).elements).toEqual([expect.objectContaining({ selector: '#quoted' })])
  })

  it('read section читает раздел под заголовком до следующего заголовка того же уровня', async () => {
    document.body.insertAdjacentHTML('beforeend', `<h2>Цены</h2><p>Базовый — 10 €</p><ul><li>Про — 20 €</li></ul><h2>Контакты</h2><p>Пишите нам</p>`)
    const res = await act({ kind: 'read', section: 'цены' })
    expect(res.ok).toBe(true)
    const result = res.result as { section?: string; text: string }
    expect(result.section).toBe('Цены')
    expect(result.text).toContain('Базовый — 10 €')
    expect(result.text).toContain('Про — 20 €')
    expect(result.text).not.toContain('Пишите нам')
    const missing = await act({ kind: 'read', section: 'Нет такого' })
    expect(missing.ok).toBe(false)
  })

  it('read отдаёт выделенный пользователем текст, find onScreen фильтрует по экрану', async () => {
    const heading = document.querySelector('h1')!
    const range = document.createRange(); range.selectNodeContents(heading)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    const res = await act({ kind: 'read' })
    expect((res.result as { selection?: string }).selection).toBe('Группы товаров')
    selection.removeAllRanges()
    // jsdom не раскладывает элементы: на «экране» ничего нет, и фильтр должен это честно показать.
    const onScreen = await act({ kind: 'find', role: 'heading', onScreen: true })
    expect((onScreen.result as { total: number }).total).toBe(0)
  })

  it('type perKey печатает посимвольно с keydown на каждую букву', async () => {
    const input = document.getElementById('q') as HTMLInputElement
    const keys: string[] = []
    input.addEventListener('keydown', (event) => keys.push(event.key))
    const res = await act({ kind: 'type', selector: '#q', text: 'ab', perKey: true })
    expect(res.ok).toBe(true)
    expect(input.value).toBe('ab')
    expect(keys).toEqual(['a', 'b'])
    expect((res.result as { value: string }).value).toBe('ab')
  })

  it('click сообщает перекрывающий элемент, если в точке клика лежит оверлей', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button id="under">Под оверлеем</button><div id="overlay"></div>`)
    const original = document.elementFromPoint
    document.elementFromPoint = () => document.getElementById('overlay')
    try {
      const res = await act({ kind: 'click', selector: '#under' })
      expect(res.ok).toBe(true)
      expect((res.result as { obscuredBy?: string }).obscuredBy).toBe('#overlay')
    } finally { document.elementFromPoint = original }
  })
})

describe('скрипт превью: проверки тестировщика и вторые совпадения (круг 6)', () => {
  it('check отвечает pass/actual/summary для видимости, отсутствия, значения и количества', async () => {
    const visible = await act({ kind: 'check', text: 'Группы товаров' })
    expect(visible.result).toMatchObject({ pass: true, summary: '«Группы товаров» видно', actual: { count: 1 } })
    const absent = await act({ kind: 'check', text: 'Корзина пуста', state: 'absent' })
    expect(absent.result).toMatchObject({ pass: true, summary: '«Корзина пуста» отсутствует' })
    ;(document.getElementById('q') as HTMLInputElement).value = 'ноутбук'
    const value = await act({ kind: 'check', selector: '#q', value: 'Ноутбук' })
    expect(value.result).toMatchObject({ pass: true })
    const wrong = await act({ kind: 'check', selector: '#q', value: 'телефон' })
    expect(wrong.result).toMatchObject({ pass: false, summary: expect.stringContaining('ожидалось «телефон»') })
    const count = await act({ kind: 'check', selector: 'nav a', count: 3 })
    expect(count.result).toMatchObject({ pass: false, summary: 'nav a: 2 из 3 — не совпало', actual: { count: 2 } })
  })

  it('nth берёт N-е совпадение, scroll листает к тексту, errors since и network failedOnly фильтруют журналы', async () => {
    document.body.insertAdjacentHTML('beforeend', `<button class="twin">Удалить</button><button class="twin">Удалить</button>`)
    const twins = document.querySelectorAll('button.twin')
    let clicked: Element | null = null
    for (const button of twins) button.addEventListener('click', () => { clicked = button })
    const second = await act({ kind: 'click', text: 'Удалить', exact: true, nth: 2 })
    expect(second.ok).toBe(true)
    expect(clicked).toBe(twins[1])
    const missing = await act({ kind: 'click', text: 'Удалить', exact: true, nth: 5 })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('№5')
    const heading = document.querySelector('h1') as HTMLElement
    let shown = false
    heading.scrollIntoView = () => { shown = true }
    const scrolled = await act({ kind: 'scroll', to: 'element', text: 'Группы товаров' })
    expect(scrolled.ok).toBe(true)
    expect(shown).toBe(true)
    console.error('старая ошибка')
    const before = await act({ kind: 'errors' })
    const at = (before.result as { errors: { at: number }[] }).errors.at(-1)!.at
    await new Promise((resolve) => setTimeout(resolve, 5))
    console.error('новая ошибка')
    const fresh = await act({ kind: 'errors', since: at })
    expect((fresh.result as { errors: { message: string }[] }).errors.map((e) => e.message)).toEqual(['новая ошибка'])
    const failed = await act({ kind: 'network', failedOnly: true })
    expect(failed.ok).toBe(true)
  })

  it('page несёт язык, описание и иконку сайта', async () => {
    document.documentElement.setAttribute('lang', 'ru')
    document.head.insertAdjacentHTML('beforeend', `<meta name="description" content="Магазин электроники"><link rel="icon" href="/favicon.ico">`)
    const res = await act({ kind: 'read', limit: 100 })
    expect((res.result as { page: { lang?: string; description?: string; icon?: string } }).page).toMatchObject({ lang: 'ru', description: 'Магазин электроники', icon: expect.stringContaining('/favicon.ico') })
  })
})

describe('скрипт превью: показать пользователю и читать окно (круг 7)', () => {
  it('show подсвечивает элемент с подписью и не нажимает его', async () => {
    const link = document.querySelector('nav a') as HTMLAnchorElement
    let clicked = false
    link.addEventListener('click', () => { clicked = true })
    const res = await act({ kind: 'show', text: 'Электроника', label: 'Вот ссылка' })
    expect(res.ok).toBe(true)
    expect((res.result as { shown: { tag: string } }).shown.tag).toBe('a')
    expect(link.getAttribute('data-voicechat-flash')).toBe('show')
    expect([...document.querySelectorAll('[data-voicechat-inspector="show-label"]')].map((el) => el.textContent)).toEqual(['Вот ссылка'])
    expect(clicked).toBe(false)
  })

  it('read читает открытое модальное окно и даёт краткое описание; press сообщает оставшиеся окна', async () => {
    document.body.insertAdjacentHTML('beforeend', `<div id="modal" role="dialog"><h2>Подтвердите</h2><p>Удалить заказ?</p><button>Да</button></div>`)
    const res = await act({ kind: 'read', brief: true })
    const result = res.result as { dialog?: string; brief?: string; headings: { text: string }[] }
    expect(result.dialog).toBe('#modal')
    expect(result.headings).toEqual([{ level: 2, text: 'Подтвердите' }])
    expect(result.brief).toContain('открыто окно')
    expect(result.brief).toContain('Магазин')
    const pressed = await act({ kind: 'press', key: 'Escape' })
    expect((pressed.result as { dialogs?: string[] }).dialogs).toEqual(['#modal'])
    document.getElementById('modal')!.remove()
    const after = await act({ kind: 'press', key: 'Escape' })
    expect((after.result as { dialogs?: string[] }).dialogs).toBeUndefined()
  })

  it('wait idle отвечает сразу при тихой сети, scroll к элементу описывает его', async () => {
    const idle = await act({ kind: 'wait', idle: true, timeoutMs: 1000 })
    expect(idle.ok).toBe(true)
    expect(idle.result).toMatchObject({ state: 'idle' })
    const heading = document.querySelector('h1') as HTMLElement
    heading.scrollIntoView = () => {}
    const scrolled = await act({ kind: 'scroll', to: 'element', selector: 'h1' })
    expect((scrolled.result as { element?: { text: string } }).element).toMatchObject({ text: 'Группы товаров' })
  })
})

describe('скрипт превью: терпимый поиск и заполнение (круг 8)', () => {
  it('find без результата предлагает похожие тексты; role понимает русские слова', async () => {
    const none = await act({ kind: 'find', text: 'Электронка' })
    expect((none.result as { total: number; suggestions?: string[] }).total).toBe(0)
    expect((none.result as { suggestions?: string[] }).suggestions).toContain('Электроника')
    const buttons = await act({ kind: 'find', role: 'кнопка' })
    expect((buttons.result as { elements: { text: string }[] }).elements.map((el) => el.text)).toEqual(['Найти'])
  })

  it('fill заполняет найденные поля и перечисляет пропущенные; неоднозначный клик называет контексты', async () => {
    const res = await act({ kind: 'fill', fields: [{ selector: '#q', value: 'книги' }, { field: 'Фамилия', value: 'Иванов' }] })
    expect(res.ok).toBe(true)
    expect((res.result as { filled: unknown[]; missing?: { field: string }[] })).toMatchObject({ filled: [expect.objectContaining({ selector: '#q' })], missing: [expect.objectContaining({ field: 'Фамилия' })] })
    const nothing = await act({ kind: 'fill', fields: [{ field: 'Нет такого', value: 'x' }] })
    expect(nothing.ok).toBe(false)
    document.body.insertAdjacentHTML('beforeend', `<ul><li>Заказ 1 <button>Удалить</button></li><li>Заказ 2 <button>Удалить</button></li></ul>`)
    const ambiguous = await act({ kind: 'click', text: 'Удалить', exact: true })
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.error).toContain('Заказ 1')
    expect(ambiguous.error).toContain('near')
  })

  it('errors схлопывает повторы, read перечисляет варианты select, клик по select объясняет set', async () => {
    console.error('дубль'); console.error('дубль'); console.error('другое')
    const errors = await act({ kind: 'errors', clear: true })
    const list = (errors.result as { errors: { message: string; count?: number }[]; total: number }).errors
    expect(list.find((e) => e.message === 'дубль')?.count).toBe(2)
    expect(list.find((e) => e.message === 'другое')?.count).toBeUndefined()
    document.body.insertAdjacentHTML('beforeend', `<select id="lang"><option>Русский</option><option>English</option></select>`)
    const read = await act({ kind: 'read' })
    const select = (read.result as { inputs: { selector: string; options?: string[] }[] }).inputs.find((input) => input.selector === '#lang')
    expect(select?.options).toEqual(['Русский', 'English'])
    const click = await act({ kind: 'click', selector: '#lang' })
    expect(click.ok).toBe(false)
    expect(click.error).toContain('set')
  })
})

describe('скрипт превью: рутина одним вызовом (круг 9)', () => {
  it('click по точке, read parts, check contains, scroll на экран, back на несколько шагов, network since', async () => {
    const button = document.querySelector('form button') as HTMLButtonElement
    let clicked = false
    button.addEventListener('click', () => { clicked = true })
    const original = document.elementFromPoint
    document.elementFromPoint = () => button
    try {
      const point = await act({ kind: 'click', x: 10, y: 10 })
      expect(point.ok).toBe(true)
      expect(clicked).toBe(true)
    } finally { document.elementFromPoint = original }
    const partial = await act({ kind: 'read', parts: ['headings'] })
    const result = partial.result as { headings: unknown[]; links: unknown[]; text: string }
    expect(result.headings.length).toBe(3)
    expect(result.links).toEqual([])
    expect(result.text).toBe('')
    const contains = await act({ kind: 'check', text: 'Группы товаров', contains: 'товар' })
    expect(contains.result).toMatchObject({ pass: true })
    const main = document.querySelector('main') as HTMLElement
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 3000 })
    Object.defineProperty(main, 'clientHeight', { configurable: true, value: 500 })
    const page = await act({ kind: 'scroll', selector: 'main', to: 'nextPage' })
    expect((page.result as { scrolled: { top: number } }).scrolled.top).toBe(450)
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const back = await act({ kind: 'back', steps: 2 })
    expect(back.ok).toBe(true)
    expect(go).toHaveBeenCalledWith(-2)
    go.mockRestore()
    const network = await act({ kind: 'network', since: 0 })
    expect(network.ok).toBe(true)
  })
})

describe('скрипт превью: таблицы, ссылки по адресу и русские клавиши (круг 10)', () => {
  it('find по href находит ссылку по адресу; errors kinds фильтрует вид; hover с waitMs ждёт меню', async () => {
    const byHref = await act({ kind: 'find', href: '/books' })
    expect((byHref.result as { elements: { text: string }[] }).elements.map((el) => el.text)).toEqual(['Книги'])
    console.error('только консоль')
    const kinds = await act({ kind: 'errors', kinds: ['network'], clear: true })
    expect((kinds.result as { errors: unknown[] }).errors).toEqual([])
    document.body.insertAdjacentHTML('beforeend', `<button id="slow-menu">Ещё</button><div id="slow-items" style="display:none"><a href="/x">Позже</a></div>`)
    document.getElementById('slow-menu')!.addEventListener('mouseenter', () => { setTimeout(() => { document.getElementById('slow-items')!.style.display = 'block' }, 100) })
    const hovered = await act({ kind: 'hover', selector: '#slow-menu', waitMs: 400 })
    expect((hovered.result as { revealed?: { text: string }[] }).revealed?.map((el) => el.text)).toEqual(['Позже'])
  })

  it('read перечисляет таблицы построчно, press понимает русские названия клавиш', async () => {
    document.body.insertAdjacentHTML('beforeend', `<table id="orders"><caption>Заказы</caption><tr><th>№</th><th>Сумма</th></tr><tr><td>1</td><td>100 ₽</td></tr><tr><td>2</td><td>250 ₽</td></tr></table>`)
    const res = await act({ kind: 'read', parts: ['tables'] })
    const tables = (res.result as { tables?: { selector: string; caption?: string; headers: string[]; rows: string[][]; totalRows: number }[] }).tables
    expect(tables).toEqual([{ selector: '#orders', caption: 'Заказы', headers: ['№', 'Сумма'], rows: [['1', '100 ₽'], ['2', '250 ₽']], totalRows: 2 }])
    const input = document.getElementById('q') as HTMLInputElement
    const keys: string[] = []
    input.addEventListener('keydown', (event) => keys.push(event.key))
    const pressed = await act({ kind: 'press', key: 'Ввод', selector: '#q' })
    expect(pressed.ok).toBe(true)
    expect(keys).toEqual(['Enter'])
  })
})

describe('скрипт превью: что изменилось (круг 11)', () => {
  it('changes запоминает состояние и показывает появившееся и исчезнувшее; click сообщает changes', async () => {
    // Снимок живёт в общем скрипте: предыдущие тесты уже читали страницу, поэтому baseline не гарантирован.
    const first = await act({ kind: 'changes' })
    expect(first.ok).toBe(true)
    document.body.insertAdjacentHTML('beforeend', `<p id="fresh">Новый абзац</p>`)
    // «Электроника» есть и в навигации, и в заголовке — снимок хранит тексты, поэтому убираем уникальный h1.
    document.querySelector('h1')!.remove()
    const diff = await act({ kind: 'changes' })
    const changes = (diff.result as { changes: { added: string[]; removed: string[] } }).changes
    expect(changes.added).toContain('Новый абзац')
    expect(changes.removed).toContain('Группы товаров')
    document.body.insertAdjacentHTML('beforeend', `<button id="reveal">Показать</button><p id="hidden-note" style="display:none">Секретная заметка</p>`)
    document.getElementById('reveal')!.addEventListener('click', () => { document.getElementById('hidden-note')!.style.display = 'block' })
    const clicked = await act({ kind: 'click', selector: '#reveal' })
    expect((clicked.result as { changes?: { added: string[] } }).changes?.added).toContain('Секретная заметка')
  })

  it('wait changed ждёт изменения текста; read сообщает прокрутку; choose на select выбирает option', async () => {
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', `<p>Появилось позже</p>`), 200)
    const waited = await act({ kind: 'wait', changed: true, timeoutMs: 2000 })
    expect(waited.ok).toBe(true)
    expect(waited.result).toMatchObject({ state: 'changed' })
    const read = await act({ kind: 'read', parts: ['headings'] })
    expect((read.result as { scroll: { percent: number } }).scroll).toMatchObject({ top: 0, percent: 100 })
    document.body.insertAdjacentHTML('beforeend', `<select id="lang"><option>Русский</option><option>English</option></select>`)
    const chosen = await act({ kind: 'choose', text: 'English', in: '#lang' })
    expect(chosen.ok).toBe(true)
    expect((document.getElementById('lang') as HTMLSelectElement).value).toBe('English')
  }, 10_000)
})

describe('скрипт превью: screenshot', () => {
  it('screenshot без canvas (jsdom) отвечает асинхронной понятной ошибкой, а не молчит', async () => {
    const res = await act({ kind: 'screenshot', selector: 'main' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Canvas')
  })

  it('screenshot по отсутствующему селектору — ошибка поиска', async () => {
    const res = await act({ kind: 'screenshot', selector: '#no-such' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('не найден')
  })
})

describe('скрипт превью: errors, wait, back, edits', () => {
  it('errors копит console.error, исключения и unhandledrejection; clear очищает', async () => {
    console.error('первая ошибка приложения')
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught boom' }))
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown }
    rejection.reason = new Error('promise upal')
    window.dispatchEvent(rejection)
    const res = await act({ kind: 'errors', clear: true })
    expect(res.ok).toBe(true)
    const list = res.result as { errors: Array<{ kind: string; message: string; at: number }>; total: number }
    expect(list.total).toBeGreaterThanOrEqual(3)
    expect(list.errors.some((e) => e.kind === 'console.error' && e.message.includes('первая ошибка'))).toBe(true)
    expect(list.errors.some((e) => e.kind === 'error' && e.message.includes('boom'))).toBe(true)
    expect(list.errors.some((e) => e.kind === 'unhandledrejection' && e.message.includes('promise upal'))).toBe(true)
    const cleared = await act({ kind: 'errors' })
    expect((cleared.result as { total: number }).total).toBe(0)
  })

  it('wait дожидается элемента, появившегося позже, и падает по таймауту', async () => {
    setTimeout(() => {
      const late = document.createElement('p')
      late.id = 'late-element'
      late.textContent = 'появился'
      document.body.append(late)
    }, 200)
    const found = await act({ kind: 'wait', selector: '#late-element', timeoutMs: 3000 })
    expect(found.ok).toBe(true)
    const result = found.result as { found: { selector: string }; waitedMs: number }
    expect(result.found.selector).toBe('#late-element')
    expect(result.waitedMs).toBeGreaterThanOrEqual(100)
    const missing = await act({ kind: 'wait', selector: '#never', timeoutMs: 300 })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('не появился')
  }, 10_000)

  it('back отвечает сразу и инициирует переход по истории', async () => {
    const res = await act({ kind: 'back' })
    expect(res.ok).toBe(true)
    expect((res.result as { navigating: boolean }).navigating).toBe(true)
  })

  it('edits возвращает сохранённые правки страницы', async () => {
    // Ключ строится от unproxy(location) — соседние pushState-тесты меняли адрес.
    const real = (() => {
      const current = new URL(window.location.href)
      const target = current.searchParams.get('url')
      return current.pathname === '/api/preview' && target ? new URL(target) : current
    })()
    const key = 'voicechat.preview.edits.v1:' + real.origin + real.pathname
    localStorage.setItem(key, JSON.stringify({
      '#q': { original: { cssText: '', text: null }, style: { fontWeight: '700' }, text: 'Новый текст' },
      '#gone': { original: { cssText: '', text: null }, deleted: true }
    }))
    const res = await act({ kind: 'edits' })
    expect(res.ok).toBe(true)
    const list = (res.result as { edits: Array<{ selector: string; style?: Record<string, string>; text?: string; deleted?: boolean }> }).edits
    expect(list).toContainEqual({ selector: '#q', style: { fontWeight: '700' }, text: 'Новый текст' })
    expect(list).toContainEqual({ selector: '#gone', deleted: true })
    localStorage.removeItem(key)
  })
})
