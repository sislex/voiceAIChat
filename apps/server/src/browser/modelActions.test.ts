// Перевод действий модели в команды раннера. До появления этого моста модель
// Playwright Reader не видела вовсе: её инструменты уходили в relay, который
// пушит действие в браузер пользователя, а страница живёт в Chromium сервера.

import { describe, it, expect } from 'vitest'
import { planModelAction } from './modelActions'

describe('перевод действий модели для Playwright Reader', () => {
  it('открытие адреса становится навигацией', () => {
    expect(planModelAction({ kind: 'open', url: 'https://a.b' })).toEqual({
      kind: 'command', command: { type: 'navigate', url: 'https://a.b' }
    })
  })

  it('клик по селектору переносит правую кнопку и двойное нажатие', () => {
    expect(planModelAction({ kind: 'click', selector: '#save', button: 'right', dblclick: true })).toEqual({
      kind: 'command',
      command: { type: 'selector', action: { kind: 'click', selector: '#save', button: 'right', clickCount: 2 } }
    })
  })

  it('клик по тексту не теряет текст', () => {
    const plan = planModelAction({ kind: 'click', text: 'Отправить' })
    expect(plan).toMatchObject({ command: { action: { kind: 'click', text: 'Отправить' } } })
  })

  it('ввод переносит submit', () => {
    expect(planModelAction({ kind: 'type', selector: '#q', text: 'привет', submit: true })).toMatchObject({
      command: { type: 'selector', action: { kind: 'type', selector: '#q', text: 'привет', submit: true } }
    })
  })

  it('чтение без селектора читает страницу целиком', () => {
    expect(planModelAction({ kind: 'read' })).toEqual({
      kind: 'command', command: { type: 'selector', action: { kind: 'read' } }
    })
  })

  it('прокрутка к краям переводится в крупный шаг колеса', () => {
    expect(planModelAction({ kind: 'scroll', to: 'bottom' })).toMatchObject({
      command: { type: 'input', action: { type: 'wheel', deltaY: 10_000 } }
    })
    expect(planModelAction({ kind: 'scroll', to: 'top' })).toMatchObject({
      command: { action: { deltaY: -10_000 } }
    })
  })

  it('неподдерживаемое действие отклоняется с объяснением, а не выполняется не тем', () => {
    // Правки edit-режима копит прокси превью; в браузере такого режима нет.
    const plan = planModelAction({ kind: 'edits' })
    expect(plan.kind).toBe('unsupported')
    if (plan.kind === 'unsupported') expect(plan.reason).toMatch(/edit-режима/)
  })

  it('консоль и сеть больше не отклоняются: они нужны этапу автотестов', () => {
    expect(planModelAction({ kind: 'console', level: 'error' })).toMatchObject({
      command: { type: 'inspect', action: { kind: 'console', level: 'error' } }
    })
    expect(planModelAction({ kind: 'network', filter: '/api/' })).toMatchObject({
      command: { type: 'inspect', action: { kind: 'network', filter: '/api/' } }
    })
  })

  it('«ошибки страницы» — это журнал консоли с уровнем error', () => {
    expect(planModelAction({ kind: 'errors' })).toMatchObject({
      command: { type: 'inspect', action: { kind: 'console', level: 'error' } }
    })
  })

  it('стили читаются по селектору со списком свойств', () => {
    expect(planModelAction({ kind: 'styles', selector: '.card', properties: ['display'] })).toMatchObject({
      command: { type: 'inspect', action: { kind: 'styles', selector: '.card', properties: ['display'] } }
    })
  })

})

describe('действия, добавленные кругом 9', () => {
  it('evaluate уходит в раннер: гейт стоит выше, на MCP-инструменте', () => {
    expect(planModelAction({ kind: 'evaluate', code: 'window.store' })).toEqual({
      kind: 'command', command: { type: 'inspect', action: { kind: 'evaluate', code: 'window.store' } }
    })
  })

  it('hover, set и a11y ложатся на селекторные команды', () => {
    expect(planModelAction({ kind: 'hover', selector: '.menu' })).toMatchObject({ command: { type: 'selector', action: { kind: 'hover', selector: '.menu' } } })
    expect(planModelAction({ kind: 'set', selector: '#role', value: 'owner' })).toMatchObject({ command: { type: 'selector', action: { kind: 'set', selector: '#role', value: 'owner' } } })
    expect(planModelAction({ kind: 'set', selector: '#agree', checked: false })).toMatchObject({ command: { type: 'selector', action: { kind: 'set', checked: false } } })
    expect(planModelAction({ kind: 'a11y', limit: 50 })).toMatchObject({ command: { type: 'selector', action: { kind: 'a11y', limit: 50 } } })
  })

  it('viewport — это resize раннера; ширина зажимается в разумные пределы', () => {
    expect(planModelAction({ kind: 'viewport', width: 390 })).toMatchObject({ command: { type: 'resize', viewport: { width: 390 } } })
    expect(planModelAction({ kind: 'viewport', width: 99_999 })).toMatchObject({ command: { type: 'resize', viewport: { width: 2560 } } })
    // 0 в словаре модели означает «адаптив»; у раннера адаптива нет — дефолт.
    expect(planModelAction({ kind: 'viewport', width: 0 })).toMatchObject({ command: { type: 'resize', viewport: { width: 1280 } } })
  })

  it('drag по селекторам работает, по координатам — честный отказ', () => {
    expect(planModelAction({ kind: 'drag', from: { selector: '.card' }, to: { selector: '.column' } }))
      .toMatchObject({ command: { type: 'selector', action: { kind: 'drag', from: '.card', to: '.column' } } })
    const byPoint = planModelAction({ kind: 'drag', from: { x: 10, y: 10 }, to: { x: 20, y: 20 } })
    expect(byPoint.kind).toBe('unsupported')
    expect(byPoint.kind === 'unsupported' && byPoint.reason).toContain('селекторами')
  })

  it('единственное неподдержанное действие объясняется по существу', () => {
    // До круга 9 общую формулировку про Chromium получали все отказы подряд,
    // включая `edits`, для которого она была неверна по существу.
    const edits = planModelAction({ kind: 'edits' })
    expect(edits.kind === 'unsupported' && edits.reason).toContain('прокси веб-превью')
  })

  it('upload доходит до раннера вместе с именем и типом (круг 10)', () => {
    expect(planModelAction({ kind: 'upload', selector: '#file', name: 'a.png', mimeType: 'image/png', base64: 'AA==' }))
      .toMatchObject({ command: { type: 'selector', action: { kind: 'upload', selector: '#file', name: 'a.png', mimeType: 'image/png' } } })
  })
})
