import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { MergePanel } from './MergePanel'
import { createFakeCi } from '../../test/fakeApi'
import type { MergeRun } from '@shared/merge'

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
  })

  it('запускает merge на машине workspace по умолчанию и на явно выбранной машине', async () => {
    const started: (string | null)[] = []
    render(<MergePanel projectId="p1" taskId="t1" runId={null} canStart onStartMerge={(agentId) => started.push(agentId)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Мерж в main' }))
    expect(started).toEqual([null])
    const select = await screen.findByLabelText('Машина merge-рана')
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(3))
    fireEvent.change(select, { target: { value: 'm1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Мерж в main' }))
    expect(started).toEqual([null, 'm1'])
    expect(screen.getByRole('group', { name: 'Мои машины' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Машины проекта' })).toBeInTheDocument()
    expect((screen.getByRole('option', { name: /офлайн/ }) as HTMLOptionElement).disabled).toBe(true)
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
    expect(screen.getByText('Merge-ранов у задачи ещё не было.')).toBeInTheDocument()
  })
})
