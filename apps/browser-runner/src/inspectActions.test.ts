// Осмотр страницы: журналы консоли и сети плюс вычисленные стили. Без них этапу
// автотестов проверять нечего — модель видит картинку и текст, но не знает об
// ошибках страницы и упавших запросах.

import { describe, it, expect, vi } from 'vitest'
import { runInspectAction, type InspectLogs, type InspectPage } from './inspectActions'

const logs = (): InspectLogs => ({
  console: [
    { level: 'log', text: 'привет', at: 1 },
    { level: 'error', text: 'Uncaught TypeError: x is not a function', at: 2 },
    { level: 'warn', text: 'deprecated api', at: 3 }
  ],
  network: [
    { method: 'GET', url: 'https://a.b/api/items', status: 200, ok: true, at: 1 },
    { method: 'POST', url: 'https://a.b/api/save', status: 500, ok: false, at: 2 }
  ]
})
const page = (result: unknown = { display: 'flex' }): InspectPage => ({ evaluate: vi.fn(async () => result as never) })

describe('осмотр страницы', () => {
  it('консоль фильтруется по уровню', async () => {
    const result = await runInspectAction(logs(), page(), { kind: 'console', level: 'error' })
    expect(result.console).toHaveLength(1)
    expect(result.console?.[0].text).toMatch(/TypeError/)
  })

  it('консоль фильтруется по шаблону без учёта регистра', async () => {
    const result = await runInspectAction(logs(), page(), { kind: 'console', pattern: 'DEPRECATED' })
    expect(result.console?.[0].text).toBe('deprecated api')
  })

  it('отдаётся хвост журнала: свежие записи полезнее первых', async () => {
    const result = await runInspectAction(logs(), page(), { kind: 'console', limit: 1 })
    expect(result.console).toHaveLength(1)
    expect(result.console?.[0].text).toBe('deprecated api')
  })

  it('clear очищает журнал после выдачи', async () => {
    const store = logs()
    await runInspectAction(store, page(), { kind: 'console', clear: true })
    expect(store.console).toHaveLength(0)
  })

  it('сеть фильтруется по части адреса', async () => {
    const result = await runInspectAction(logs(), page(), { kind: 'network', filter: '/api/save' })
    expect(result.network).toHaveLength(1)
    expect(result.network?.[0]).toMatchObject({ status: 500, ok: false })
  })

  it('стили возвращаются вычисленными', async () => {
    const result = await runInspectAction(logs(), page({ display: 'grid', color: 'rgb(0, 0, 0)' }), { kind: 'styles', selector: '.card' })
    expect(result.ok).toBe(true)
    expect(result.styles).toMatchObject({ display: 'grid' })
  })

  it('отсутствующий узел объясняется, а не падает', async () => {
    const result = await runInspectAction(logs(), page(null), { kind: 'styles', selector: '.нет' })
    expect(result).toEqual({ ok: false, error: 'Узел .нет не найден' })
  })
})

describe('evaluate (круг 9)', () => {
  const logs = { console: [], network: [] }
  it('отдаёт значение из страницы', async () => {
    const page = { evaluate: async () => ({ tasks: 3 }) } as unknown as InspectPage
    expect(await runInspectAction(logs, page, { kind: 'evaluate', code: 'window.store.tasks.length' })).toEqual({ ok: true, value: { tasks: 3 } })
  })

  it('несериализуемое значение не роняет действие', async () => {
    // page.evaluate у Playwright уже сериализует, но раннер не обязан верить
    // вызывающему: в лог рана и в ответ модели уходит текст, а не объект.
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const page = { evaluate: async () => cyclic } as unknown as InspectPage
    const result = await runInspectAction(logs, page, { kind: 'evaluate', code: 'window' })
    expect(result.ok).toBe(true)
    expect(typeof result.value).toBe('string')
  })

  it('длинная строка режется по лимиту', async () => {
    const page = { evaluate: async () => 'x'.repeat(30_000) } as unknown as InspectPage
    expect(String((await runInspectAction(logs, page, { kind: 'evaluate', code: 'document.body.innerHTML' })).value)).toHaveLength(20_001)
  })

  it('ошибка страницы возвращается первой строкой', async () => {
    const page = { evaluate: async () => { throw new Error('ReferenceError: store is not defined\nat <anonymous>') } } as unknown as InspectPage
    expect(await runInspectAction(logs, page, { kind: 'evaluate', code: 'store' })).toEqual({ ok: false, error: 'ReferenceError: store is not defined' })
  })
})
