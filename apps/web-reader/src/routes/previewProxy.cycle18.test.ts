// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Круг 18: длинные страницы, списки и таблицы — как человек ищет в них нужное.

import { beforeAll, describe, expect, it } from 'vitest'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, type PreviewActionResultMessage, type PreviewDomAction, type PreviewFindResult, type PreviewReadResult, type PreviewScrollResult } from '@voicechat/shared'
import { previewInspectorScript } from './previewProxy.js'

let counter = 0
function act(action: PreviewDomAction): Promise<PreviewActionResultMessage> {
  const requestId = `c18-${++counter}`
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

describe('круг 18: чтение длинного текста по частям', () => {
  it('read {next} продолжает с места, где остановился прошлый read, и не уходит за конец', async () => {
    document.body.innerHTML = `<p>${'Абзац текста. '.repeat(600)}</p>`
    const first = (await act({ kind: 'read', limit: 500 })).result as PreviewReadResult
    expect(first.text.length).toBe(500)
    expect(first.nextOffset).toBe(500)
    const second = (await act({ kind: 'read', next: true, limit: 500 })).result as PreviewReadResult
    expect(second.offset).toBe(500)
    expect(second.text).not.toBe(first.text)
    for (let page = 0; page < 30; page++) await act({ kind: 'read', next: true, limit: 500 })
    const tail = (await act({ kind: 'read', next: true, limit: 500 })).result as PreviewReadResult
    expect(tail.text.length).toBeGreaterThan(0)
    expect(tail.offset).toBeLessThan(tail.total!)
  })
  it('read {toc} отдаёт оглавление с уровнями и селекторами для перехода', async () => {
    document.body.innerHTML = '<h1 id="t">Инструкция</h1><h2 id="a">Доставка</h2><p>x</p><h2 id="b">Оплата</h2><h3 id="c">Картой</h3>'
    const page = (await act({ kind: 'read', toc: true })).result as PreviewReadResult
    expect(page.toc).toEqual([
      { level: 1, text: 'Инструкция', selector: '#t' },
      { level: 2, text: 'Доставка', selector: '#a' },
      { level: 2, text: 'Оплата', selector: '#b' },
      { level: 3, text: 'Картой', selector: '#c' }
    ])
  })
})

describe('круг 18: списки и таблицы', () => {
  it('read.lists показывает однотипные карточки и их число', async () => {
    document.body.innerHTML = `<ul id="goods">${Array.from({ length: 12 }, (_, i) => `<li>Товар ${i + 1}</li>`).join('')}</ul><ul id="two"><li>Раз</li><li>Два</li></ul>`
    const page = (await act({ kind: 'read' })).result as PreviewReadResult
    expect(page.lists).toEqual([{ selector: '#goods', count: 12, items: ['Товар 1', 'Товар 2', 'Товар 3', 'Товар 4', 'Товар 5'] }])
  })
  it('read {table} читает одну таблицу постранично и говорит, где продолжить', async () => {
    document.body.innerHTML = `
      <table id="prices"><caption>Цены на тарифы</caption><tr><th>Тариф</th><th>Цена</th></tr>
      ${Array.from({ length: 25 }, (_, i) => `<tr><td>Тариф ${i + 1}</td><td>${(i + 1) * 100}</td></tr>`).join('')}</table>
      <table id="other"><caption>Контакты</caption><tr><td>Почта</td></tr></table>`
    const first = (await act({ kind: 'read', table: 'Цены' })).result as PreviewReadResult
    expect(first.table).toMatchObject({ selector: '#prices', caption: 'Цены на тарифы', headers: ['Тариф', 'Цена'], totalRows: 25, rowOffset: 0, nextRowOffset: 20 })
    expect(first.table!.rows[0]).toEqual(['Тариф 1', '100'])
    const rest = (await act({ kind: 'read', table: 'Цены', rowOffset: 20 })).result as PreviewReadResult
    expect(rest.table!.rows).toHaveLength(5)
    expect(rest.table!.nextRowOffset).toBeUndefined()
    const missing = await act({ kind: 'read', table: 'Склады' })
    expect(missing.ok).toBe(false)
    expect(String(missing.error)).toContain('не найдена')
  })
})

describe('круг 18: поиск в разделе и прокрутка ленты', () => {
  it('find {in} ищет только в нужном разделе', async () => {
    document.body.innerHTML = `
      <h2>Доставка</h2><p><a href="/d">Условия</a></p>
      <h2>Оплата</h2><p><a href="/p">Условия</a></p>`
    const inDelivery = (await act({ kind: 'find', text: 'Условия', in: 'Доставка' })).result as PreviewFindResult
    expect(inDelivery.total).toBe(1)
    expect(inDelivery.elements[0].href).toContain('/d')
    const inPayment = (await act({ kind: 'find', text: 'Условия', in: 'Оплата' })).result as PreviewFindResult
    expect(inPayment.elements[0].href).toContain('/p')
    const missing = await act({ kind: 'find', text: 'Условия', in: 'Гарантия' })
    expect(missing.ok).toBe(false)
    expect(String(missing.error)).toContain('Раздел не найден')
  })
  it('scroll {until} листает ленту с подгрузкой, пока не покажется нужное', async () => {
    document.body.innerHTML = '<div id="feed"></div>'
    const feed = document.getElementById('feed')!
    const scroller = document.documentElement
    let top = 0, height = 1000
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; if (top > height - 900) { height += 1000; if (height >= 4000) feed.innerHTML = '<p>Нужная запись</p>' } } })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => height })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const res = (await act({ kind: 'scroll', until: 'Нужная запись' })).result as PreviewScrollResult
    expect(res.found?.text).toContain('Нужная запись')
    expect(res.screens).toBeGreaterThan(0)
  })
  it('scroll {until} честно сдаётся, когда лента закончилась', async () => {
    document.body.innerHTML = '<p>Короткая лента</p>'
    const res = await act({ kind: 'scroll', until: 'Такого тут нет', maxScreens: 3 })
    expect(res.ok).toBe(false)
    expect(String(res.error)).toMatch(/закончилась|не появилось/)
  })
})
