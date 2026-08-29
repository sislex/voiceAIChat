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
