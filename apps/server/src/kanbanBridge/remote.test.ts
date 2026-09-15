// Удалённый `KanbanService` у ядра: события канбана воспроизводятся на локальных лентах, снимок рана и
// boardChanged уходят RPC в процесс канбана, снимок машин — пушем.
import { describe, expect, it, vi } from 'vitest'
import { KANBAN_INTERNAL_MACHINES_PATH, KANBAN_INTERNAL_SERVICE_PATH } from '../kanban/internal.js'
import { createRemoteKanban } from './remote.js'

function fakeFetch(handler: (url: string, body: unknown) => unknown): { fetchImpl: typeof fetch; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, body })
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
    return new Response(JSON.stringify(handler(url, body)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('createRemoteKanban', () => {
  it('apply раздаёт события по лентам с тем же контрактом, что BoardHub/NotificationHub', async () => {
    const remote = createRemoteKanban({ kanbanUrl: 'http://kanban', token: 'tok', fetchImpl: fakeFetch(() => ({ result: null })).fetchImpl })
    const frames = vi.fn(); const board = vi.fn(); const prep = vi.fn(); const repos = vi.fn(); const qa = vi.fn(); const impr = vi.fn(); const notes = vi.fn()
    const off = remote.service.runs.subscribe(frames)
    remote.service.board.subscribe(board)
    remote.service.board.subscribePreparationRuns(prep)
    remote.service.board.subscribeTaskRepositories(async (u) => { repos(u) })
    remote.service.board.subscribeQaStages(async (u) => { qa(u) })
    remote.service.board.subscribeImprovements(impr)
    remote.service.notifications.subscribe(async (e) => { notes(e) })
    remote.apply({ kind: 'frame', message: { t: 'board.changed', projectId: 'p' }, userId: 'ann' })
    remote.apply({ kind: 'board', projectId: 'p' })
    remote.apply({ kind: 'preparationRun', update: { userId: 'ann', projectId: 'p', taskId: 't', runId: 'r' } })
    remote.apply({ kind: 'taskRepositories', update: { projectId: 'p', taskId: 't' } })
    remote.apply({ kind: 'qaStage', update: { projectId: 'p', taskId: 't', stage: 'component' as never } })
    remote.apply({ kind: 'improvements', projectId: 'p' })
    const releases = vi.fn(); remote.service.board.subscribeReleases(async (u) => { releases(u) })
    remote.apply({ kind: 'release', update: { projectId: 'p', releaseId: 'rel', status: 'released' } })
    expect(releases).toHaveBeenCalledWith({ projectId: 'p', releaseId: 'rel', status: 'released' })
    remote.apply({ kind: 'notification', event: { projectId: 'p', kind: 'membership' } })
    expect(frames).toHaveBeenCalledWith({ t: 'board.changed', projectId: 'p' }, 'ann')
    expect(board).toHaveBeenCalledWith('p')
    expect(prep).toHaveBeenCalledWith({ userId: 'ann', projectId: 'p', taskId: 't', runId: 'r' })
    expect(repos).toHaveBeenCalledWith({ projectId: 'p', taskId: 't' })
    expect(qa).toHaveBeenCalledWith({ projectId: 'p', taskId: 't', stage: 'component' })
    expect(impr).toHaveBeenCalledWith('p')
    expect(notes).toHaveBeenCalledWith({ projectId: 'p', kind: 'membership' })
    off()
    remote.apply({ kind: 'frame', message: { t: 'board.changed', projectId: 'p' }, userId: 'ann' })
    expect(frames).toHaveBeenCalledTimes(1)
  })

  it('snapshot, boardChanged и обратные вызовы тоннелей — RPC к канбану; машины — POST снимка', async () => {
    const { fetchImpl, calls } = fakeFetch((url, body) => {
      const { method } = body as { method: string }
      if (url.endsWith(KANBAN_INTERNAL_MACHINES_PATH)) return { ok: true }
      if (method === 'snapshot') return { result: { t: 'ci.run', runId: 'r', run: {} } }
      if (method === 'authorizeTunnel') return { result: true }
      if (method === 'previews') return { result: [{ id: 'env-1', projectId: 'p' }] }
      return { result: null }
    })
    const remote = createRemoteKanban({ kanbanUrl: 'http://kanban/', token: 'tok', fetchImpl })
    expect(await remote.service.runs.snapshot('ann', 'r')).toEqual({ t: 'ci.run', runId: 'r', run: {} })
    remote.service.board.changed('p')
    expect(await remote.tunnels.authorize('t1')).toBe(true)
    await remote.tunnels.closed('t1')
    expect(await remote.service.previews.list()).toEqual([{ id: 'env-1', projectId: 'p' }])
    await remote.pushMachines([{ id: 'm' }])
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.map((c) => c.url)).toEqual([
      `http://kanban${KANBAN_INTERNAL_SERVICE_PATH}`, `http://kanban${KANBAN_INTERNAL_SERVICE_PATH}`, `http://kanban${KANBAN_INTERNAL_SERVICE_PATH}`,
      `http://kanban${KANBAN_INTERNAL_SERVICE_PATH}`, `http://kanban${KANBAN_INTERNAL_SERVICE_PATH}`, `http://kanban${KANBAN_INTERNAL_MACHINES_PATH}`
    ])
    expect(calls.map((c) => (c.body as { method?: string }).method ?? 'machines')).toEqual(['snapshot', 'boardChanged', 'authorizeTunnel', 'tunnelClosed', 'previews', 'machines'])
    expect(calls[5]!.body).toEqual({ machines: [{ id: 'm' }] })
  })
})
