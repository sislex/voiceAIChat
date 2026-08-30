import { describe, expect, it, vi } from 'vitest'
import { runScenarioStep, stepHint } from './scenarioStep'

const step = (over: Record<string, unknown> = {}) => ({
  id: 's1', title: 'Нажать', action: { kind: 'click' as const, selector: '#a' }, ...over
})

describe('runScenarioStep', () => {
  it('успешное действие без ожиданий не читает страницу лишний раз', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    expect(await runScenarioStep(step(), send)).toEqual({ ok: true, detail: '' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('ожидаемый текст проверяется чтением страницы после действия', async () => {
    const send = vi.fn(async (command: { type: string; action?: { kind?: string } }) =>
      command.action?.kind === 'read' ? { ok: true, text: 'Задача создана' } : { ok: true })
    expect(await runScenarioStep(step({ expectText: 'Задача создана' }), send)).toEqual({ ok: true, detail: '' })
    expect((await runScenarioStep(step({ expectText: 'Задача удалена' }), send)).detail).toContain('нет ожидаемого текста')
  })

  it('недопустимый текст ловится', async () => {
    const send = vi.fn(async (command: { action?: { kind?: string } }) =>
      command.action?.kind === 'read' ? { ok: true, text: 'Ошибка сервера' } : { ok: true })
    expect((await runScenarioStep(step({ expectAbsentText: 'Ошибка' }), send)).detail).toContain('недопустимый текст')
  })

  it('прокрутка исполняется — именно её проба раньше не понимала', async () => {
    const sent: unknown[] = []
    const send = vi.fn(async (command: unknown) => { sent.push(command); return { ok: true } })
    expect(await runScenarioStep(step({ action: { kind: 'scroll', dy: 400 } }), send)).toEqual({ ok: true, detail: '' })
    expect(sent[0]).toMatchObject({ type: 'input', action: { type: 'wheel', deltaY: 400 } })
  })

  it('неисполнимое действие отличается от провала проверки', async () => {
    const result = await runScenarioStep(step({ action: { kind: 'edits' } }), vi.fn())
    expect(result.ok).toBe(false)
    expect(result.unsupported).toBe(true)
  })

  it('исключение транспорта сворачивается в первую строку', async () => {
    const send = vi.fn(async () => { throw new Error('Timeout 5000ms exceeded\nCall log:\n  - waiting') })
    expect(await runScenarioStep(step(), send)).toEqual({ ok: false, detail: 'Timeout 5000ms exceeded' })
  })
})

describe('stepHint', () => {
  it('таймаут и ненайденный элемент получают совет, а не голый текст', () => {
    expect(stepHint('Timeout 5000ms exceeded')).toContain('ожидаемый текст')
    expect(stepHint('локатор не найден')).toContain('уточните селектор')
  })
  it('остальные ошибки без выдуманных советов', () => {
    expect(stepHint('Нужен selector или text')).toBe('')
  })
})
