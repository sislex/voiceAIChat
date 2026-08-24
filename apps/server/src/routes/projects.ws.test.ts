import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { Board, ProjectDetail, ServerMessage } from '@voicechat/shared'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let port: number
let adminTok: string
let bobTok: string
/** Часы БД: тестам про скрытие завершённых нужно перевести их за полночь. */
let clock = Date.now()

beforeEach(async () => {
  clock = Date.now()
  db = new VoiceChatDb(':memory:', { now: () => clock })
  db.createUser('bob', '', 'developer')
  app = await buildServer({ config: loadConfig({ PORT: '0' }), db, sessionSecret: SECRET })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

function connect(token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`)
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws))
    ws.on('error', rej)
  })
}

/** Ждём лёгкую инвалидацию board.changed, иначе null по таймауту. */
function waitBoardChanged(ws: WebSocket, projectId: string, ms = 1000): Promise<Extract<ServerMessage, { t: 'board.changed' }> | null> {
  return new Promise((resolve) => {
    const onMsg = (d: Buffer) => {
      const m = JSON.parse(d.toString()) as ServerMessage
      if (m.t === 'board.changed' && m.projectId === projectId) {
        ws.off('message', onMsg)
        resolve(m)
      }
    }
    ws.on('message', onMsg)
    setTimeout(() => {
      ws.off('message', onMsg)
      resolve(null)
    }, ms)
  })
}

function waitNotificationInvalidation(ws: WebSocket, ms = 600): Promise<Extract<ServerMessage, { t: 'task-preparation.notifications.invalidate' }> | null> {
  return new Promise((resolve) => {
    const onMsg = (data: Buffer) => {
      const message = JSON.parse(data.toString()) as ServerMessage
      if (message.t !== 'task-preparation.notifications.invalidate') return
      ws.off('message', onMsg)
      resolve(message)
    }
    ws.on('message', onMsg)
    setTimeout(() => { ws.off('message', onMsg); resolve(null) }, ms)
  })
}

async function createProject(): Promise<ProjectDetail> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { authorization: `Bearer ${adminTok}` },
    payload: { name: 'P1' }
  })
  return res.json() as ProjectDetail
}

describe('WS: живое обновление доски', () => {
  it('участник получает board.changed без снапшота после мутации через REST', async () => {
    const p = await createProject()
    const auth = { authorization: `Bearer ${adminTok}` }
    const board = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board`, headers: auth })).json() as Board
    const ws = await connect(adminTok)
    ws.send(JSON.stringify({ t: 'board.subscribe', projectId: p.id }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const next = waitBoardChanged(ws, p.id)
    await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/tasks`,
      headers: auth,
      payload: { columnId: board.columns[0]!.id, title: 'Hello' }
    })
    const got = await next
    expect(got).toEqual({ t: 'board.changed', projectId: p.id })
    expect(got).not.toHaveProperty('board')
    ws.close()
  })

  it('подписка не отправляет начальный снапшот и не принимает фильтр', async () => {
    const p = await createProject()
    const ws = await connect(adminTok)
    const initial = waitBoardChanged(ws, p.id, 150)
    ws.send(JSON.stringify({ t: 'board.subscribe', projectId: p.id }))
    expect(await initial).toBeNull()

    const board = (await app.inject({
      method: 'GET', url: `/api/projects/${p.id}/board?includeCompleted=1`,
      headers: { authorization: `Bearer ${adminTok}` }
    })).json() as Board
    expect(board.columns.length).toBeGreaterThan(0)
    ws.close()
  })

  it('обновляет нормализованный результат после старта и отмены QA-рана', async () => {
    const p = await createProject()
    const auth = { authorization: `Bearer ${adminTok}` }
    const board = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board`, headers: auth })).json() as Board
    const column = board.columns.find((item) => item.semanticType === 'automated_qa')!
    const task = (await app.inject({ method: 'POST', url: `/api/projects/${p.id}/tasks`, headers: auth, payload: { columnId: column.id, title: 'QA realtime' } })).json() as { id: string }
    const ws = await connect(adminTok)
    ws.send(JSON.stringify({ t: 'board.subscribe', projectId: p.id }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const active = waitBoardChanged(ws, p.id)
    const started = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/tasks/${task.id}/qa/runs/automated_qa`, headers: auth })
    expect(started.statusCode).toBe(202)
    const run = started.json() as { id: string }
    expect(await active).toEqual({ t: 'board.changed', projectId: p.id })
    const activeBoard = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board`, headers: auth })).json() as Board
    expect(activeBoard.tasks.find((item) => item.id === task.id)?.latestRunResult).toMatchObject({ id: run.id, outcome: 'active' })

    const cancelled = waitBoardChanged(ws, p.id)
    expect((await app.inject({ method: 'DELETE', url: `/api/qa/runs/${run.id}`, headers: auth })).statusCode).toBe(200)
    expect(await cancelled).toEqual({ t: 'board.changed', projectId: p.id })
    const cancelledBoard = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board`, headers: auth })).json() as Board
    expect(cancelledBoard.tasks.find((item) => item.id === task.id)?.latestRunResult).toMatchObject({ id: run.id, outcome: 'cancelled' })
    ws.close()
  })

  it('адресует инвалидирование участникам и финально уведомляет удалённого участника', async () => {
    const p = await createProject()
    const admin = await connect(adminTok)
    const bob = await connect(bobTok)
    const outsiderEvent = waitNotificationInvalidation(bob)
    const adminEvent = waitNotificationInvalidation(admin)
    const board = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board`, headers: { authorization: `Bearer ${adminTok}` } })).json() as Board
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/tasks`, headers: { authorization: `Bearer ${adminTok}` }, payload: { columnId: board.columns[0]!.id, title: 'Invalidate' } })
    expect((await adminEvent)?.projectId).toBe(p.id)
    expect(await outsiderEvent).toBeNull()

    const added = waitNotificationInvalidation(bob)
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/members`, headers: { authorization: `Bearer ${adminTok}` }, payload: { username: 'bob' } })
    expect((await added)?.projectId).toBe(p.id)
    const removed = waitNotificationInvalidation(bob)
    await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}/members/bob`, headers: { authorization: `Bearer ${adminTok}` } })
    expect((await removed)?.projectId).toBe(p.id)
    admin.close()
    bob.close()
  })

  it('не-участник не получает board.changed по подписке', async () => {
    const p = await createProject()
    const ws = await connect(bobTok)
    const changed = waitBoardChanged(ws, p.id, 600)
    ws.send(JSON.stringify({ t: 'board.subscribe', projectId: p.id }))
    const board = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board`, headers: { authorization: `Bearer ${adminTok}` } })).json() as Board
    await app.inject({
      method: 'POST', url: `/api/projects/${p.id}/tasks`,
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { columnId: board.columns[0]!.id, title: 'secret' }
    })
    expect(await changed).toBeNull()
    ws.close()
  })
})
