import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { MergePanel } from './MergePanel'
import { createFakeCi } from '../../test/fakeApi'

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
