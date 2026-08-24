// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Режим «Скриншот области» автономного скрипта превью: включение по сообщению,
// выделение прямоугольника, Escape-выход. Рендер снимка в jsdom невозможен
// (canvas/Image отсутствуют) — здесь проверяется протокол: rect в координатах
// документа приходит родителю даже когда снимок не собрался (поле error).

import { beforeAll, describe, expect, it } from 'vitest'
import { previewInspectorScript } from './previewProxy.js'

const CAPTURE = 'voicechat.preview.capture.v1'

interface CaptureMessage { type?: string; enabled?: boolean; error?: string; rect?: { x: number; y: number; width: number; height: number }; shot?: unknown }
const received: CaptureMessage[] = []

function fromParent(data: object): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window }))
}
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const overlay = (): HTMLElement | null => document.querySelector('[data-voicechat-inspector="capture"]')

function pointer(type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  ;(overlay() ?? document.body).dispatchEvent(event)
}

beforeAll(() => {
  window.addEventListener('message', (event) => {
    const data = event.data as CaptureMessage
    if (data?.type === CAPTURE) received.push(data)
  })
  document.body.innerHTML = '<main><h1 id="title">Страница</h1></main>'
  const body = previewInspectorScript().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
})

describe('скриншот области', () => {
  it('включение режима рисует overlay, выключение убирает', async () => {
    fromParent({ type: CAPTURE, enabled: true })
    expect(overlay()).toBeTruthy()
    fromParent({ type: CAPTURE, enabled: false })
    expect(overlay()).toBeNull()
    await flush()
  })

  it('выделение области завершает режим и шлёт rect в координатах документа', async () => {
    received.length = 0
    fromParent({ type: CAPTURE, enabled: true })
    pointer('pointerdown', 20, 30)
    pointer('pointermove', 140, 110)
    pointer('pointerup', 140, 110)
    expect(overlay()).toBeNull() // режим одноразовый: выключился после выделения
    await flush()
    await flush()
    const done = received.find((m) => m.rect)
    expect(done?.rect).toEqual({ x: 20, y: 30, width: 120, height: 80 })
    // jsdom не умеет canvas — скрипт честно сообщает ошибку рендера, а не молчит.
    expect(typeof done?.error === 'string' || done?.shot !== undefined).toBe(true)
    expect(received.some((m) => m.enabled === false)).toBe(true)
  })

  it('слишком маленькое выделение игнорируется без сообщения со снимком', async () => {
    received.length = 0
    fromParent({ type: CAPTURE, enabled: true })
    pointer('pointerdown', 50, 50)
    pointer('pointerup', 53, 52)
    await flush()
    expect(received.filter((m) => m.rect)).toHaveLength(0)
  })

  it('Escape выключает режим и сообщает родителю enabled:false', async () => {
    received.length = 0
    fromParent({ type: CAPTURE, enabled: true })
    expect(overlay()).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(overlay()).toBeNull()
    await flush()
    expect(received.some((m) => m.enabled === false)).toBe(true)
  })
})
