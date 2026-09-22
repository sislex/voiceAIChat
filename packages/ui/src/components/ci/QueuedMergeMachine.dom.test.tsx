import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from "@voicechat/ui-foundation/test/uiRender"
import { expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { queuedMergeCi, queuedMergeRun, queuedMergeMachines } from '../../test/fixtures/queuedMerge'
import { MergePanel } from './MergePanel'
import { NewTaskMergePanel } from '../kanban/NewTaskMergePanel'
import type { ChangeMergeMachineResult, MergeRun } from '@shared/merge'

afterEach(() => { vi.restoreAllMocks() })
for (const surface of ['panel', 'card'] as const) {
  function mount() {
    return render(surface === 'panel'
      ? <MergePanel projectId="p1" taskId="t1" runId={queuedMergeRun.id} canStart={false} />
      : <NewTaskMergePanel projectId="p1" taskId="t1" cycles={[]} workflow={[]} activeRunId={queuedMergeRun.id} canStart={false} />)
  }
  describe(surface, () => {
    // @testCase TC-UI-01
    it('loads readiness, blocks duplicate submissions and applies the response without reload', async () => {
      const ci = queuedMergeCi(); window.ci = ci
      let resolve!: (value: ChangeMergeMachineResult) => void
      ci.changeMergeMachine = vi.fn(() => new Promise<ChangeMergeMachineResult>(done => { resolve = done }))
      const cancel = vi.spyOn(ci, 'cancelMerge'), retry = vi.spyOn(ci, 'retryMerge')
      mount()
      const select = await screen.findByRole('combobox', { name: 'Новая машина merge-рана' })
      await waitFor(() => expect(select).not.toBeDisabled())
      expect(select).toHaveValue('machine-a')
      await expectNoViolations()
      expect(within(select).getByRole('option', { name: /не в сети/ })).toBeDisabled()
      const button = screen.getByRole('button', { name: 'Сменить машину' })
      expect(button).toBeDisabled()
      fireEvent.change(select, { target: { value: 'machine-b' } })
      fireEvent.click(button); fireEvent.click(button)
      expect(ci.changeMergeMachine).toHaveBeenCalledTimes(1)
      expect(ci.changeMergeMachine).toHaveBeenCalledWith(queuedMergeRun.id, { agentId: 'machine-b', expectedAssignmentVersion: 0 })
      expect(select).toBeDisabled()
      await act(async () => resolve({ ok: true, run: { ...queuedMergeRun, agentId: 'machine-b', machineName: 'MacBook B', assignmentVersion: 1 } }))
      await waitFor(() => expect(select).toHaveValue('machine-b'))
      expect(screen.getByText('Машина изменена. Ран в очереди.')).toBeInTheDocument()
      expect(cancel).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled()
      await waitFor(() => expect(select).toHaveFocus())
      expect(screen.getByText('Existing merge history')).toBeInTheDocument()
    })

    // @testCase TC-UI-01
    it.each(['assignment_changed', 'not_queued', 'network', 'readiness'] as const)('handles %s and preserves a retryable selection', async failure => {
      const ci = queuedMergeCi(); window.ci = ci
      ci.changeMergeMachine = vi.fn(async (): Promise<ChangeMergeMachineResult> => {
        if (failure === 'network') throw new Error('Network failed')
        if (failure === 'readiness') return { ok: false, code: 'readiness_failed', error: 'Storage read-only' }
        return { ok: false, code: failure, error: failure === 'not_queued' ? 'Ран уже выполняется' : 'Назначение изменено другим клиентом',
          run: { ...queuedMergeRun, assignmentVersion: 1, ...(failure === 'not_queued' ? { status: 'checking' as const } : { agentId: 'offline' }) } }
      })
      mount()
      const select = await screen.findByRole('combobox', { name: 'Новая машина merge-рана' })
      await waitFor(() => expect(select).not.toBeDisabled())
      fireEvent.change(select, { target: { value: 'machine-b' } })
      fireEvent.click(screen.getByRole('button', { name: 'Сменить машину' }))
      await waitFor(() => expect(ci.changeMergeMachine).toHaveBeenCalledTimes(1))
      if (failure === 'not_queued') {
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Сменить машину' })).toBeNull())
        expect(screen.getAllByText('Ран уже выполняется').length).toBeGreaterThan(0)
      } else {
        await waitFor(() => expect(select).not.toBeDisabled())
        expect(select).toHaveValue(failure === 'assignment_changed' ? 'offline' : 'machine-b')
        expect(screen.queryByText('Ран уже выполняется')).toBeNull()
      }
    })

    // @testCase TC-INT-03
    it('applies realtime snapshots and reloads readiness and history on reconnect', async () => {
      const ci = queuedMergeCi(); window.ci = ci
      const listeners = new Set<(event: { runId: string; run: MergeRun }) => void>()
      ci.onMerge = callback => { listeners.add(callback); return () => { listeners.delete(callback) } }
      const originalBoard = window.board
      const reconnects: Array<() => void> = []
      window.board = { ...originalBoard, onReconnect: callback => { reconnects.push(callback); return () => {} } } as typeof window.board
      const readiness = vi.spyOn(ci, 'getMergeMachines')
      const history = vi.spyOn(ci, 'listMergeRuns')
      try {
        mount()
        await screen.findByRole('combobox', { name: 'Новая машина merge-рана' })
        const next = { ...queuedMergeRun, agentId: 'machine-b', machineName: 'MacBook B', assignmentVersion: 1 }
        ci.listMergeRuns = async () => [next]
        ci.getMerge = async () => next
        await act(async () => { listeners.forEach(callback => callback({ runId: next.id, run: next })) })
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Новая машина merge-рана' })).toHaveValue('machine-b'))
        const count = readiness.mock.calls.length
        await act(async () => { reconnects.forEach(callback => callback()) })
        await waitFor(() => expect(readiness.mock.calls.length).toBeGreaterThan(count))
        expect(history).toHaveBeenCalled()
      } finally { window.board = originalBoard }
    })

    // @testCase TC-INT-03
    it('keeps newer realtime assignment when an older successful response arrives', async () => {
      const ci = queuedMergeCi(); window.ci = ci
      const listeners = new Set<(event: { runId: string; run: MergeRun }) => void>()
      ci.onMerge = callback => { listeners.add(callback); return () => { listeners.delete(callback) } }
      let resolve!: (value: ChangeMergeMachineResult) => void
      ci.changeMergeMachine = vi.fn(() => new Promise<ChangeMergeMachineResult>(done => { resolve = done }))
      mount()
      const select = await screen.findByRole('combobox', { name: 'Новая машина merge-рана' })
      await waitFor(() => expect(select).not.toBeDisabled())
      fireEvent.change(select, { target: { value: 'machine-b' } })
      fireEvent.click(screen.getByRole('button', { name: 'Сменить машину' }))
      const next = { ...queuedMergeRun, assignmentVersion: 2 }
      ci.listMergeRuns = async () => [next]
      ci.getMerge = async () => next
      await act(async () => { listeners.forEach(callback => callback({ runId: next.id, run: next })) })
      await waitFor(() => expect(select).toHaveValue('machine-a'))
      await act(async () => resolve({ ok: true, run: { ...queuedMergeRun, agentId: 'machine-b', assignmentVersion: 1 } }))
      await waitFor(() => expect(select).not.toBeDisabled())
      expect(select).toHaveValue('machine-a')
      expect(screen.getByText('Состояние рана уже обновлено.')).toBeInTheDocument()
    })

    // @testCase TC-UI-01
    it('shows no alternative and disables the action when all other machines are unavailable', async () => {
      const ci = queuedMergeCi(); window.ci = ci
      ci.getMergeMachines = async () => ({ ...queuedMergeMachines, machines: queuedMergeMachines.machines.filter(machine => machine.agentId !== 'machine-b') })
      mount()
      expect(await screen.findByText('Нет другой готовой машины проекта.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Сменить машину' })).toBeDisabled()
    })
  })
}
