// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Edit-режим автономного скрипта превью: панель правок под выбранным элементом,
// применение inline-стилей, персист в localStorage браузера (через страничный
// ключ) и восстановление сохранённых правок при загрузке страницы.

import { beforeAll, describe, expect, it } from 'vitest'
import { previewInspectorScript } from './previewProxy.js'

const EDIT = 'voicechat.preview.edit.v1'
const EDITS_KEY = 'voicechat.preview.edits.v1:' + window.location.origin + window.location.pathname

function fromParent(data: object): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window }))
}
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const storedEdits = (): Record<string, { style?: Record<string, string>; text?: string; deleted?: boolean }> =>
  JSON.parse(localStorage.getItem(EDITS_KEY) ?? '{}')
const panel = (): HTMLElement | null => document.querySelector('[data-voicechat-inspector="edit-panel"]')
const panelButton = (title: string): HTMLButtonElement => {
  const button = panel()?.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  if (!button) throw new Error('Кнопка панели не найдена: ' + title)
  return button
}

beforeAll(() => {
  document.body.innerHTML = `
    <main>
      <h1 id="title">Заголовок</h1>
      <p id="text">Абзац с текстом</p>
      <p id="restored">Восстанавливаемый</p>
      <p id="gone">Удалённый ранее</p>
    </main>`
  // Правки прошлого визита уже лежат в браузере — скрипт применяет их на старте.
  localStorage.setItem(EDITS_KEY, JSON.stringify({
    '#restored': { original: { cssText: '', text: null }, style: { fontWeight: '700', fontSize: '22px' }, text: 'Сохранённый текст' },
    '#gone': { original: { cssText: '', text: null }, deleted: true }
  }))
  const body = previewInspectorScript().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
})

describe('edit-режим превью', () => {
  it('восстанавливает сохранённые правки при загрузке страницы', () => {
    const restored = document.getElementById('restored') as HTMLElement
    expect(restored.style.fontWeight).toBe('700')
    expect(restored.style.fontSize).toBe('22px')
    expect(restored.textContent).toBe('Сохранённый текст')
    expect((document.getElementById('gone') as HTMLElement).style.display).toBe('none')
  })

  it('клик по элементу в edit-режиме открывает панель под элементом', () => {
    fromParent({ type: EDIT, enabled: true })
    document.getElementById('title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const toolbar = panel()
    expect(toolbar).toBeTruthy()
    expect(toolbar!.querySelector('button[title="Жирный"]')).toBeTruthy()
    expect(toolbar!.querySelector('button[title="Удалить элемент"]')).toBeTruthy()
    expect(toolbar!.querySelector('select[title="Шрифт"]')).toBeTruthy()
  })

  it('изменение размера и жирности применяется inline и сохраняется в localStorage', () => {
    panelButton('Увеличить шрифт').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    panelButton('Увеличить шрифт').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    panelButton('Жирный').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const title = document.getElementById('title') as HTMLElement
    expect(title.style.fontSize).toMatch(/px$/)
    expect(title.style.fontWeight).toBe('700')
    const saved = storedEdits()['#title']
    expect(saved?.style?.fontWeight).toBe('700')
    expect(saved?.style?.fontSize).toBe(title.style.fontSize)
  })

  it('редактирование текста включает contenteditable и сохраняет текст', async () => {
    panelButton('Редактировать текст').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const title = document.getElementById('title') as HTMLElement
    expect(title.getAttribute('contenteditable')).toBe('true')
    title.textContent = 'Новый заголовок'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(storedEdits()['#title']?.text).toBe('Новый заголовок')
  })

  it('сброс правок элемента возвращает исходные стили и текст', () => {
    panelButton('Сбросить правки элемента').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const title = document.getElementById('title') as HTMLElement
    expect(title.style.fontWeight).toBe('')
    expect(title.textContent).toBe('Заголовок')
    expect(storedEdits()['#title']).toBeUndefined()
    expect(panel()).toBeNull()
  })

  it('удаление элемента скрывает его и записывает deleted-правку', () => {
    document.getElementById('text')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    panelButton('Удалить элемент').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect((document.getElementById('text') as HTMLElement).style.display).toBe('none')
    expect(storedEdits()['#text']?.deleted).toBe(true)
    expect(panel()).toBeNull()
  })

  it('Escape закрывает панель, повторный — выключает режим и сообщает родителю', async () => {
    const notified: boolean[] = []
    const listener = (event: MessageEvent): void => {
      const data = event.data as { type?: string; enabled?: boolean }
      if (data?.type === EDIT && typeof data.enabled === 'boolean') notified.push(data.enabled)
    }
    window.addEventListener('message', listener)
    document.getElementById('restored')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(panel()).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(panel()).toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flush()
    expect(notified).toContain(false)
    window.removeEventListener('message', listener)
    // Режим выключен: клики больше не открывают панель.
    document.getElementById('restored')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(panel()).toBeNull()
  })
})
