// Сервис git проверяется на фейковом runtime: настоящая машина и настоящий git тут не
// нужны, а вот отказы (занятый каталог, read-only машина, защищённая ветка, грязное
// дерево) нужны все — именно они защищают работу человека и целостность merge-рана.
import { describe, expect, it, vi } from 'vitest'
import type { VoiceChatDb } from '../db/database.js'
import { GitError, GitWorkspaceService, joinMachinePath, type GitRuntime } from './workspaceService.js'

const SHA = 'a'.repeat(40)
const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

/** Вывод статуса в том виде, в котором его печатает наш скрипт. */
function statusOutput(over: {
  repo?: string; head?: string; porcelain?: string; upstream?: string; track?: string; commits?: string
} = {}): string {
  return [
    '==VC:repo==', over.repo ?? 'true',
    '==VC:head==', over.head ?? SHA,
    '==VC:status_b64==', b64(over.porcelain ?? '## feature/x...origin/feature/x [ahead 1]\0 M src/a.ts\0'),
    '==VC:upstream==', over.upstream ?? 'origin/feature/x',
    '==VC:track==', over.track ?? '1\t0',
    '==VC:commits==', over.commits ?? `${SHA}\tbob\t1788172791\tfix: правка`,
    '==VC:done=='
  ].join('\n')
}

interface Fake {
  service: GitWorkspaceService
  security: Array<{ type: string; details: string }>
  exec: ReturnType<typeof vi.fn>
  fsWrite: ReturnType<typeof vi.fn>
  revisions: Array<{ id: string; branch: string; sha: string; pushed: boolean }>
  repositories: Array<{ agentId: string; path: string; kind: string }>
  events: Array<{ type: string; payload: Record<string, unknown> | undefined }>
}

function setup(options: {
  outputs?: Array<string | { output: string; exitCode: number }>
  workspaceState?: 'active' | 'released'
  activeCiRun?: { id: string; status: string } | null
  activeMergeRunId?: string | null
  online?: boolean
  canWrite?: boolean
  allowWrite?: boolean
  repositoryKind?: 'dev-workspace' | 'merge-clone'
  role?: 'admin' | 'developer' | 'tester' | 'observer'
  gate?: GitWorkspaceService extends never ? never : ((input: { command: string }) => { allowed: boolean; reason?: string })
  fsRead?: string
} = {}): Fake {
  const outputs = [...(options.outputs ?? [])]
  const revisions: Fake['revisions'] = []
  const repositories: Fake['repositories'] = []
  const events: Fake['events'] = []
  const security: Array<{ type: string; details: string }> = []
  const db = {
    getProject: () => ({ id: 'p1', gitUrl: 'https://github.com/x/y.git', ciBaseBranch: 'main', defaultAgentId: 'a1', machines: [{ agentId: 'a1' }], role: 'owner' }),
    getBoard: () => ({ columns: [], tasks: [{ id: 't1' }] }),
    listCiWorkspaceReport: () => [{ id: 'ws-1', agentId: 'a1' }],
    getCiWorkspaceById: (id: string) => id === 'ws-1'
      ? { id: 'ws-1', projectId: 'p1', taskId: 't1', agentId: 'a1', path: '/repo/task', branch: 'feature/x', commitSha: SHA, pushed: false, state: options.workspaceState ?? 'active' }
      : null,
    findActiveCiWorkspace: () => ({ id: 'ws-1', path: '/repo/task', branch: 'feature/x', commitSha: SHA, pushed: false }),
    getTaskRepositoryById: (id: string) => id === 'repo-1'
      ? { id: 'repo-1', projectId: 'p1', taskId: 't1', agentId: 'a1', machineName: 'Mac', path: '/repo/clone', kind: options.repositoryKind ?? 'merge-clone', state: 'active', createdAt: 1, deletedAt: null }
      : null,
    listTaskRepositories: () => [{ id: 'repo-1', state: 'active' }],
    getTaskDetail: () => ({ id: 't1', title: 'Панель кода', seq: 42, activeMergeRunId: options.activeMergeRunId ?? null }),
    activeCiRunForTask: () => options.activeCiRun ?? null,
    getConversation: () => ({ id: 'conv-1', title: 'Чат', projectId: 'p1', execTarget: 'a1', workdir: '/repo/chat', workspace: null }),
    getProjectMachine: () => ({ agentId: 'a1', path: '/repo/project', reposRoot: null, storageId: null, storageRoot: null, storageFormatVersion: null, directories: null }),
    getUser: () => ({ name: 'bob', email: 'bob@example.com', role: options.role ?? 'developer' }),
    canUseAgent: () => true,
    canWriteAgent: () => options.canWrite !== false,
    updateCiWorkspaceRevision: (id: string, branch: string, sha: string, pushed: boolean) => revisions.push({ id, branch, sha, pushed }),
    upsertTaskRepository: (_p: string, _t: string, agentId: string, path: string, kind: string) => repositories.push({ agentId, path, kind }),
    addCiEvent: (args: { type: string; payload?: Record<string, unknown> }) => events.push({ type: args.type, payload: args.payload }),
    logSecurityEvent: (event: { type: string; details?: string }) => security.push({ type: event.type, details: event.details ?? '' })
  }
  const exec = vi.fn(async () => {
    const item = outputs.shift() ?? ''
    const spec = typeof item === 'string' ? { output: item, exitCode: 0 } : item
    return { ...spec, timedOut: false }
  })
  const fsWrite = vi.fn(async () => ({}))
  const runtime: GitRuntime = {
    exec: exec as unknown as GitRuntime['exec'],
    fsRead: async () => ({ dataBase64: b64(options.fsRead ?? 'текущее содержимое\n') }) as never,
    fsWrite: fsWrite as unknown as GitRuntime['fsWrite'],
    isOnline: () => options.online !== false,
    policyOf: () => ({ allowedDirs: [], denyPatterns: [], allowPatterns: [], allowNetwork: true, allowWrite: options.allowWrite !== false, skills: [] }) as never,
    platformOf: () => 'linux',
    nameOf: () => 'Mac'
  }
  const service = new GitWorkspaceService({
    db: db as unknown as VoiceChatDb,
    runtime,
    ...(options.gate ? { gate: options.gate as never } : {}),
    now: () => 1000
  })
  return { service, exec, fsWrite, revisions, repositories, events, security }
}

const expectGitError = async (promise: Promise<unknown>, code: string, status?: number): Promise<GitError> => {
  const error = await promise.then(() => null, (err: unknown) => err)
  expect(error, `ожидали GitError ${code}`).toBeInstanceOf(GitError)
  const gitError = error as GitError
  expect(gitError.code).toBe(code)
  if (status !== undefined) expect(gitError.status).toBe(status)
  return gitError
}

describe('резолвер рабочих копий', () => {
  it('список собирается из БД без единого обращения к машине', () => {
    const { service, exec } = setup()
    const refs = service.listWorkspaces('bob', 'p1')
    expect(exec).not.toHaveBeenCalled()
    expect(refs.map((ref) => ref.id)).toEqual(['ws:ws-1', 'repo:repo-1', 'project:a1'])
    expect(refs[0]).toMatchObject({ kind: 'task-workspace', taskTitle: 'Панель кода', taskSeq: 42, path: '/repo/task', expectedBranch: 'feature/x' })
    expect(refs[1]).toMatchObject({ kind: 'merge-clone', writable: false })
  })

  it('неизвестный id — 404, а форма «путь на машине» не парсится вовсе', async () => {
    const { service } = setup()
    await expectGitError(Promise.resolve().then(() => service.resolve('bob', 'p1', 'ws:нет-такого', { write: false })), 'workspace_not_found', 404)
    await expectGitError(Promise.resolve().then(() => service.resolve('bob', 'p1', 'machine:a1:/etc', { write: false })), 'workspace_not_found', 404)
  })

  it('офлайн-машина отклоняется до похода за данными', async () => {
    const { service, exec } = setup({ online: false })
    await expectGitError(service.status('bob', 'p1', 'ws:ws-1'), 'machine_offline', 409).catch(() => {})
    const status = await service.status('bob', 'p1', 'ws:ws-1')
    expect(status.problem).toBe('machine_offline')
    expect(exec).not.toHaveBeenCalled()
  })

  it('на запись: занятый раном каталог, освобождённая копия, merge-клон и read-only машина', async () => {
    await expectGitError(
      Promise.resolve().then(() => setup({ activeCiRun: { id: 'run-1', status: 'running' } }).service.resolve('bob', 'p1', 'ws:ws-1', { write: true })),
      'workspace_busy', 409
    )
    await expectGitError(
      Promise.resolve().then(() => setup({ activeMergeRunId: 'merge-1' }).service.resolve('bob', 'p1', 'ws:ws-1', { write: true })),
      'workspace_busy', 409
    )
    await expectGitError(
      Promise.resolve().then(() => setup({ workspaceState: 'released' }).service.resolve('bob', 'p1', 'ws:ws-1', { write: true })),
      'workspace_released', 409
    )
    await expectGitError(
      Promise.resolve().then(() => setup().service.resolve('bob', 'p1', 'repo:repo-1', { write: true })),
      'read_only_workspace', 403
    )
    await expectGitError(
      Promise.resolve().then(() => setup({ canWrite: false }).service.resolve('bob', 'p1', 'ws:ws-1', { write: true })),
      'read_only_machine', 403
    )
    await expectGitError(
      Promise.resolve().then(() => setup({ allowWrite: false }).service.resolve('bob', 'p1', 'ws:ws-1', { write: true })),
      'read_only_machine', 403
    )
  })

  it('чтение занятого раном каталога разрешено: смотреть, что делает модель, полезно', async () => {
    const { service } = setup({ activeCiRun: { id: 'run-1', status: 'running' }, outputs: [statusOutput()] })
    const status = await service.status('bob', 'p1', 'ws:ws-1')
    expect(status.problem).toBeNull()
    expect(status.ref?.busy).toEqual({ kind: 'ci', runId: 'run-1', status: 'running' })
  })
})

describe('статус', () => {
  it('разбирает составной вывод одной команды', async () => {
    const { service, exec } = setup({ outputs: [statusOutput()] })
    const status = await service.status('bob', 'p1', 'ws:ws-1')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(status).toMatchObject({
      problem: null, branch: 'feature/x', detached: false, head: SHA,
      upstream: 'origin/feature/x', ahead: 1, behind: 0, baseBranch: 'main',
      gitUrl: 'https://github.com/x/y.git'
    })
    expect(status.changes).toEqual([{ path: 'src/a.ts', oldPath: null, state: 'modified', staged: false, worktree: true }])
    expect(status.commitsAhead).toEqual([{ sha: SHA, author: 'bob', at: 1788172791, subject: 'fix: правка' }])
  })

  it('каталог без репозитория — это проблема, а не пустой список изменений', async () => {
    const { service } = setup({ outputs: [['==VC:repo==', 'fatal: not a git repository', '==VC:done=='].join('\n')] })
    const status = await service.status('bob', 'p1', 'ws:ws-1')
    expect(status.problem).toBe('not_a_repository')
    expect(status.detail).toContain('not a git repository')
  })

  it('detached HEAD распознаётся, отсутствующий upstream не ломает разбор', async () => {
    const { service } = setup({
      outputs: [statusOutput({ porcelain: '## HEAD (no branch)\0', upstream: "fatal: no upstream configured for branch 'x'", track: 'fatal: no upstream' })]
    })
    const status = await service.status('bob', 'p1', 'ws:ws-1')
    expect(status.detached).toBe(true)
    expect(status.branch).toBeNull()
    expect(status.upstream).toBeNull()
    expect(status.ahead).toBe(0)
  })

  it('освобождённая копия не опрашивает машину', async () => {
    const { service, exec } = setup({ workspaceState: 'released' })
    const status = await service.status('bob', 'p1', 'ws:ws-1')
    expect(status.problem).toBe('workspace_released')
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('файлы и сравнение', () => {
  it('файл из ревизии читается через git, рабочая копия — через fs-канал', async () => {
    const { service } = setup({
      outputs: [['==VC:size==', '18', '==VC:content_b64==', b64('старое содержимое'), '==VC:done=='].join('\n')]
    })
    const fromRef = await service.file('bob', 'p1', 'ws:ws-1', 'src/a.ts', 'HEAD')
    expect(fromRef).toMatchObject({ ref: 'HEAD', content: 'старое содержимое', binary: false })
    const working = await setup({ fsRead: 'новое содержимое' }).service.file('bob', 'p1', 'ws:ws-1', 'src/a.ts')
    expect(working).toMatchObject({ ref: null, content: 'новое содержимое' })
  })

  it('у нового файла нет левой стороны, у удалённого — правой', async () => {
    const untracked = setup({
      outputs: [statusOutput({ porcelain: '## main\0?? src/new.ts\0' })]
    })
    const diffNew = await untracked.service.diff('bob', 'p1', 'ws:ws-1', 'src/new.ts')
    expect(diffNew.state).toBe('untracked')
    expect(diffNew.original).toBeNull()
    expect(diffNew.modified?.content).toBe('текущее содержимое\n')

    const deleted = setup({
      outputs: [
        statusOutput({ porcelain: '## main\0 D src/gone.ts\0' }),
        ['==VC:size==', '5', '==VC:content_b64==', b64('было\n'), '==VC:done=='].join('\n')
      ]
    })
    const diffGone = await deleted.service.diff('bob', 'p1', 'ws:ws-1', 'src/gone.ts')
    expect(diffGone.state).toBe('deleted')
    expect(diffGone.original?.content).toBe('было\n')
    expect(diffGone.modified).toBeNull()
  })

  it('путь наружу репозитория отклоняется до обращения к машине', async () => {
    const { service, exec, fsWrite } = setup()
    await expectGitError(service.file('bob', 'p1', 'ws:ws-1', '../../etc/passwd'), 'invalid_path', 400)
    await expectGitError(service.saveFile('bob', 'p1', 'ws:ws-1', '../../etc/passwd', 'x'), 'invalid_path', 400)
    expect(exec).not.toHaveBeenCalled()
    expect(fsWrite).not.toHaveBeenCalled()
  })

  it('запись идёт по абсолютному пути внутри рабочей копии', async () => {
    const { service, fsWrite } = setup({ outputs: [statusOutput()] })
    const result = await service.saveFile('bob', 'p1', 'ws:ws-1', 'src/a.ts', 'новый текст')
    expect(fsWrite).toHaveBeenCalledWith('a1', '/repo/task/src/a.ts', Buffer.from('новый текст', 'utf8').toString('base64'))
    expect(result.file.size).toBe(Buffer.byteLength('новый текст'))
    expect(result.status.problem).toBeNull()
  })

  it('путь склеивается по правилам машины', () => {
    expect(joinMachinePath('/repo/task/', 'src/a.ts')).toBe('/repo/task/src/a.ts')
    expect(joinMachinePath('C:\\repo', 'src/a.ts', 'win32')).toBe('C:\\repo\\src\\a.ts')
  })
})

describe('ветки', () => {
  it('грязное дерево без явного согласия не переключается', async () => {
    const { service, exec } = setup({ outputs: [statusOutput()] })
    const error = await expectGitError(service.checkout('bob', 'p1', 'ws:ws-1', 'main', false), 'dirty_worktree', 409)
    expect(error.message).toContain('1 незакоммиченных')
    // Один вызов — только статус: сам checkout не запускался.
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('с согласием переключается, а отсутствующая локально ветка создаётся из origin', async () => {
    const { service } = setup({
      outputs: [
        statusOutput(),
        ['==VC:mode==', 'remote', '==VC:done=='].join('\n'),
        statusOutput({ porcelain: '## other...origin/other\0' })
      ]
    })
    const result = await service.checkout('bob', 'p1', 'ws:ws-1', 'other', true)
    expect(result.createdLocal).toBe(true)
    expect(result.status.branch).toBe('other')
  })

  it('отказ git на конфликтующих правках переводится в понятный код', async () => {
    const { service } = setup({
      outputs: [
        statusOutput({ porcelain: '## main\0' }),
        { output: 'error: Your local changes to the following files would be overwritten by checkout', exitCode: 1 }
      ]
    })
    await expectGitError(service.checkout('bob', 'p1', 'ws:ws-1', 'other', true), 'dirty_worktree', 409)
  })

  it('имя ветки проверяется до отправки на машину', async () => {
    const { service, exec } = setup()
    await expectGitError(service.checkout('bob', 'p1', 'ws:ws-1', 'x; rm -rf /', false), 'invalid_branch', 400)
    await expectGitError(service.createBranch('bob', 'p1', 'ws:ws-1', '--force', undefined), 'invalid_branch', 400)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('коммит', () => {
  it('создаёт коммит и запоминает ревизию как ещё не отправленную', async () => {
    const { service, revisions, events } = setup({
      outputs: [
        statusOutput(),
        ['==VC:add==', '==VC:commit==', '[feature/x abc1234] fix', '==VC:sha==', SHA, '==VC:done=='].join('\n'),
        statusOutput({ porcelain: '## feature/x...origin/feature/x [ahead 2]\0' })
      ]
    })
    const result = await service.commit('bob', 'p1', 'ws:ws-1', { message: 'fix: правка', paths: ['src/a.ts'] })
    expect(result).toMatchObject({ sha: SHA, staged: 1 })
    // pushed=false обязателен: merge-ран берёт источник из pushed-записи, и «ещё не
    // отправленный» коммит не должен им притворяться.
    expect(revisions).toEqual([{ id: 'ws-1', branch: 'feature/x', sha: SHA, pushed: false }])
    expect(events.map((event) => event.type)).toContain('git.commit')
  })

  it('пустое сообщение, отсутствие файлов и чистое дерево — отказ без обращения к git', async () => {
    await expectGitError(setup().service.commit('bob', 'p1', 'ws:ws-1', { message: '   ', paths: ['a'] }), 'invalid_message', 400)
    await expectGitError(setup().service.commit('bob', 'p1', 'ws:ws-1', { message: 'm', paths: [] }), 'nothing_to_commit', 400)
    const clean = setup({ outputs: [statusOutput({ porcelain: '## main\0' })] })
    await expectGitError(clean.service.commit('bob', 'p1', 'ws:ws-1', { message: 'm', all: true }), 'nothing_to_commit', 409)
  })
})

describe('push', () => {
  it('отправляет ветку, сверяет SHA в origin и обновляет данные для merge-рана', async () => {
    const { service, revisions, repositories } = setup({
      outputs: [
        statusOutput(),
        ['==VC:head==', SHA, '==VC:push==', 'ok', '==VC:remote==', SHA, '==VC:done=='].join('\n'),
        statusOutput()
      ]
    })
    const result = await service.push('bob', 'p1', 'ws:ws-1')
    expect(result).toMatchObject({ branch: 'feature/x', sha: SHA })
    expect(revisions).toEqual([{ id: 'ws-1', branch: 'feature/x', sha: SHA, pushed: true }])
    expect(repositories).toEqual([{ agentId: 'a1', path: '/repo/task', kind: 'dev-workspace' }])
  })

  it('в main, master и release/* панель не пушит', async () => {
    for (const branch of ['main', 'master', 'release/0.1.180']) {
      const { service } = setup({ outputs: [statusOutput()] })
      await expectGitError(service.push('bob', 'p1', 'ws:ws-1', branch), 'protected_branch', 403)
    }
  })

  it('SHA в origin не совпал — считаем отправку неподтверждённой', async () => {
    const { service, revisions } = setup({
      outputs: [
        statusOutput(),
        ['==VC:head==', SHA, '==VC:push==', 'ok', '==VC:remote==', 'b'.repeat(40), '==VC:done=='].join('\n')
      ]
    })
    await expectGitError(service.push('bob', 'p1', 'ws:ws-1'), 'push_not_confirmed', 409)
    expect(revisions).toEqual([])
  })

  it('отказ origin и отсутствие credential различаются в кодах', async () => {
    const rejected = setup({
      outputs: [statusOutput(), { output: '! [rejected] feature/x -> feature/x (non-fast-forward)', exitCode: 1 }]
    })
    await expectGitError(rejected.service.push('bob', 'p1', 'ws:ws-1'), 'push_rejected', 409)
    const noCreds = setup({
      outputs: [statusOutput(), { output: 'fatal: could not read Username for https://github.com: terminal prompts disabled', exitCode: 128 }]
    })
    await expectGitError(noCreds.service.push('bob', 'p1', 'ws:ws-1'), 'git_credentials_missing', 409)
  })

  it('в detached HEAD отправлять нечего', async () => {
    const { service } = setup({ outputs: [statusOutput({ porcelain: '## HEAD (no branch)\0' })] })
    await expectGitError(service.push('bob', 'p1', 'ws:ws-1'), 'detached_head', 409)
  })
})

describe('гейт команд', () => {
  it('deny-паттерн проекта или роли запрещает даже чтение', async () => {
    const { service, exec } = setup({ gate: () => ({ allowed: false, reason: 'git запрещён политикой проекта' }) })
    const error = await expectGitError(service.status('bob', 'p1', 'ws:ws-1'), 'command_denied', 403).catch(async () => {
      // status превращает 409 в problem, а 403 обязан дойти как ошибка.
      return null
    })
    expect(error?.message).toContain('политикой проекта')
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('право роли и причина «только чтение»', () => {
  it('роль без repository:write не пускает к записи и объясняет причину', async () => {
    for (const role of ['tester', 'observer'] as const) {
      const { service } = setup({ role })
      const error = await expectGitError(
        Promise.resolve().then(() => service.resolve('bob', 'p1', 'ws:ws-1', { write: true })),
        'read_only_machine', 403
      )
      expect(error.message, role).toContain('роль')
    }
  })

  it('developer и admin пишут; причина в статусе пустая', async () => {
    for (const role of ['developer', 'admin'] as const) {
      const { service } = setup({ role, outputs: [statusOutput()] })
      const status = await service.status('bob', 'p1', 'ws:ws-1')
      expect(status.ref?.writable, role).toBe(true)
      expect(status.ref?.readOnlyReason, role).toBeNull()
    }
  })

  it('read-only шаринг машины и запрет политики различаются в тексте', async () => {
    const shared = setup({ canWrite: false, outputs: [statusOutput()] })
    expect((await shared.service.status('bob', 'p1', 'ws:ws-1')).ref?.readOnlyReason).toContain('только для чтения')
    const policy = setup({ allowWrite: false, outputs: [statusOutput()] })
    expect((await policy.service.status('bob', 'p1', 'ws:ws-1')).ref?.readOnlyReason).toContain('Политика машины')
  })

  it('merge-клон объясняет, что им управляет merge-ран', async () => {
    const { service } = setup()
    const refs = service.listWorkspaces('bob', 'p1')
    expect(refs.find((ref) => ref.kind === 'merge-clone')?.readOnlyReason).toContain('merge-ран')
  })
})

describe('подтягивание origin', () => {
  it('перебазирует ветку и считает, сколько коммитов приехало', async () => {
    const { service, security } = setup({
      outputs: [
        statusOutput({ porcelain: '## feature/x...origin/feature/x [behind 2]\0', track: '0\t2' }),
        ['==VC:before==', SHA, '==VC:fetch==', '==VC:combine==', 'Successfully rebased', '==VC:after==', 'b'.repeat(40), '==VC:done=='].join('\n'),
        statusOutput({ porcelain: '## feature/x...origin/feature/x [ahead 2]\0', track: '2\t0' })
      ]
    })
    const result = await service.pull('bob', 'p1', 'ws:ws-1')
    expect(result).toMatchObject({ mode: 'rebase', pulled: 2 })
    expect(security.map((event) => event.type)).toContain('git_workspace_mutation')
  })

  it('на грязном дереве не запускается вовсе', async () => {
    const { service, exec } = setup({ outputs: [statusOutput()] })
    const error = await expectGitError(service.pull('bob', 'p1', 'ws:ws-1'), 'dirty_worktree', 409)
    expect(error.message).toContain('закоммитьте')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('ветки нет в origin — говорим отправить её, а не «ошибка git»', async () => {
    const { service } = setup({
      outputs: [
        statusOutput({ porcelain: '## feature/x\0' }),
        ['==VC:before==', SHA, '==VC:fetch==', '==VC:combine==', 'no-upstream', '==VC:after==', SHA, '==VC:done=='].join('\n')
      ]
    })
    await expectGitError(service.pull('bob', 'p1', 'ws:ws-1'), 'unknown_ref', 409)
  })

  it('конфликт при rebase возвращается как отказ, рабочая копия не остаётся в середине', async () => {
    const { service } = setup({
      outputs: [
        statusOutput({ porcelain: '## feature/x...origin/feature/x [behind 1]\0' }),
        { output: 'CONFLICT (content): Merge conflict in src/a.ts', exitCode: 65 }
      ]
    })
    await expectGitError(service.pull('bob', 'p1', 'ws:ws-1'), 'git_failed', 409)
  })

  it('в detached HEAD подтягивать нечего', async () => {
    const { service } = setup({ outputs: [statusOutput({ porcelain: '## HEAD (no branch)\0' })] })
    await expectGitError(service.pull('bob', 'p1', 'ws:ws-1'), 'detached_head', 409)
  })
})

describe('отбрасывание правок', () => {
  it('возвращает отслеживаемые файлы и удаляет новые, считая их отдельно', async () => {
    const { service, security } = setup({
      outputs: [
        statusOutput({ porcelain: '## feature/x\0 M src/a.ts\0?? src/new.ts\0' }),
        ['==VC:revert==', '==VC:clean==', 'Removing src/new.ts', '==VC:done=='].join('\n'),
        statusOutput({ porcelain: '## feature/x\0' })
      ]
    })
    const result = await service.discard('bob', 'p1', 'ws:ws-1', ['src/a.ts', 'src/new.ts'], 'feature/x')
    expect(result).toMatchObject({ reverted: 1, removed: 1 })
    expect(security.some((event) => event.details.includes('git.discard'))).toBe(true)
  })

  it('без совпадения подтверждения ничего не выполняется', async () => {
    const { service, exec } = setup({ outputs: [statusOutput()] })
    const error = await expectGitError(
      service.discard('bob', 'p1', 'ws:ws-1', ['src/a.ts'], 'не-та-ветка'), 'confirmation_mismatch', 409
    )
    expect(error.message).toContain('feature/x')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('файл без изменений отбросить нельзя: это была бы тихая потеря чужой работы', async () => {
    const { service } = setup({ outputs: [statusOutput()] })
    await expectGitError(
      service.discard('bob', 'p1', 'ws:ws-1', ['src/чужой.ts'], 'feature/x'), 'nothing_to_discard', 409
    )
  })

  it('путь наружу репозитория отклоняется', async () => {
    const { service } = setup({ outputs: [statusOutput()] })
    await expectGitError(
      service.discard('bob', 'p1', 'ws:ws-1', ['../../etc/passwd'], 'feature/x'), 'invalid_path', 400
    )
  })
})

describe('аудит', () => {
  it('каждая мутация пишется и в события проекта, и в журнал безопасности', async () => {
    const { service, events, security } = setup({
      outputs: [
        statusOutput(),
        ['==VC:add==', '==VC:commit==', 'ok', '==VC:sha==', SHA, '==VC:done=='].join('\n'),
        statusOutput()
      ]
    })
    await service.commit('bob', 'p1', 'ws:ws-1', { message: 'fix', paths: ['src/a.ts'] })
    expect(events.map((event) => event.type)).toContain('git.commit')
    expect(security).toHaveLength(1)
    expect(security[0]!.type).toBe('git_workspace_mutation')
    expect(security[0]!.details).toContain('git.commit')
    expect(security[0]!.details).toContain('/repo/task')
  })
})
