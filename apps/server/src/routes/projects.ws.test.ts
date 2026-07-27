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

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  db.createUser('bob', '', 'user')
  app = await buildServer({ config: loadConfig({ PORT: '0' }), db, sessionSecret: SECRET })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'user' }, SECRET)
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

/** Ждём board.update, удовлетворяющий предикату, иначе null по таймауту. */
function waitBoard(ws: WebSocket, pred: (b: Board) => boolean, ms = 1000): Promise<Board | null> {
  return new Promise((resolve) => {
    const onMsg = (d: Buffer) => {
      const m = JSON.parse(d.toString()) as ServerMessage
      if (m.t === 'board.update' && pred(m.board)) {
        ws.off('message', onMsg)
        resolve(m.board)
      }
    }
    ws.on('message', onMsg)
    setTimeout(() => {
      ws.off('message', onMsg)
      resolve(null)
    }, ms)
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
  it('участник получает board.update после мутации через REST', async () => {
    const p = await createProject()
    const ws = await connect(adminTok)
    // initial snapshot по подписке
    const initial = waitBoard(ws, () => true)
    ws.send(JSON.stringify({ t: 'board.subscribe', projectId: p.id }))
    const first = await initial
    expect(first).not.toBeNull()
    const todo = first!.columns[0]

    // мутация через REST → boardHub.emit → board.update с новой задачей
    const next = waitBoard(ws, (b) => b.tasks.some((t) => t.title === 'Hello'))
    await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/tasks`,
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { columnId: todo.id, title: 'Hello' }
    })
    const got = await next
    expect(got).not.toBeNull()
    expect(got!.tasks.some((t) => t.title === 'Hello')).toBe(true)
    ws.close()
  })

  it('не-участник не получает snapshot по подписке', async () => {
    const p = await createProject()
    const ws = await connect(bobTok)
    const snap = waitBoard(ws, () => true, 600)
    ws.send(JSON.stringify({ t: 'board.subscribe', projectId: p.id }))
    expect(await snap).toBeNull()
    ws.close()
  })
})
