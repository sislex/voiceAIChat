import { describe, it, expect } from 'vitest'
import { comboKeyMatches, comboMatches, formatCombo, hasModifier, parseCombo } from './hotkeys'

/** Событие клавиатуры для сверки: только те поля, что читают функции. */
function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init
  } as KeyboardEvent
}

describe('parseCombo', () => {
  it('разбирает модификаторы и клавишу', () => {
    expect(parseCombo('mod+shift+k')).toEqual({ key: 'k', mod: true, ctrl: false, meta: false, alt: false, shift: true })
  })

  it('одиночная клавиша — без модификаторов', () => {
    expect(parseCombo('Space').key).toBe('space')
    expect(parseCombo('?')).toMatchObject({ key: '?', mod: false, shift: false })
  })

  it('hasModifier не считает Shift модификатором: «?» и так набирается с ним', () => {
    expect(hasModifier(parseCombo('mod+k'))).toBe(true)
    expect(hasModifier(parseCombo('alt+f'))).toBe(true)
    expect(hasModifier(parseCombo('shift+/'))).toBe(false)
    expect(hasModifier(parseCombo('Space'))).toBe(false)
  })
})

describe('comboKeyMatches', () => {
  it('пробел и Esc сверяются по code — раскладка на них не влияет', () => {
    expect(comboKeyMatches(ev({ code: 'Space' }), parseCombo('Space'))).toBe(true)
    expect(comboKeyMatches(ev({ code: 'Escape' }), parseCombo('Escape'))).toBe(true)
    expect(comboKeyMatches(ev({ key: 'Escape' }), parseCombo('Escape'))).toBe(true)
  })

  it('буквы — по key', () => {
    expect(comboKeyMatches(ev({ key: 'K' }), parseCombo('k'))).toBe(true)
    expect(comboKeyMatches(ev({ key: 'j' }), parseCombo('k'))).toBe(false)
  })
})

describe('comboMatches', () => {
  it('mod совпадает и с Cmd, и с Ctrl', () => {
    const mod = parseCombo('mod+k')
    expect(comboMatches(ev({ key: 'k', metaKey: true }), mod)).toBe(true)
    expect(comboMatches(ev({ key: 'k', ctrlKey: true }), mod)).toBe(true)
    expect(comboMatches(ev({ key: 'k' }), mod)).toBe(false)
  })

  it('лишний модификатор не проходит', () => {
    expect(comboMatches(ev({ key: '?', altKey: true }), parseCombo('?'))).toBe(false)
    expect(comboMatches(ev({ key: '?' }), parseCombo('?'))).toBe(true)
  })

  it('Shift не требуется, если комбинация его не объявила', () => {
    expect(comboMatches(ev({ key: '?', shiftKey: true }), parseCombo('?'))).toBe(true)
  })
})

describe('formatCombo', () => {
  it('macOS — ⌘ без плюсов, остальные — Ctrl+', () => {
    expect(formatCombo('mod+k', true)).toBe('⌘K')
    expect(formatCombo('mod+k', false)).toBe('Ctrl+K')
  })

  it('подписывает клавиши без символа', () => {
    expect(formatCombo('Space', false)).toBe('Пробел')
    expect(formatCombo('Escape', false)).toBe('Esc')
    expect(formatCombo('?', true)).toBe('?')
  })

  it('несколько модификаторов', () => {
    expect(formatCombo('mod+shift+p', true)).toBe('⌘⇧P')
    expect(formatCombo('mod+shift+p', false)).toBe('Ctrl+Shift+P')
  })
})
