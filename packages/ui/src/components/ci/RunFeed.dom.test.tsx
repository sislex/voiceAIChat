import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CiRun, CiRunStep, CiLogLine } from '@shared/ci'
import { RunFeed, type RunFeedCache } from './RunFeed'

function mkRun(over: Partial<CiRun> = {}): CiRun {
  return {
    id: 'run-1', projectId: 'p1', taskId: 't1', agentId: null, status: 'running', workspaceId: null,
    triggeredBy: 'admin', prevColumnId: null, llmProvider: 'claude', llmModel: 'sonnet', slotProgress: { done: 1, total: 3, phase: 'до модели' },
    startedAt: 1000, finishedAt: null, durationMs: null, createdAt: 1000, ...over
  }
}
function mkStep(over: Partial<CiRunStep> = {}): CiRunStep {
  return {
    id: 's1', runId: 'run-1', slot: 'before_model', position: 1, kind: 'command', parentStepId: null,
    initiatedBy: 'system', commandId: 'cmd-1', commandSnapshot: 'npm ci', title: 'npm ci', workdir: null,
    status: 'running', exitCode: null, attempt: 1, fixedByModel: false, startedAt: 1000, finishedAt: null, durationMs: null, ...over
  }
}
function mkLog(over: Partial<CiLogLine> = {}): CiLogLine {
  return { runId: 'run-1', stepId: 's1', seq: 1, stream: 'stdout', chunk: 'installing deps…', at: 1000, ...over }
}

function baseProps(cache: RunFeedCache | undefined) {
  return {
    runId: 'run-1', cache,
    onSubscribe: vi.fn(), onUnsubscribe: vi.fn(), onLoad: vi.fn(), onRetry: vi.fn(), onCancel: vi.fn(),
    now: () => 5000
  }
}

describe('RunFeed', () => {
  it('подписывается на ран и подгружает его при монтировании', () => {
    const p = baseProps(undefined)
    render(<RunFeed {...p} />)
    expect(p.onSubscribe).toHaveBeenCalledWith('run-1')
    expect(p.onLoad).toHaveBeenCalledWith('run-1')
  })

  it('рендерит шаги и потоковый лог', () => {
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [] }, log: [mkLog()], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.getByText('npm ci')).toBeInTheDocument()
    // running-шаг раскрыт автоматически → виден лог
    expect(screen.getByText('installing deps…')).toBeInTheDocument()
    expect(screen.getByText('выполняется')).toBeInTheDocument()
  })

  it('вложенный вызов команды модели под model_work', () => {
    const work = mkStep({ id: 'w1', kind: 'model_work', title: 'работа модели', commandId: null })
    const call = mkStep({ id: 'mc1', kind: 'model_command', parentStepId: 'w1', title: 'model: npm test', commandId: 'cmd-2', position: 2 })
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [work, call], fixAttempts: [] }, log: [], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.getByText('работа модели')).toBeInTheDocument()
    expect(screen.getByText('model: npm test')).toBeInTheDocument()
  })

  it('при падении model_work позволяет выбрать Codex и повторить только модель', () => {
    const model = mkStep({ id: 'model-1', kind: 'model_work', slot: null, commandId: null, title: 'Работа модели', status: 'failed' })
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [model], fixAttempts: [] }, log: [], conclusion: null }
    const onRetryFromStep = vi.fn()
    render(<RunFeed {...baseProps(cache)} onRetryFromStep={onRetryFromStep} />)
    expect(screen.getByText(/Финальные команды не запускались/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Провайдер'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить работу модели' }))
    expect(onRetryFromStep).toHaveBeenCalledWith('run-1', { provider: 'codex', model: 'gpt-5-codex' })
  })

  it('кнопка «Повторить весь воркфлоу» вызывает onRetry', () => {
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [mkStep({ status: 'failed', exitCode: 1 })], fixAttempts: [] }, log: [], conclusion: null }
    const p = baseProps(cache)
    render(<RunFeed {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить весь воркфлоу' }))
    expect(p.onRetry).toHaveBeenCalledWith('run-1')
  })
})
