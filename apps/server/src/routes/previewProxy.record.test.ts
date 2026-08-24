// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Запись сценариев автономным скриптом превью: скролл не создаёт шагов,
// значения парольных полей не покидают страницу, Enter-авторизация записывается
// сабмит-шагом, служебные панели и edit-режим в сценарий не попадают.

import { beforeAll, describe, expect, it } from 'vitest'
import { previewInspectorScript } from './previewProxy.js'

const RECORD = 'voicechat.preview.record.v1'
const EDIT = 'voicechat.preview.edit.v1'

interface RecordedStep { kind: string; selector: string; text: string; sensitive?: boolean; submit?: boolean }
const recorded: RecordedStep[] = []

/** Диспатчит сообщение скрипту от имени родителя (в jsdom parent === window). */
function fromParent(data: object): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window }))
}
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** postMessage в jsdom доставляется асинхронно — ждём доставку записанных шагов. */
const flush = (): Promise<void> => pause(0)

beforeAll(() => {
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: string; step?: RecordedStep }
    if (data?.type === RECORD && data.step) recorded.push(data.step)
  })
  document.body.innerHTML = `
    <main>
      <form id="login-form">
        <input id="user" name="user" autocomplete="username">
        <input id="password" name="password" type="password">
        <button id="enter" type="submit">Войти</button>
      </form>
      <button id="buy">Купить</button>
      <div style="height:5000px"></div>
    </main>`
  const body = previewInspectorScript().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
  fromParent({ type: RECORD, enabled: true })
})

describe('запись сценария', () => {
  it('ввод логина записывается со значением, пароль — sensitive без значения', async () => {
    const user = document.getElementById('user') as HTMLInputElement
    user.value = 'admin'
    user.dispatchEvent(new Event('input', { bubbles: true }))
    const password = document.getElementById('password') as HTMLInputElement
    password.value = 'hunter2'
    password.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(recorded).toEqual([
      { kind: 'type', selector: '#user', text: 'admin', sensitive: false },
      { kind: 'type', selector: '#password', text: '', sensitive: true }
    ])
    expect(JSON.stringify(recorded)).not.toContain('hunter2')
  })

  it('Enter-сабмит формы авторизации записывается type-шагом с submit', async () => {
    recorded.length = 0
    const password = document.getElementById('password') as HTMLInputElement
    password.focus()
    document.getElementById('login-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(recorded).toEqual([
      { kind: 'type', selector: '#password', text: '', sensitive: true, submit: true }
    ])
    expect(JSON.stringify(recorded)).not.toContain('hunter2')
  })

  it('скролл страницы не создаёт шагов', async () => {
    recorded.length = 0
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    window.dispatchEvent(new Event('scroll'))
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 400 }))
    await flush()
    expect(recorded).toEqual([])
  })

  it('клик записывается селектором; сабмит сразу после клика не даёт дубля', async () => {
    await pause(320) // отделяем от предыдущих сабмитов окно склейки клика
    recorded.length = 0
    document.getElementById('enter')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    document.getElementById('login-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(recorded).toEqual([
      { kind: 'click', selector: '#enter', text: 'Войти' }
    ])
  })

  it('обычный клик записывается и после скролла', async () => {
    recorded.length = 0
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 400 }))
    document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
    expect(recorded).toEqual([{ kind: 'click', selector: '#buy', text: 'Купить' }])
  })

  it('в edit-режиме действия не попадают в запись сценария', async () => {
    await pause(320)
    recorded.length = 0
    fromParent({ type: EDIT, enabled: true })
    document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const user = document.getElementById('user') as HTMLInputElement
    user.value = 'edited'
    user.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(recorded).toEqual([])
    fromParent({ type: EDIT, enabled: false })
    await flush()
    // После выключения edit-режима запись продолжает работать.
    document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
    expect(recorded).toEqual([{ kind: 'click', selector: '#buy', text: 'Купить' }])
  })

  it('ввод в служебную панель инспектора не записывается', async () => {
    recorded.length = 0
    const panel = document.createElement('div')
    panel.setAttribute('data-voicechat-inspector', 'edit-panel')
    const field = document.createElement('input')
    panel.append(field)
    document.body.append(panel)
    field.value = 'panel'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
    expect(recorded).toEqual([])
    panel.remove()
  })
})
