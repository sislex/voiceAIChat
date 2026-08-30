import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { MergePanel } from './MergePanel'
import { createFakeCi } from '../../test/fakeApi'
import type { MergeMachinesResponse, MergeRun } from '@shared/merge'
import type { CiTaskMachines } from '@shared/ci'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const mergeRun = (patch: Partial<MergeRun> = {}): MergeRun => ({
  id: 'run-1', projectId: 'p1', taskId: 't1', status: 'failed', triggeredBy: 'alexey', sourceBranch: 'CHAT-255', targetBranch: 'main',
  sourceSha: 'a'.repeat(40), targetSha: null, mergeSha: null, revertSha: null, agentId: 'm1', machineName: 'MacBook',
  llmEngineId: null, llmProvider: 'codex', llmModel: '', stage: 'failed', stages: [], conflicts: [], conflictDetails: [], checks: [],
  deployId: null, deployVersion: null, productionStatus: null, error: 'Ошибка', recommendedAction: null, log: '', canCancel: false, canRetry: true,
  pushStartedAt: null, startedAt: 1, finishedAt: 2, createdAt: 1, ...patch
})

describe('MergePanel', () => {
  beforeEach(() => {
    window.ci = createFakeCi()
    window.ci.getTaskMachines = vi.fn(async () => ({
      machines: [
        { agentId: 'm1', name: 'MacBook', online: true, personal: true, project: false, projectDefault: false },
        { agentId: 'm2', name: 'Server', online: false, personal: false, project: true, projectDefault: true }
      ],
      selectedAgentId: null,
      unavailableSelection: null
    }))
    window.ci.getMergeMachines = vi.fn(async () => ({ machines: [
      { agentId: 'm1', name: 'MacBook', readiness: { ready: true, selectable: true, mode: 'managed' as const, code: 'ready' as const, message: 'Managed MachineStorage готово' } },
      { agentId: 'm2', name: 'Server', readiness: { ready: false, selectable: false, mode: 'managed' as const, code: 'machine_offline' as const, message: 'Машина не в сети' } }
    ], defaultAgentId: 'm1' }))
  })

  it('показывает skeleton и aria-busy до завершения первой загрузки', () => {
    window.ci!.getTaskMachines = vi.fn(() => new Promise<CiTaskMachines>(() => {}))
    window.ci!.getMergeMachines = vi.fn(() => new Promise<MergeMachinesResponse>(() => {}))

    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart onStartMerge={vi.fn()} />)

    expect(screen.getByTestId('merge-machines')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('merge-machines-skeleton-list')).toBeInTheDocument()
    expect(screen.queryByTestId('merge-machines-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('merge-machines-error')).not.toBeInTheDocument()
  })

  it('заменяет skeleton списком после согласованной загрузки', async () => {
    const taskMachines = deferred<CiTaskMachines>()
    const mergeMachines = deferred<MergeMachinesResponse>()
    window.ci!.getTaskMachines = vi.fn(() => taskMachines.promise)
    window.ci!.getMergeMachines = vi.fn(() => mergeMachines.promise)

    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart onStartMerge={vi.fn()} />)
    expect(screen.getByTestId('merge-machines-skeleton-list')).toBeInTheDocument()

    taskMachines.resolve({
      machines: [
        { agentId: 'm1', name: 'MacBook', online: true, personal: true, project: false, projectDefault: false },
        { agentId: 'm2', name: 'Server', online: false, personal: false, project: true, projectDefault: true }
      ],
      selectedAgentId: null,
      unavailableSelection: null
    })
    mergeMachines.resolve({ machines: [
      { agentId: 'm1', name: 'MacBook', readiness: { ready: true, selectable: true, mode: 'managed', code: 'ready', message: 'Готово' } },
      { agentId: 'm2', name: 'Server', readiness: { ready: false, selectable: false, mode: 'managed', code: 'machine_offline', message: 'Машина не в сети' } }
    ], defaultAgentId: 'm1' })

    expect(await screen.findByRole('option', { name: /MacBook/ })).toBeInTheDocument()
    expect(screen.queryByTestId('merge-machines-skeleton-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('merge-machines')).toHaveAttribute('aria-busy', 'false')
    expect((screen.getByRole('option', { name: /Машина не в сети/ }) as HTMLOptionElement).disabled).toBe(true)
  })

  it('показывает подтверждённое пустое состояние только после успешной загрузки', async () => {
    const taskMachines = deferred<CiTaskMachines>()
    const mergeMachines = deferred<MergeMachinesResponse>()
    window.ci!.getTaskMachines = vi.fn(() => taskMachines.promise)
    window.ci!.getMergeMachines = vi.fn(() => mergeMachines.promise)

    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart onStartMerge={vi.fn()} />)
    expect(screen.queryByTestId('merge-machines-empty')).not.toBeInTheDocument()

    taskMachines.resolve({ machines: [], selectedAgentId: null, unavailableSelection: null })
    mergeMachines.resolve({ machines: [], defaultAgentId: null })

    expect(await screen.findByTestId('merge-machines-empty')).toHaveTextContent('Нет доступных машин для merge')
    expect(screen.queryByTestId('merge-machines-skeleton-list')).not.toBeInTheDocument()
  })

  it('показывает ошибку обязательного запроса и позволяет повторить загрузку', async () => {
    window.ci!.getTaskMachines = vi.fn().mockRejectedValueOnce(new Error('network failed')).mockResolvedValue({
      machines: [{ agentId: 'm1', name: 'MacBook', online: true, personal: true, project: false, projectDefault: false }],
      selectedAgentId: null,
      unavailableSelection: null
    })

    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart onStartMerge={vi.fn()} />)

    const error = await screen.findByTestId('merge-machines-error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent('Не удалось загрузить машины для merge')
    expect(screen.queryByTestId('merge-machines-empty')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('option', { name: /MacBook/ })).toBeInTheDocument()
    expect(window.ci!.getTaskMachines).toHaveBeenCalledTimes(2)
  })

  it('запускает merge только на проверенной сервером машине', async () => {
    const started: (string | null)[] = []
    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart onStartMerge={(agentId) => started.push(agentId)} />)
    const select = await screen.findByLabelText('Машина merge-рана') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('m1'))
    fireEvent.click(screen.getByRole('button', { name: 'Мерж в main' }))
    expect(started).toEqual(['m1'])
    expect(screen.getByRole('group', { name: 'Мои машины' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Машины проекта' })).toBeInTheDocument()
    expect((screen.getByRole('option', { name: /Машина не в сети/ }) as HTMLOptionElement).disabled).toBe(true)
  })

  it('наследует машину завершённой попытки и передаёт её в retry', async () => {
    const previous = mergeRun()
    vi.spyOn(window.ci!, 'getMerge').mockResolvedValue(previous)
    vi.spyOn(window.ci!, 'listMergeRuns').mockResolvedValue([previous])
    const retry = vi.spyOn(window.ci!, 'retryMerge').mockResolvedValue(mergeRun({ id: 'run-2' }))
    render(<MergePanel projectId="p1" taskId="t1" runId="run-1" canStart={false} />)
    const select = await screen.findByLabelText('Машина повторного merge-рана') as HTMLSelectElement
    expect(select.value).toBe('m1')
    expect(screen.getByRole('option', { name: 'MacBook' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(retry).toHaveBeenCalledWith('run-1', 'm1', false))
  })

  it('позволяет сменить доступную машину перед retry', async () => {
    const previous = mergeRun()
    vi.spyOn(window.ci!, 'getMerge').mockResolvedValue(previous)
    vi.spyOn(window.ci!, 'listMergeRuns').mockResolvedValue([previous])
    const retry = vi.spyOn(window.ci!, 'retryMerge').mockResolvedValue(mergeRun({ id: 'run-2', agentId: 'm2', machineName: 'Server' }))
    window.ci!.getTaskMachines = vi.fn(async () => ({ machines: [
      { agentId: 'm1', name: 'MacBook', online: true, personal: true, project: false, projectDefault: false },
      { agentId: 'm2', name: 'Server', online: true, personal: false, project: true, projectDefault: true }
    ], selectedAgentId: null, unavailableSelection: null }))
    render(<MergePanel projectId="p1" taskId="t1" runId="run-1" canStart={false} />)
    const select = await screen.findByLabelText('Машина повторного merge-рана')
    fireEvent.change(select, { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(retry).toHaveBeenCalledWith('run-1', 'm2', false))
  })

  it('не позволяет менять машину активного merge-рана', async () => {
    const active = mergeRun({ status: 'checking', stage: 'checking', canRetry: false, canCancel: true, finishedAt: null })
    vi.spyOn(window.ci!, 'getMerge').mockResolvedValue(active)
    vi.spyOn(window.ci!, 'listMergeRuns').mockResolvedValue([active])
    render(<MergePanel projectId="p1" taskId="t1" runId="run-1" canStart={false} />)
    expect(await screen.findByText('MacBook')).toBeInTheDocument()
    expect(screen.queryByLabelText('Машина повторного merge-рана')).not.toBeInTheDocument()
  })

  it('показывает фактические provider/model Codex без предупреждения, когда fallback не было', async () => {
    const actual = mergeRun({ llmProvider: 'codex', llmModel: 'gpt-5.6-sol', requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-sol', llmFallbackReason: null })
    vi.spyOn(window.ci!, 'getMerge').mockResolvedValue(actual)
    vi.spyOn(window.ci!, 'listMergeRuns').mockResolvedValue([actual])
    render(<MergePanel projectId="p1" taskId="t1" runId="run-1" canStart={false} />)
    expect(await screen.findByText(/codex · gpt-5\.6-sol/)).toBeInTheDocument()
    expect(screen.queryByTestId('merge-llm-fallback')).not.toBeInTheDocument()
  })

  it('явно предупреждает о fallback и показывает исходно запрошенный Codex', async () => {
    const fallback = mergeRun({ llmProvider: 'claude', llmModel: 'sonnet', requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-sol', llmFallbackReason: 'provider_unavailable' })
    vi.spyOn(window.ci!, 'getMerge').mockResolvedValue(fallback)
    vi.spyOn(window.ci!, 'listMergeRuns').mockResolvedValue([fallback])
    render(<MergePanel projectId="p1" taskId="t1" runId="run-1" canStart={false} />)
    expect((await screen.findAllByText(/claude · sonnet/)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('merge-llm-fallback')).toHaveTextContent('был запрошен codex · gpt-5.6-sol')
  })

  it('показывает репозитории задачи по машинам с типом и состоянием', async () => {
    vi.spyOn(window.ci!, 'getTaskRepositories').mockResolvedValue([
      { id: 'r1', projectId: 'p1', taskId: 't1', agentId: 'm1', machineName: 'MacBook', path: '/repos/chatai/CHAT-1', kind: 'dev-workspace', state: 'active', createdAt: 1, deletedAt: null },
      { id: 'r2', projectId: 'p1', taskId: 't1', agentId: 'm2', machineName: 'Server', path: '/repos2/chatai/CHAT-1.merge-x', kind: 'merge-clone', state: 'deleted', createdAt: 2, deletedAt: 3 }
    ])
    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart={false} />)
    expect(await screen.findByText('/repos/chatai/CHAT-1')).toBeInTheDocument()
    expect(screen.getByText(/workspace разработки/)).toBeInTheDocument()
    // Удалённые копии скрыты по умолчанию и появляются за переключателем.
    expect(screen.queryByText('/repos2/chatai/CHAT-1.merge-x')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/показывать удалённые/))
    expect(screen.getByText('/repos2/chatai/CHAT-1.merge-x')).toBeInTheDocument()
    expect(screen.getByText(/merge-клон/)).toBeInTheDocument()
    expect(screen.getByText('удалён', { exact: true })).toBeInTheDocument()
    // Пустота merge-вкладки — общий экран карточки, а не пунктирная рамка.
    expect(screen.getByTestId('merge-runs-empty')).toHaveTextContent('Merge-ранов у задачи ещё не было')
  })
})
