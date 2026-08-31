// Панель, привязанная к задаче или разговору, сама выбирает рабочую копию.
// Тесты про выбор: у задачи берётся её копия разработки (не merge-клон), а когда
// копии нет — экран объясняет, откуда она появится.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { makeGitBranches, makeGitDiff, makeGitFile, makeGitStatus, makeGitTree, makeGitWorkspace } from '../../test/fixtures/git'
import { GitTargetPane, pickGitWorkspace, type GitTargetPaneApi } from './GitTargetPane'
import type { GitWorkspaceRef } from '@shared/gitWorkspace'

const api = (workspaces: GitWorkspaceRef[]): GitTargetPaneApi => ({
  'projects:gitWorkspaces': vi.fn(async () => workspaces),
  'projects:gitStatus': vi.fn(async () => makeGitStatus()),
  'projects:gitBranches': vi.fn(async () => makeGitBranches()),
  'projects:gitDiff': vi.fn(async ({ path }: { path: string }) => makeGitDiff({ path })),
  'projects:gitTree': vi.fn(async () => makeGitTree()),
  'projects:gitFile': vi.fn(async ({ path }: { path: string }) => makeGitFile({ path })),
  'projects:gitSaveFile': vi.fn(),
  'projects:gitCheckout': vi.fn(),
  'projects:gitCreateBranch': vi.fn(),
  'projects:gitCommit': vi.fn(),
  'projects:gitPush': vi.fn()
}) as unknown as GitTargetPaneApi

describe('pickGitWorkspace', () => {
  const dev = makeGitWorkspace({ id: 'ws:1', taskId: 't1' })
  const clone = makeGitWorkspace({ id: 'repo:1', taskId: 't1', kind: 'merge-clone', writable: false })
  const released = makeGitWorkspace({ id: 'ws:0', taskId: 't1', released: true })
  const chat = makeGitWorkspace({ id: 'chat:c1', taskId: null, kind: 'chat-workspace', conversationId: 'c1' })

  it('у задачи берёт живую копию разработки, а не merge-клон', () => {
    expect(pickGitWorkspace([clone, released, dev], { taskId: 't1' })?.id).toBe('ws:1')
  })

  it('если живой копии нет — показывает освобождённую, чтобы объяснить, что случилось', () => {
    expect(pickGitWorkspace([clone, released], { taskId: 't1' })?.id).toBe('ws:0')
  })

  it('у разговора берёт его копию', () => {
    expect(pickGitWorkspace([dev, chat], { conversationId: 'c1' })?.id).toBe('chat:c1')
    expect(pickGitWorkspace([dev], { conversationId: 'c1' })).toBeNull()
  })

  it('чужие задачи не подставляются', () => {
    expect(pickGitWorkspace([dev], { taskId: 't2' })).toBeNull()
  })
})

describe('GitTargetPane', () => {
  it('находит копию задачи и открывает панель', async () => {
    render(<GitTargetPane projectId="p1" taskId="t1" api={api([makeGitWorkspace({ taskId: 't1' })])} />)
    expect(await screen.findByTestId('git-pane')).toBeInTheDocument()
    expect(await screen.findByTestId('git-change-list')).toBeInTheDocument()
  })

  it('без копии объясняет, что её создаст ран задачи', async () => {
    render(<GitTargetPane projectId="p1" taskId="t1" api={api([])} />)
    expect(await screen.findByText('Рабочей копии пока нет')).toBeInTheDocument()
    expect(screen.getByText(/ран задачи клонирует репозиторий/)).toBeInTheDocument()
  })

  it('у разговора без каталога — своя подсказка', async () => {
    render(<GitTargetPane projectId="p1" conversationId="c1" api={api([])} />)
    expect(await screen.findByText(/нет рабочего каталога с git/)).toBeInTheDocument()
  })

  it('ошибка списка даёт «Повторить»', async () => {
    const bridge = api([])
    ;(bridge['projects:gitWorkspaces'] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('HTTP 500'))
    render(<GitTargetPane projectId="p1" taskId="t1" api={bridge} />)
    expect(await screen.findByText('Не удалось найти рабочую копию')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })
})
