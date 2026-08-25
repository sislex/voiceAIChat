// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Новые DOM-действия скрипта превью: журналы network/console, evaluate, drag,
// set, upload, forward, a11y и расширенный click (dblclick, правый, модификаторы).
// jsdom заменяет iframe (parent === window); canvas, DataTransfer и layout в
// jsdom не работают — их ветки проверяются на протокол и понятные ошибки.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  PREVIEW_ACTION_COMMAND_TYPE,
  PREVIEW_ACTION_RESULT_TYPE,
  type PreviewActionResultMessage,
  type PreviewDomAction
} from '@voicechat/shared'
import { previewInspectorScript } from './previewProxy.js'

let counter = 0

function act(action: PreviewDomAction): Promise<PreviewActionResultMessage> {
  const requestId = `n${++counter}`
  return new Promise((resolve) => {
    const listener = (event: MessageEvent): void => {
      const data = event.data as PreviewActionResultMessage | undefined
      if (!data || data.type !== PREVIEW_ACTION_RESULT_TYPE || data.requestId !== requestId) return
      window.removeEventListener('message', listener)
      resolve(data)
    }
    window.addEventListener('message', listener)
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
  document.title = 'Стенд'
  document.body.innerHTML = `
    <main>
      <h1>Формы</h1>
      <button id="target">Кнопка</button>
      <div id="card" class="card">Карточка</div>
      <div id="column" class="column">Колонка</div>
      <form>
        <label for="lang">Язык</label>
        <select id="lang"><option value="">—</option><option value="ru">Русский</option><option value="en">English</option></select>
        <input type="checkbox" id="agree">
        <input type="text" id="name" placeholder="Имя">
        <input type="file" id="attach">
      </form>
      <nav aria-label="Меню"><a href="/api/preview?url=${encodeURIComponent('https://site.example/docs')}">Документация</a></nav>
    </main>`
})

describe('console: журнал уровней с фильтрами', () => {
  it('копит log/info/warn/error и фильтрует по pattern и level', async () => {
    await act({ kind: 'console', clear: true })
    console.log('[App] started')
    console.warn('[App] slow render')
    console.info('other message')
    const all = await act({ kind: 'console' })
    expect(all.ok).toBe(true)
    const allResult = all.result as { messages: { level: string; message: string }[]; total: number }
    expect(allResult.total).toBeGreaterThanOrEqual(3)
    const filtered = await act({ kind: 'console', pattern: '[app]', level: 'warn' })
    const filteredResult = filtered.result as { messages: { level: string; message: string }[]; total: number }
    expect(filteredResult.total).toBe(1)
    expect(filteredResult.messages[0]).toMatchObject({ level: 'warn', message: '[App] slow render' })
    const cleared = await act({ kind: 'console', clear: true })
    expect(cleared.ok).toBe(true)
    const after = await act({ kind: 'console' })
    expect((after.result as { total: number }).total).toBe(0)
  })

  it('console.error попадает и в журнал консоли, и в буфер ошибок', async () => {
    await act({ kind: 'console', clear: true })
    await act({ kind: 'errors', clear: true })
    console.error('boom')
    const consoleLog = await act({ kind: 'console', level: 'error' })
    expect((consoleLog.result as { total: number }).total).toBe(1)
    const errors = await act({ kind: 'errors' })
    const errorsResult = errors.result as { errors: { kind: string; message: string }[] }
    expect(errorsResult.errors.some((e) => e.kind === 'console.error' && e.message === 'boom')).toBe(true)
  })
})

describe('network: журнал запросов', () => {
  it('XHR попадает в журнал с методом и реальным URL, filter сужает выдачу', async () => {
    await act({ kind: 'network', clear: true })
    const xhr = new XMLHttpRequest()
    xhr.open('GET', '/api/preview?url=' + encodeURIComponent('https://site.example/api/list'))
    try { xhr.send() } catch { /* jsdom без сети */ }
    const log = await act({ kind: 'network' })
    expect(log.ok).toBe(true)
    const logResult = log.result as { requests: { via: string; method: string; url: string }[]; total: number }
    expect(logResult.total).toBeGreaterThanOrEqual(1)
    const entry = logResult.requests.find((r) => r.url.includes('site.example'))
    expect(entry).toMatchObject({ via: 'xhr', method: 'GET', url: 'https://site.example/api/list' })
    const miss = await act({ kind: 'network', filter: 'nomatch.example' })
    expect((miss.result as { total: number }).total).toBe(0)
  })
})

describe('evaluate: JS в контексте страницы', () => {
  it('возвращает JSON результата, включая промисы', async () => {
    const sum = await act({ kind: 'evaluate', code: '2 + 2' })
    expect(sum.ok).toBe(true)
    expect((sum.result as { value: string }).value).toBe('4')
    const dom = await act({ kind: 'evaluate', code: 'document.querySelectorAll("option").length' })
    expect((dom.result as { value: string }).value).toBe('3')
    const promised = await act({ kind: 'evaluate', code: 'Promise.resolve({ ok: true })' })
    expect((promised.result as { value: string }).value).toBe('{"ok":true}')
  })

  it('ошибка кода возвращается ошибкой действия', async () => {
    const broken = await act({ kind: 'evaluate', code: 'nosuchfn()' })
    expect(broken.ok).toBe(false)
    expect(broken.error).toContain('nosuchfn')
  })
})

describe('click: dblclick, правая кнопка, модификаторы', () => {
  it('dblclick диспатчит пару click и dblclick', async () => {
    const seen: string[] = []
    const el = document.getElementById('target')!
    for (const type of ['click', 'dblclick', 'contextmenu']) el.addEventListener(type, () => seen.push(type))
    const result = await act({ kind: 'click', selector: '#target', dblclick: true })
    expect(result.ok).toBe(true)
    expect(seen.filter((t) => t === 'click').length).toBe(2)
    expect(seen).toContain('dblclick')
  })

  it('правый клик диспатчит contextmenu, а не click', async () => {
    const seen: string[] = []
    const el = document.getElementById('target')!
    for (const type of ['click', 'contextmenu']) el.addEventListener(type, () => seen.push(type))
    const result = await act({ kind: 'click', selector: '#target', button: 'right' })
    expect(result.ok).toBe(true)
    expect(seen).toEqual(['contextmenu'])
  })

  it('модификаторы приходят в событии клика', async () => {
    let event: MouseEvent | null = null
    document.getElementById('target')!.addEventListener('click', (e) => { event = e })
    await act({ kind: 'click', selector: '#target', modifiers: ['shift', 'meta'] })
    expect(event).not.toBeNull()
    expect(event!.shiftKey).toBe(true)
    expect(event!.metaKey).toBe(true)
    expect(event!.ctrlKey).toBe(false)
  })
})

describe('drag: pointer-механика', () => {
  it('шлёт pointerdown → pointermove → pointerup и возвращает via pointer', async () => {
    const seen: string[] = []
    document.getElementById('card')!.addEventListener('pointerdown', () => seen.push('down'))
    // jsdom без layout: move/up уходят в document.body (elementFromPoint недоступен).
    document.body.addEventListener('pointermove', () => seen.push('move'))
    document.body.addEventListener('pointerup', () => seen.push('up'))
    const result = await act({ kind: 'drag', from: { selector: '#card' }, to: { x: 200, y: 300 } })
    expect(result.ok).toBe(true)
    const dragResult = result.result as { via: string; dragged: { selector: string }; to: { x: number; y: number } }
    expect(dragResult.via).toBe('pointer')
    expect(dragResult.to).toEqual({ x: 200, y: 300 })
    expect(seen[0]).toBe('down')
    expect(seen.filter((t) => t === 'move').length).toBeGreaterThanOrEqual(4)
    expect(seen[seen.length - 1]).toBe('up')
  })

  it('источник по несуществующему селектору — понятная ошибка', async () => {
    const result = await act({ kind: 'drag', from: { selector: '#nope' }, to: { x: 1, y: 1 } })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('не найден')
  })
})

describe('set: сложные контролы форм', () => {
  it('select по value и по подписи option, с событиями input/change', async () => {
    const seen: string[] = []
    const select = document.getElementById('lang')!
    select.addEventListener('input', () => seen.push('input'))
    select.addEventListener('change', () => seen.push('change'))
    const byValue = await act({ kind: 'set', selector: '#lang', value: 'en' })
    expect((byValue.result as { value: string }).value).toBe('en')
    const byLabel = await act({ kind: 'set', selector: '#lang', value: 'Русский' })
    expect((byLabel.result as { value: string }).value).toBe('ru')
    expect(seen).toEqual(['input', 'change', 'input', 'change'])
    const missing = await act({ kind: 'set', selector: '#lang', value: 'Deutsch' })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('Опция не найдена')
  })

  it('checkbox переключается кликом до нужного состояния и идемпотентен', async () => {
    const on = await act({ kind: 'set', selector: '#agree', checked: true })
    expect((on.result as { value: string }).value).toBe('true')
    const again = await act({ kind: 'set', selector: '#agree', checked: true })
    expect((again.result as { value: string }).value).toBe('true')
    const off = await act({ kind: 'set', selector: '#agree', checked: false })
    expect((off.result as { value: string }).value).toBe('false')
  })

  it('set на не-контрол — понятная ошибка', async () => {
    const result = await act({ kind: 'set', selector: '#card', value: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('не является контролом')
  })
})

describe('upload: input type=file', () => {
  it('не-file элемент — понятная ошибка', async () => {
    const result = await act({ kind: 'upload', selector: '#name', name: 'a.txt', base64: 'aGk=' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('input type=file')
  })

  it('в jsdom без DataTransfer возвращает понятную ошибку (в браузере ставит files)', async () => {
    const result = await act({ kind: 'upload', selector: '#attach', name: 'a.txt', mimeType: 'text/plain', base64: 'aGk=' })
    if (typeof DataTransfer === 'function') {
      expect(result.ok).toBe(true)
      expect((result.result as { uploaded: { name: string; size: number } }).uploaded).toMatchObject({ name: 'a.txt', size: 2 })
    } else {
      expect(result.ok).toBe(false)
      expect(result.error).toContain('не поддерживает')
    }
  })
})

describe('forward: вперёд по истории', () => {
  it('отвечает navigating и не падает без записей истории', async () => {
    const result = await act({ kind: 'forward' })
    expect(result.ok).toBe(true)
    expect((result.result as { navigating: boolean }).navigating).toBe(true)
  })
})

describe('a11y: дерево доступности', () => {
  it('возвращает роли, имена и вложенность', async () => {
    const result = await act({ kind: 'a11y' })
    expect(result.ok).toBe(true)
    const a11y = result.result as { nodes: { role: string; name: string; level: number }[]; total: number }
    const roles = a11y.nodes.map((n) => `${n.role}:${n.name}`)
    expect(roles).toContain('heading:Формы')
    expect(roles).toContain('button:Кнопка')
    expect(roles).toContain('combobox:Язык')
    expect(roles).toContain('checkbox:')
    expect(roles).toContain('textbox:Имя')
    expect(roles).toContain('navigation:Меню')
    expect(roles).toContain('link:Документация')
    // Ссылка вложена в nav — уровень глубже.
    const nav = a11y.nodes.find((n) => n.role === 'navigation')!
    const link = a11y.nodes.find((n) => n.role === 'link')!
    expect(link.level).toBeGreaterThan(nav.level)
  })

  it('limit обрезает выдачу, total считает всё', async () => {
    const result = await act({ kind: 'a11y', limit: 2 })
    const a11y = result.result as { nodes: unknown[]; total: number }
    expect(a11y.nodes.length).toBe(2)
    expect(a11y.total).toBeGreaterThan(2)
  })
})
