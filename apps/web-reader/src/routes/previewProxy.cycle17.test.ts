// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Круг 17: поиск по самому сайту, ориентиры страницы (крошки, листалка, дата),
// чтение только основного, курсор и выделение — то, чем человек пользуется,
// попав на большой незнакомый сайт.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, type PreviewActionResultMessage, type PreviewDomAction, type PreviewFocusResult, type PreviewReadResult, type PreviewSearchResult, type PreviewSelectResult } from '@voicechat/shared'
import { previewInspectorScript } from './previewProxy.js'

let counter = 0
function act(action: PreviewDomAction): Promise<PreviewActionResultMessage> {
  const requestId = `c17-${++counter}`
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

beforeAll(() => {
  const body = previewInspectorScript().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
})
beforeEach(() => { document.head.querySelectorAll('meta').forEach(node => node.remove()) })

describe('круг 17: поиск по самому сайту', () => {
  it('находит поле поиска формы, вводит запрос и отправляет форму', async () => {
    document.body.innerHTML = `
      <form role="search" id="site-search"><label>Поиск по сайту<input name="q"></label><button type="submit">Найти</button></form>
      <form id="login"><input name="user"></form>`
    let submitted = ''
    document.getElementById('site-search')!.addEventListener('submit', event => { event.preventDefault(); submitted = (event.target as HTMLFormElement).querySelector('input')!.value })
    const res = (await act({ kind: 'search', text: 'наушники' })).result as PreviewSearchResult
    expect(res).toMatchObject({ query: 'наушники', submitted: true })
    expect(res.field.selector).toContain('input')
    expect(submitted).toBe('наушники')
  })
  it('узнаёт поле по типу, подписи и placeholder, отдаёт подсказки сайта', async () => {
    document.body.innerHTML = `
      <input type="search" id="find" aria-controls="hints" placeholder="Найти товар">
      <ul id="hints" role="listbox"><li role="option">наушники беспроводные</li><li role="option">наушники с микрофоном</li></ul>`
    const res = (await act({ kind: 'search', text: 'наушники' })).result as PreviewSearchResult
    expect(res.field.selector).toBe('#find')
    expect(res.suggestions).toEqual(['наушники беспроводные', 'наушники с микрофоном'])
  })
  it('без поля поиска объясняет, что делать дальше', async () => {
    document.body.innerHTML = '<p>Ничего не найти</p>'
    const res = await act({ kind: 'search', text: 'что-нибудь' })
    expect(res.ok).toBe(false)
    expect(String(res.error)).toContain('нет поля поиска')
  })
  it('in ограничивает область поиска поля', async () => {
    document.body.innerHTML = `<header><input type="search" id="top"></header><aside id="side"><input type="search" id="in-side"></aside>`
    const res = (await act({ kind: 'search', text: 'x', in: '#side' })).result as PreviewSearchResult
    expect(res.field.selector).toBe('#in-side')
  })
})

describe('круг 17: ориентиры страницы в read', () => {
  it('крошки, листалка, дата с автором и поле поиска приходят вместе со страницей', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta property="article:published_time" content="2026-09-01"><meta name="author" content="Редакция">')
    document.body.innerHTML = `
      <nav aria-label="Хлебные крошки"><ol><li><a href="/">Главная</a></li><li><a href="/news">Новости</a></li><li>Статья</li></ol></nav>
      <input type="search" id="q">
      <article><h1>Статья</h1><p>Текст статьи</p></article>
      <a href="/news?page=3" rel="next">Дальше</a><a href="/news?page=1" rel="prev">Назад</a>`
    const page = (await act({ kind: 'read' })).result as PreviewReadResult
    expect(page.breadcrumbs).toEqual([{ text: 'Главная', href: expect.stringContaining('/') }, { text: 'Новости', href: expect.stringContaining('/news') }, { text: 'Статья' }])
    expect(page.pagination).toMatchObject({ next: expect.stringContaining('page=3'), prev: expect.stringContaining('page=1') })
    expect(page.published).toEqual({ date: '2026-09-01', author: 'Редакция' })
    expect(page.search).toBe('#q')
  })
  it('листалка узнаётся по словам человека, когда rel нет', async () => {
    document.body.innerHTML = `<a href="/p2">Следующая страница</a><a href="/p0">Предыдущая</a><span aria-current="page">2</span>`
    const page = (await act({ kind: 'read' })).result as PreviewReadResult
    expect(page.pagination).toMatchObject({ next: expect.stringContaining('/p2'), prev: expect.stringContaining('/p0'), label: '2' })
  })
  it('read {main} читает статью без меню и подвала', async () => {
    document.body.innerHTML = `
      <nav><a href="/a">Раздел A</a><a href="/b">Раздел B</a></nav>
      <main><h1>Заголовок</h1><p>Основной текст страницы.</p></main>
      <footer>Подвал сайта</footer>`
    const main = (await act({ kind: 'read', main: true })).result as PreviewReadResult
    expect(main.text).toContain('Основной текст')
    expect(main.text).not.toContain('Подвал сайта')
    expect(main.links).toEqual([])
    expect(main.main).toBe('main')
    const whole = (await act({ kind: 'read' })).result as PreviewReadResult
    expect(whole.text).toContain('Подвал сайта')
  })
  it('без main и article берёт самый текстовый блок, а не список ссылок', async () => {
    document.body.innerHTML = `
      <div id="menu">${Array.from({ length: 20 }, (_, i) => `<a href="/l${i}">Ссылка ${i} длинная подпись пункта меню</a>`).join('')}</div>
      <div id="story"><p>${'Живой текст статьи. '.repeat(20)}</p></div>`
    const main = (await act({ kind: 'read', main: true })).result as PreviewReadResult
    expect(main.main).toBe('#story')
    expect(main.text).toContain('Живой текст статьи')
  })
})

describe('круг 17: курсор, выделение и ожидание покоя', () => {
  it('focus ставит курсор в поле по подписи и не вводит текст', async () => {
    document.body.innerHTML = '<label>Комментарий<textarea id="c"></textarea></label>'
    const res = (await act({ kind: 'focus', field: 'Комментарий' })).result as PreviewFocusResult
    expect(res.focused.selector).toBe('#c')
    expect(document.activeElement).toBe(document.getElementById('c'))
    expect((document.getElementById('c') as HTMLTextAreaElement).value).toBe('')
  })
  it('focus отказывается от отключённого поля', async () => {
    document.body.innerHTML = '<label>Промокод<input id="p" disabled></label>'
    const res = await act({ kind: 'focus', field: 'Промокод' })
    expect(res.ok).toBe(false)
    expect(String(res.error)).toContain('отключён')
  })
  it('select выделяет место на странице, и его видно как выделение пользователя', async () => {
    document.body.innerHTML = '<p id="a">Первый абзац</p><p id="b">Важное условие договора</p>'
    const res = (await act({ kind: 'select', text: 'Важное условие' })).result as PreviewSelectResult
    expect(res.selected).toContain('Важное условие договора')
    expect(res.target.selector).toBe('#b')
    expect(String(getSelection())).toContain('Важное условие')
  })
  it('wait {stable} ждёт, пока страница перестанет меняться', async () => {
    document.body.innerHTML = '<div id="live">0</div>'
    const live = document.getElementById('live')!
    let ticks = 0
    const timer = setInterval(() => { live.textContent = String(++ticks); if (ticks >= 3) clearInterval(timer) }, 100)
    const res = await act({ kind: 'wait', stable: true, timeoutMs: 4000 })
    clearInterval(timer)
    expect(res.ok).toBe(true)
    expect((res.result as { state?: string }).state).toBe('stable')
    expect(ticks).toBeGreaterThanOrEqual(3)
  })
})
