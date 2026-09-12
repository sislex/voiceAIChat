import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../../test/uiRender'
import { createFakeCi, type FakeCi } from '@voicechat/ui-foundation/test/fakeApi'
import type { MergeRun } from '@shared/merge'
import { NewTaskMergePanel } from './NewTaskMergePanel'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

function mergeRun(over: Partial<MergeRun>): MergeRun {
  return {
    id: 'm1', projectId: 'p1', taskId: 't1', status: 'success', triggeredBy: 'alex', sourceBranch: 'CHAT-445', targetBranch: 'main',
    sourceSha: 'a'.repeat(40), targetSha: 'b'.repeat(40), mergeSha: 'c'.repeat(40), revertSha: null, agentId: 'agent-1', machineName: 'MacBook',
    llmEngineId: null, llmProvider: 'claude', llmModel: 'opus', stage: 'success', stages: [], conflicts: [], conflictDetails: [], checks: [],
    log: '', createdAt: 100, startedAt: 100, finishedAt: 200, ...over
  } as unknown as MergeRun
}
const cycle: TaskReworkCycleViewModel = {
  id: 'c1', sequence: 1, description: 'Восстановление записи', criteria: [], makeSources: [], attachments: [],
  createdBy: 'alex', createdAt: 1_000, preparationRunId: null, status: 'submitted'
}
let ci: FakeCi
beforeEach(() => {
  ci = createFakeCi()
  ci.listMergeRuns = vi.fn(async () => [mergeRun({ id: 'm2', status: 'failed', createdAt: 2_000, conflicts: ['src/App.tsx'] }), mergeRun({})])
  ci.getMerge = vi.fn(async (runId: string) => mergeRun(runId === 'm2' ? { id: 'm2', status: 'failed', createdAt: 2_000, conflicts: ['src/App.tsx'] } : {}))
  window.ci = ci
})
afterEach(() => { delete (window as { ci?: unknown }).ci })

describe('NewTaskMergePanel', () => {
  it('проходы merge по циклам с проверками актуальности и конфликтов', async () => {
    render(<NewTaskMergePanel projectId="p1" taskId="t1" cycles={[cycle]} workflow={['Merge']} activeRunId={null} canStart={false} />)
    expect(await screen.findByText('2 прохода')).toBeTruthy()
    const first = screen.getByTestId('new-task-merge-stage-1')
    const second = screen.getByTestId('new-task-merge-stage-2')
    await waitFor(() => expect(first).toHaveTextContent('Влито в main'))
    expect(first).toHaveTextContent('без конфликтов')
    expect(second).toHaveTextContent('Merge · доработка 1')
    expect(second).toHaveTextContent('1 конфликт')
    expect(second).toHaveTextContent('Ошибка')
    // Панель merge стоит в выбранном (последнем) проходе.
    expect(second.querySelector('[data-testid="task-merge-panel"]')).toBeTruthy()
    expect(first.querySelector('[data-testid="task-merge-panel"]')).toBeNull()
  })

  it('запуск merge с выбранной машиной проходит через панель', async () => {
    ci.listMergeRuns = vi.fn(async () => [])
    ci.getTaskMachines = vi.fn(async () => ({ machines: [{ agentId: 'agent-1', name: 'MacBook', online: true, personal: true, project: true, projectDefault: true }], selectedAgentId: 'agent-1', unavailableSelection: null }) as never)
    ci.getMergeMachines = vi.fn(async () => ({ machines: [{ agentId: 'agent-1', readiness: { ready: true, selectable: true, message: 'готова', mode: 'workspace' } }], defaultAgentId: 'agent-1' }) as never)
    const start = vi.fn()
    render(<NewTaskMergePanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} activeRunId={null} canStart onStartMerge={start} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Мерж в main' }))
    expect(start).toHaveBeenCalledWith('agent-1')
  })
})
