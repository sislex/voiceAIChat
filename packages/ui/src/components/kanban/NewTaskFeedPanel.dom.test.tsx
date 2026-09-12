import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../../test/uiRender'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'
import { NewTaskFeedPanel } from './NewTaskFeedPanel'
import { NewTaskSettingsPanel } from './NewTaskSettingsPanel'

beforeEach(() => { window.ci = createFakeCi() })
afterEach(() => { delete (window as { ci?: unknown }).ci })

describe('NewTaskFeedPanel', () => {
  it('шапка рана: живая точка, движок и остановка при активном ране', () => {
    const stop = vi.fn()
    render(<NewTaskFeedPanel projectId="p1" taskId="t1" onStopRun={stop} ciSummary={{ id: 'run-1', taskId: 't1', status: 'running', error: null, slotProgress: { phase: 'model', done: 1, total: 3 }, durationMs: null, modelActive: true, awaitingInput: false, executionLlm: { source: 'run', provider: 'codex', model: 'gpt-5', llmEngineId: null, stage: null, base: { provider: 'codex', model: 'gpt-5', llmEngineId: null } } as never }} />)
    const head = screen.getByRole('status', { name: 'Состояние рана' })
    expect(head).toHaveTextContent('Выполняется')
    expect(head.querySelector('.new-task-live-dot--live')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Остановить ран' }))
    expect(stop).toHaveBeenCalledOnce()
  })

  it('без рана шапка спокойна и кнопки остановки нет', () => {
    render(<NewTaskFeedPanel projectId="p1" taskId="t1" onStopRun={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Состояние рана' })).toHaveTextContent('Ранов сейчас нет')
    expect(screen.queryByRole('button', { name: 'Остановить ран' })).toBeNull()
  })
})

describe('NewTaskSettingsPanel', () => {
  it('три блока дизайна оборачивают настройки машины, модели и команд', async () => {
    render(<NewTaskSettingsPanel projectId="p1" taskId="t1" />)
    expect(await screen.findByLabelText('Машина выполнения')).toBeTruthy()
    expect(await screen.findByLabelText('Движок модели')).toBeTruthy()
    expect(screen.getByText('Команды воркфлоу')).toBeTruthy()
    expect(screen.getByTestId('new-task-settings').querySelectorAll('.new-task-section')).toHaveLength(3)
  })
})
