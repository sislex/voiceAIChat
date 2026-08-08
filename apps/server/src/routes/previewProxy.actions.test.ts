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
import { previewInspectorScript } from './previewProxy.js'

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
