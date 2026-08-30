import { describe, expect, it, vi } from 'vitest'
import { runScenarioStep, scenarioProblems, stepHint, type ScenarioSend, type ScenarioStepOptions } from './scenarioStep'

// Ожидания повторяются до таймаута, поэтому в тестах сон мгновенный, а часы
// двигаются сами: иначе каждая проверка стоила бы пять секунд.
let clock = 0
const fast: ScenarioStepOptions = { expectTimeoutMs: 1000, pollMs: 100, sleep: async (ms) => { clock += ms }, now: () => clock }

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
    const send: ScenarioSend = vi.fn(async (command) =>
      command.type === 'selector' && command.action.kind === 'read' ? { ok: true, text: 'Задача создана' } : { ok: true })
    expect(await runScenarioStep(step({ expectText: 'Задача создана' }), send, fast)).toEqual({ ok: true, detail: '' })
    expect((await runScenarioStep(step({ expectText: 'Задача удалена' }), send, fast)).detail).toContain('нет ожидаемого текста')
  })

  it('недопустимый текст ловится', async () => {
    const send: ScenarioSend = vi.fn(async (command) =>
      command.type === 'selector' && command.action.kind === 'read' ? { ok: true, text: 'Ошибка сервера' } : { ok: true })
    expect((await runScenarioStep(step({ expectAbsentText: 'Ошибка' }), send, fast)).detail).toContain('недопустимый текст')
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
    expect(await runScenarioStep(step(), send)).toEqual({ ok: false, detail: 'Timeout 5000ms exceeded', failure: 'action' })
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

describe('ожидания догоняют страницу (круг 18)', () => {
  it('текст, появившийся не сразу, всё равно засчитывается', async () => {
    // Интерфейс обновляется асинхронно: нажал «Создать» — карточка появится
    // через сотню миллисекунд. Мгновенная проверка делала шаг мигающим.
    clock = 0
    let reads = 0
    const send: ScenarioSend = vi.fn(async (command) => {
      if (command.type !== 'selector' || command.action.kind !== 'read') return { ok: true }
      reads++
      return { ok: true, text: reads >= 3 ? 'Задача создана' : 'Загрузка…' }
    })
    expect(await runScenarioStep({ id: 's', title: 'Создать', action: { kind: 'click', selector: '#a' }, expectText: 'Задача создана' }, send, fast))
      .toEqual({ ok: true, detail: '' })
    expect(reads).toBe(3)
  })

  it('недопустимый текст, исчезающий не сразу, не роняет шаг ложно', async () => {
    clock = 0
    let reads = 0
    const send: ScenarioSend = vi.fn(async (command) => {
      if (command.type !== 'selector' || command.action.kind !== 'read') return { ok: true }
      reads++
      return { ok: true, text: reads >= 2 ? 'Готово' : 'Ошибка сохранения' }
    })
    expect(await runScenarioStep({ id: 's', title: 'Сохранить', action: { kind: 'click', selector: '#a' }, expectAbsentText: 'Ошибка' }, send, fast))
      .toEqual({ ok: true, detail: '' })
  })

  it('не дождавшись, показывает что было на странице', async () => {
    clock = 0
    const send: ScenarioSend = vi.fn(async (command) =>
      command.type === 'selector' && command.action.kind === 'read' ? { ok: true, text: 'Совсем другое содержимое' } : { ok: true })
    const result = await runScenarioStep({ id: 's', title: 'Шаг', action: { kind: 'click', selector: '#a' }, expectText: 'Задача создана' }, send, fast)
    expect(result.detail).toContain('Видно: Совсем другое содержимое')
    expect(result.failure).toBe('expectation')
  })

  it('провал действия и провал проверки различаются', async () => {
    clock = 0
    const broken: ScenarioSend = vi.fn(async () => ({ ok: false, error: 'локатор не найден' }))
    expect((await runScenarioStep({ id: 's', title: 'Шаг', action: { kind: 'click', selector: '#a' } }, broken, fast)).failure).toBe('action')
  })
})

describe('scenarioProblems', () => {
  const ok = { startUrl: 'http://x/', steps: [{ id: 's1', title: 'Нажать', action: { kind: 'click' as const, selector: '#a' }, expectText: 'Готово' }] }

  it('исправный сценарий не вызывает нареканий', () => {
    expect(scenarioProblems(ok)).toEqual([])
  })

  it('пустой адрес и отсутствие шагов называются отдельно', () => {
    expect(scenarioProblems({ startUrl: ' ', steps: [] })).toEqual(expect.arrayContaining(['Не задан стартовый адрес', 'В сценарии нет ни одного шага']))
  })

  it('неисполнимое действие ловится до сохранения, а не на прогоне', () => {
    const problems = scenarioProblems({ ...ok, steps: [{ id: 's1', title: 'Правки', action: { kind: 'edits' } }] })
    expect(problems.some((p) => p.includes('Шаг 1 («Правки»)'))).toBe(true)
  })

  it('пустой селектор ловится', () => {
    const problems = scenarioProblems({ ...ok, steps: [{ id: 's1', title: 'Нажать', action: { kind: 'click', selector: '   ' }, expectText: 'x' }] })
    expect(problems).toContain('Шаг 1 («Нажать»): пустой селектор')
  })

  it('отсутствие проверок — тоже проблема сценария, а не мелочь', () => {
    expect(scenarioProblems({ ...ok, steps: [{ id: 's1', title: 'Нажать', action: { kind: 'click', selector: '#a' } }] }))
      .toContain('Ни одной проверки: сценарий пройдёт, даже если страница сломана')
  })
})
