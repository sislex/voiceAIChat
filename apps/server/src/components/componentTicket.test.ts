// Быстрый тикет: важна последовательность шагов и то, что рабочая копия возвращается
// на базовую ветку даже после отказа. Git и БД подменены — нас интересует сценарий,
// а не сами команды (они проверены в git/workspaceService.test.ts).
import { describe, expect, it, vi } from 'vitest'
import { ComponentTicketService, ticketBranchName } from './componentTicket.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'
import type { VoiceChatDb } from '../db/database.js'

function harness(overrides: { push?: () => never; commit?: () => never } = {}) {
  const calls: string[] = []
  const git = {
    resolve: () => ({ agentId: 'agent-1', path: '/repo', kind: 'project-worktree' }),
    createBranch: async (_u: string, _p: string, _w: string, name: string) => { calls.push(`branch:${name}`); return {} },
    commit: async (_u: string, _p: string, _w: string, input: { message: string; paths?: string[] }) => {
      calls.push(`commit:${input.message}:${(input.paths ?? []).join(',')}`)
      if (overrides.commit) overrides.commit()
      return { sha: 'sha-local', staged: 1, status: {} }
    },
    push: async (_u: string, _p: string, _w: string, branch?: string) => {
      calls.push(`push:${branch}`)
      if (overrides.push) overrides.push()
      return { sha: 'sha-remote', branch: branch ?? '', status: {} }
    },
    checkout: async (_u: string, _p: string, _w: string, branch: string) => { calls.push(`checkout:${branch}`); return {} }
  } as unknown as GitWorkspaceService

  const created: { branch?: string; sha?: string; pushed?: boolean } = {}
  const db = {
    projects: {
      getProject: () => ({ id: 'p1', name: 'Chat AI', gitUrl: 'git@example:repo.git', ciBaseBranch: 'main', ciBranchTemplate: undefined })
    },
    tasks: {
      getBoard: () => ({ columns: [{ id: 'col-wait', semanticType: 'awaiting_merge' }], tasks: [] }),
      createTask: () => ({ id: 'task-1', seq: 42, title: 'Кнопка шире' })
    },
    ci: {
      createCiWorkspace: () => ({ id: 'cw-1' }),
      updateCiWorkspaceRevision: (_id: string, branch: string, sha: string, pushed: boolean) => {
      created.branch = branch; created.sha = sha; created.pushed = pushed
    }
    }
  } as unknown as VoiceChatDb

  return { service: new ComponentTicketService({ db, git }), calls, created }
}

describe('ticketBranchName', () => {
  it('по умолчанию — ключ задачи, как в dev-ране', () => {
    expect(ticketBranchName(undefined, 'Chat AI', { seq: 42, title: 'Кнопка шире' })).toBe('CA-42')
  })

  it('поддерживает шаблон проекта со слагом', () => {
    expect(ticketBranchName('feat/{task_number}-{slug}', 'Chat AI', { seq: 7, title: 'Кнопка шире!' }))
      .toBe('feat/CA-7-кнопка-шире')
  })
})

describe('ComponentTicketService', () => {
  it('делает ветку, коммит, push, пишет ревизию и возвращает копию на main', async () => {
    const { service, calls, created } = harness()
    const result = await service.create('admin', 'p1', {
      workspaceId: 'project:agent-1', title: 'Кнопка шире', paths: ['src/Button.tsx', 'src/Button.tsx']
    })
    expect(calls).toEqual([
      'branch:CA-42',
      'commit:CA-42 Кнопка шире:src/Button.tsx',
      'push:CA-42',
      'checkout:main'
    ])
    expect(created).toEqual({ branch: 'CA-42', sha: 'sha-remote', pushed: true })
    expect(result).toMatchObject({ taskId: 'task-1', taskNumber: 42, columnId: 'col-wait', readyToMerge: true })
  })

  it('после отказа push всё равно возвращает копию на базовую ветку', async () => {
    const { service, calls } = harness({ push: () => { throw new GitError(409, 'push_rejected', 'origin отверг ветку') } })
    await expect(service.create('admin', 'p1', { workspaceId: 'project:agent-1', title: 'Кнопка', paths: ['a.tsx'] }))
      .rejects.toThrow('origin отверг ветку')
    expect(calls.at(-1)).toBe('checkout:main')
  })

  it('пустой список путей и пустое название отклоняются до создания задачи', async () => {
    const { service, calls } = harness()
    await expect(service.create('admin', 'p1', { workspaceId: 'project:agent-1', title: '  ', paths: ['a.tsx'] }))
      .rejects.toThrow('название')
    await expect(service.create('admin', 'p1', { workspaceId: 'project:agent-1', title: 'Правка', paths: [] }))
      .rejects.toThrow('Нечего коммитить')
    expect(calls).toEqual([])
  })

  it('без колонки «Ожидает слияния» задача не заводится', async () => {
    const patched = new ComponentTicketService({
      db: {
        tasks: {
          getBoard: () => ({ columns: [], tasks: [] })
        },
        projects: {
          getProject: () => ({ id: 'p1', name: 'Chat AI', gitUrl: 'git@example:repo.git' })
        }
      } as never,
      git: { resolve: () => ({ agentId: 'a', path: '/repo' }) } as never
    })
    await expect(patched.create('admin', 'p1', { workspaceId: 'project:a', title: 'Правка', paths: ['a.tsx'] }))
      .rejects.toThrow('Ожидает слияния')
  })

  it('без адреса репозитория ветку отправлять некуда', async () => {
    const service = new ComponentTicketService({
      db: {projects:{getProject: () => ({ id: 'p1', name: 'Chat AI', gitUrl: null })}} as never,
      git: { resolve: () => ({ agentId: 'a', path: '/repo' }) } as never
    })
    await expect(service.create('admin', 'p1', { workspaceId: 'project:a', title: 'Правка', paths: ['a.tsx'] }))
      .rejects.toThrow('адрес репозитория')
  })
})

describe('вызовы наружу', () => {
  it('создание задачи не идёт, пока не проверены права на копию', async () => {
    const createTask = vi.fn()
    const service = new ComponentTicketService({
      db: {tasks:{createTask}} as never,
      git: { resolve: () => { throw new GitError(403, 'read_only_machine', 'Машина только для чтения') } } as never
    })
    await expect(service.create('admin', 'p1', { workspaceId: 'project:a', title: 'Правка', paths: ['a.tsx'] }))
      .rejects.toThrow('только для чтения')
    expect(createTask).not.toHaveBeenCalled()
  })
})
