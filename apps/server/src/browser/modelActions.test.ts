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
    const plan = planModelAction({ kind: 'evaluate', code: 'document.title' })
    expect(plan.kind).toBe('unsupported')
    if (plan.kind === 'unsupported') expect(plan.reason).toMatch(/Playwright Reader/)
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

  it('без раннера нечего исполнять — evaluate по-прежнему отклоняется', () => {
    expect(planModelAction({ kind: 'evaluate', code: '1' }).kind).toBe('unsupported')
  })
})
