// Доставка событий канбана по WS-сессиям ядра: канбан шлёт `board` и `notification` на
// `/internal/kanban/events`, а кому и каким кадром их показать, решает ядро — подписка на доску
// только для участника и без снапшота, приглашение адресно, смена состава двумя кадрами.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerMessage } from '@voicechat/shared'
import { signToken } from "@sislexa/identity/server/users/accounts"
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { INTERNAL_KANBAN_EVENTS_PATH, type KanbanEvent } from '../kanban/internal.js'

const SECRET = 'test-secret'
const INTERNAL = 'internal-test'
let app: FastifyInstance
let db: VoiceChatDb
let dataDir: string
let port: number
let projectId: string

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'vc-kanban-events-'))
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser('bob', '', 'developer')
  await db.identity.createUser('carol', '', 'developer')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: dataDir, VC_KANBAN_MODE: 'remote', VC_KANBAN_URL: 'http://127.0.0.1:1', VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: 'mcp-test' }),
    db, sessionSecret: SECRET
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
  projectId = (await db.projects.createProject('admin', { name: 'P' })).id
})
afterEach(async () => {
  await app.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function connect(name: string, role: 'admin' | 'developer' = 'developer'): Promise<{ ws: WebSocket; frames: ServerMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${signToken({ name, role }, SECRET)}`)
  const frames: ServerMessage[] = []
  ws.on('message', (data) => frames.push(JSON.parse(data.toString()) as ServerMessage))
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
  return { ws, frames }
}

async function kanbanSends(...events: KanbanEvent[]): Promise<void> {
  const res = await app.inject({ method: 'POST', url: INTERNAL_KANBAN_EVENTS_PATH, headers: { authorization: `Bearer ${INTERNAL}` }, payload: { events } })
  expect(res.statusCode).toBe(200)
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))
const ofType = (frames: ServerMessage[], t: ServerMessage['t']): ServerMessage[] => frames.filter((frame) => frame.t === t)

describe('доска', () => {
  it('участник получает board.changed без снапшота; подписка сама кадр не шлёт', async () => {
    const admin = await connect('admin', 'admin')
    admin.ws.send(JSON.stringify({ t: 'board.subscribe', projectId }))
    await settle()
    expect(ofType(admin.frames, 'board.changed')).toEqual([])

    await kanbanSends({ kind: 'board', projectId })
    expect(ofType(admin.frames, 'board.changed')).toEqual([{ t: 'board.changed', projectId }])
    admin.ws.close()
  })

  it('не-участник не получает board.changed по подписке', async () => {
    const bob = await connect('bob')
    bob.ws.send(JSON.stringify({ t: 'board.subscribe', projectId }))
    await settle()
    await kanbanSends({ kind: 'board', projectId })
    expect(ofType(bob.frames, 'board.changed')).toEqual([])
    bob.ws.close()
  })
})

describe('состав проекта и приглашения', () => {
  it('приглашение приходит приглашённому адресно, посторонний кадра не получает', async () => {
    const bob = await connect('bob')
    const carol = await connect('carol')
    await kanbanSends({ kind: 'notification', event: { projectId, userId: 'bob', kind: 'membership' } })
    expect(ofType(bob.frames, 'invitations.invalidate')).toHaveLength(1)
    expect(ofType(carol.frames, 'invitations.invalidate')).toEqual([])
    bob.ws.close()
    carol.ws.close()
  })

  it('смена состава участнику приходит двумя кадрами: project.membership и инвалидация уведомлений', async () => {
    await db.projects.addMember('admin', projectId, 'bob')
    const bob = await connect('bob')
    const carol = await connect('carol')
    await kanbanSends({ kind: 'notification', event: { projectId, kind: 'membership' } })
    expect(ofType(bob.frames, 'project.membership')).toEqual([{ t: 'project.membership', v: 1, projectId }])
    expect(ofType(bob.frames, 'task-preparation.notifications.invalidate')).toEqual([{ t: 'task-preparation.notifications.invalidate', v: 1, projectId }])
    expect(ofType(carol.frames, 'project.membership')).toEqual([])
    bob.ws.close()
    carol.ws.close()
  })
})
