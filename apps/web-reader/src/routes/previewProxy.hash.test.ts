// @vitest-environment jsdom
/// <reference lib="dom" />
//
// Deep-link через превью: фрагмент реального адреса (#/machines) живёт внутри
// query ?url=... и не попадает в location iframe-документа — context-шим
// восстанавливает его, чтобы hash-роутеры вложенных SPA открывали нужный маршрут.

import { describe, expect, it } from 'vitest'
import { previewContextScript } from './previewProxy.js'

function evalContext(base: string): void {
  const body = previewContextScript(base).replace(/^<script>/, '').replace(/<\/script>$/, '')
  ;(0, eval)(body)
}

describe('context-шим: восстановление hash', () => {
  it('переносит фрагмент целевого адреса в location.hash', () => {
    expect(window.location.hash).toBe('')
    evalContext('http://45.135.182.251:8787/#/machines')
    expect(window.location.hash).toBe('#/machines')
  })

  it('не трогает уже установленный hash документа', () => {
    window.location.hash = '#/already'
    evalContext('http://45.135.182.251:8787/#/other')
    expect(window.location.hash).toBe('#/already')
  })
})
