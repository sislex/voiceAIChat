import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutomatedQaScenario, BrowserCommand } from '@voicechat/shared'
import { createAutomatedQaScenarioRunner } from './automatedQaScenario.js'
import type { BrowserRunnerClient } from '../browser/runnerClient.js'

function browser(over: Partial<BrowserRunnerClient> = {}): BrowserRunnerClient {
  return {
    start: vi.fn(async () => ({ incarnation: 'inc-1' } as never)),
    command: vi.fn(async () => ({ ok: true } as never)),
    screenshot: vi.fn(async () => ({ buffer: Buffer.from('png'), mimeType: 'image/png' })),
    stop: vi.fn(async () => true),
    ...over
  } as BrowserRunnerClient
}

const scenario = (steps: AutomatedQaScenario['steps']): AutomatedQaScenario => ({ startUrl: 'http://localhost:5173', steps })

describe('createAutomatedQaScenarioRunner', () => {
  it('проходит шаги, пишет снимок и всегда закрывает сессию', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-shot-'))
    const client = browser()
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: dir, screenshotUrl: (id) => `/api/qa/runs/${id}/screenshot` })
    const outcome = await runner.run({
      runId: 'run-1', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }])
    })
    expect(outcome.blocked).toBeNull()
    expect(outcome.steps).toEqual([expect.objectContaining({ id: 's1', status: 'passed' })])
    expect(outcome.screenshotUrl).toBe('/api/qa/runs/run-1/screenshot')
    expect(existsSync(join(dir, 'run-1.png'))).toBe(true)
    expect(client.stop).toHaveBeenCalledWith('qa-run-1')
  })

  it('провал шага останавливает прогон, остальные помечаются пропущенными', async () => {
    const client = browser({ command: vi.fn(async (_id, request) => (request.command.type === 'selector' && request.command.action.kind === 'click' ? { ok: false, error: 'локатор не найден' } : { ok: true }) as never) })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const outcome = await runner.run({
      runId: 'run-2', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([
        { id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } },
        { id: 's2', title: 'Проверка', action: { kind: 'click', selector: '#check' } }
      ])
    })
    expect(outcome.steps.map((step) => step.status)).toEqual(['failed', 'skipped'])
    expect(outcome.steps[0].detail).toBe('локатор не найден')
  })

  it('ожидание текста проверяется чтением страницы после действия', async () => {
    const commands: BrowserCommand[] = []
    const client = browser({
      command: vi.fn(async (_id, request) => {
        commands.push(request.command)
        return (request.command.type === 'selector' && request.command.action.kind === 'read' ? { ok: true, text: 'Задача создана' } : { ok: true }) as never
      })
    })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const ok = await runner.run({
      runId: 'run-3', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([{ id: 's1', title: 'Создать', action: { kind: 'click', selector: '#create' }, expectText: 'Задача создана' }])
    })
    expect(ok.steps[0].status).toBe('passed')
    expect(commands.some((command) => command.type === 'selector' && command.action.kind === 'read')).toBe(true)
    const bad = await runner.run({
      runId: 'run-4', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([{ id: 's1', title: 'Создать', action: { kind: 'click', selector: '#create' }, expectAbsentText: 'Задача создана' }])
    })
    expect(bad.steps[0].status).toBe('failed')
    expect(bad.steps[0].detail).toContain('недопустимый текст')
  })

  it('недоступный Chromium — блокировка, а не провал сценария', async () => {
    const client = browser({ start: vi.fn(async () => { throw new Error('runner unreachable\nstack line') }) })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const outcome = await runner.run({ runId: 'run-5', userId: 'alice', signal: new AbortController().signal, scenario: scenario([]) })
    expect(outcome.blocked).toBe('Изолированный Chromium недоступен: runner unreachable')
    expect(outcome.steps).toHaveLength(0)
  })

  it('пустой стартовый адрес блокирует прогон, не открывая браузер', async () => {
    const client = browser()
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const outcome = await runner.run({ runId: 'run-6', userId: 'alice', signal: new AbortController().signal, scenario: { startUrl: '  ', steps: [] } })
    expect(outcome.blocked).toContain('не задан стартовый адрес')
    expect(client.start).not.toHaveBeenCalled()
  })
})

describe('ресурсы прогона (круг 10)', () => {
  const shotDir = (): string => mkdtempSync(join(tmpdir(), 'qa-shot-'))

  it('перед прогоном старая сессия гасится: перезапуск не продолжает чужую страницу', async () => {
    // `start` идемпотентен, а ран после рестарта сервера перезапускается с тем
    // же id — без этого прогон пошёл бы в старой странице со старым состоянием.
    const order: string[] = []
    const client = browser({
      stop: vi.fn(async () => { order.push('stop'); return true }),
      start: vi.fn(async () => { order.push('start'); return { incarnation: 'inc' } as never })
    })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: shotDir(), screenshotUrl: () => '/shot' })
    await runner.run({ runId: 'r', userId: 'alice', signal: new AbortController().signal, scenario: scenario([]) })
    expect(order.slice(0, 2)).toEqual(['stop', 'start'])
  })

  it('исчерпанный бюджет останавливает прогон и считается инфраструктурой', async () => {
    let clock = 0
    const client = browser({ command: vi.fn(async () => { clock += 5_000; return { ok: true } as never }) })
    const runner = createAutomatedQaScenarioRunner({
      browser: client, screenshotDir: shotDir(), screenshotUrl: () => '/shot', now: () => clock
    })
    const outcome = await runner.run({
      // Каждая команда «стоит» 5 с, и навигация тоже: бюджета 13 с хватает на
      // два шага, третий уже за границей.
      runId: 'r', userId: 'alice', signal: new AbortController().signal, budgetMs: 13_000,
      scenario: scenario([
        { id: 's1', title: 'Первый', action: { kind: 'click', selector: '#a' } },
        { id: 's2', title: 'Второй', action: { kind: 'click', selector: '#b' } },
        { id: 's3', title: 'Третий', action: { kind: 'click', selector: '#c' } }
      ])
    })
    expect(outcome.steps.map((step) => step.status)).toEqual(['passed', 'passed', 'skipped'])
    expect(outcome.steps[2].detail).toContain('бюджет')
    expect(outcome.blocked).toContain('бюджет')
  })

  it('сигнал отмены доходит до раннера, а не только проверяется между шагами', async () => {
    const seen: Array<AbortSignal | undefined> = []
    const client = browser({ command: vi.fn(async (_id, _req, signal) => { seen.push(signal); return { ok: true } as never }) })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: shotDir(), screenshotUrl: () => '/shot' })
    const controller = new AbortController()
    await runner.run({
      runId: 'r', userId: 'alice', signal: controller.signal,
      scenario: scenario([{ id: 's1', title: 'Шаг', action: { kind: 'click', selector: '#a' } }])
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((signal) => signal === controller.signal)).toBe(true)
  })
})

describe('ошибки страницы', () => {
  it('собираются до остановки сессии и приходят в исходе', async () => {
    const client = browser({ command: vi.fn(async (_id, request) => (request.command.type === 'inspect'
      ? { ok: true, console: [{ level: 'error', text: 'Uncaught TypeError: columns is undefined', at: 1 }] }
      : { ok: true }) as never) })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const outcome = await runner.run({
      runId: 'run-errors', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([{ id: 's1', title: 'Открыть доску', action: { kind: 'click', selector: '#board' } }])
    })
    expect(outcome.pageErrors).toEqual(['Uncaught TypeError: columns is undefined'])
    expect(outcome.pageErrors.join()).not.toContain('×')
    // Провалом сами по себе не считаются: страница может ругаться на постороннее.
    expect(outcome.blocked).toBeNull()
    expect(outcome.steps[0]).toMatchObject({ status: 'passed' })
  })
})

describe('повтор ошибки страницы', () => {
  it('схлопывается с кратностью: одно исключение раннер видит и в console, и в pageerror', async () => {
    const client = browser({ command: vi.fn(async (_id, request) => (request.command.type === 'inspect'
      ? { ok: true, console: [
          { level: 'error', text: 'Cannot read properties of undefined', at: 1 },
          { level: 'error', text: 'Cannot read properties of undefined', at: 2 },
          { level: 'error', text: 'Failed to load resource: 500', at: 3 }
        ] }
      : { ok: true }) as never) })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const outcome = await runner.run({
      runId: 'run-dup', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([{ id: 's1', title: 'Открыть', action: { kind: 'click', selector: '#a' } }])
    })
    expect(outcome.pageErrors).toEqual(['Cannot read properties of undefined (×2)', 'Failed to load resource: 500'])
  })
})

describe('шаг, который нельзя проверить', () => {
  it('блокирует прогон вместо провала: судить о реализации по нему нельзя', async () => {
    // Страница длиннее предела чтения: текст мог быть за обрезом.
    const client = browser({ command: vi.fn(async (_id, request) => (request.command.type === 'selector' && request.command.action.kind === 'read'
      ? { ok: true, text: 'начало страницы…', truncated: true }
      : { ok: true }) as never) })
    const runner = createAutomatedQaScenarioRunner({ browser: client, screenshotDir: mkdtempSync(join(tmpdir(), 'qa-shot-')), screenshotUrl: () => '/shot' })
    const outcome = await runner.run({
      runId: 'run-unverifiable', userId: 'alice', signal: new AbortController().signal,
      scenario: scenario([{ id: 's1', title: 'Открыть доску', action: { kind: 'click', selector: '#board' }, expectText: 'подвал' }])
    })
    expect(outcome.blocked).toContain('проверить нельзя')
    expect(outcome.steps[0]).toMatchObject({ id: 's1', status: 'failed' })
    // Снимок всё равно нужен: по нему видно, что было на странице.
    expect(outcome.screenshotUrl).toBe('/shot')
  })
})
