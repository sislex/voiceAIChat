// Зеркало и шина событий `HttpMachines`: снимки машин/PTY отвечают на синхронные чтения, события PTY
// доходят до подписчика `ptyStart` и копятся в буфере, кадры уходят в шину ядра, авторизация тоннеля
// спрашивается у колбэка и отвечается по той же шине, ошибка RPC с кодом восстанавливается как AgentFsError.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentFsError } from '../agents/registry.js'
import { MACHINES_INTERNAL_EVENTS_PATH, MACHINES_INTERNAL_RPC_PATH, type MachinesClientMessage, type MachinesEvent } from '../machines/internal.js'
import { HttpMachines } from './httpMachines.js'

let server: Server | null = null
let wss: WebSocketServer | null = null

interface Fake { url: string; sockets: Set<WebSocket>; rpcCalls: Array<{ method: string; args: unknown[] }>; clientMessages: MachinesClientMessage[]; push(event: MachinesEvent): void; opened: Promise<void> }

async function fakeMachines(rpc: (method: string, args: unknown[]) => { status?: number; body: unknown }): Promise<Fake> {
  const rpcCalls: Fake['rpcCalls'] = []
  const clientMessages: MachinesClientMessage[] = []
  const sockets = new Set<WebSocket>()
  let resolveOpen: () => void = () => {}
  const opened = new Promise<void>((r) => { resolveOpen = r })
  server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (d: string) => { raw += d })
    req.on('end', () => {
      expect(req.url).toBe(MACHINES_INTERNAL_RPC_PATH)
      expect(req.headers.authorization).toBe('Bearer tok')
      const { method, args } = JSON.parse(raw) as { method: string; args: unknown[] }
      rpcCalls.push({ method, args })
      const out = rpc(method, args)
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out.body))
    })
  })
  wss = new WebSocketServer({ server, path: MACHINES_INTERNAL_EVENTS_PATH })
  wss.on('connection', (socket, req) => {
    expect(req.headers.authorization).toBe('Bearer tok')
    sockets.add(socket)
    socket.on('message', (d) => clientMessages.push(JSON.parse(d.toString()) as MachinesClientMessage))
    socket.on('close', () => sockets.delete(socket))
    resolveOpen()
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, sockets, rpcCalls, clientMessages, push: (event) => { for (const s of sockets) s.send(JSON.stringify(event)) }, opened }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

let current: HttpMachines | null = null
afterEach(async () => {
  current?.stop(); current = null
  for (const s of wss?.clients ?? []) s.terminate()
  wss?.close(); wss = null
  server?.closeAllConnections()
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); server = null
})

describe('HttpMachines', () => {
  it('зеркало: снимок машин и PTY отвечает на синхронные чтения и зовёт onChange; закрытие шины делает всех offline', async () => {
    const fake = await fakeMachines(() => ({ body: { result: null } }))
    const publish = vi.fn()
    const machines = new HttpMachines({ machinesUrl: fake.url, token: 'tok', publish, reconnectMs: 50 })
    current = machines
    const changed = vi.fn()
    machines.onChange(changed)
    machines.start()
    await fake.opened
    fake.push({ kind: 'machines', machines: [{ id: 'm1', name: 'Mac', version: '0.16.0', platform: 'darwin', policy: { allowedDirs: ['/w'] } as never }] })
    fake.push({ kind: 'ptys', ptys: [{ ptyId: 'p1', agentId: 'm1', context: { cwd: '/w' } as never }] })
    await tick()
    expect(machines.isOnline('m1')).toBe(true)
    expect([...machines.onlineIds()]).toEqual(['m1'])
    expect(machines.nameOf('m1')).toBe('Mac')
    expect(machines.versionOf('m1')).toBe('0.16.0')
    expect(machines.platformOf('m1')).toBe('darwin')
    expect(machines.policyOf('m1')?.allowedDirs).toEqual(['/w'])
    expect(machines.ptyLive('p1')).toBe(true)
    expect(machines.ptyContextOf('p1')).toEqual({ cwd: '/w' })
    expect(await machines.ptyBufferText('unknown')).toBeNull()
    expect(changed).toHaveBeenCalled()
    for (const s of fake.sockets) s.close()
    await tick()
    expect(machines.isOnline('m1')).toBe(false)
    machines.stop()
  })

  it('PTY: старт — RPC, вывод по шине идёт подписчику и в буфер, выход снимает подписку; кадры — в publish', async () => {
    const fake = await fakeMachines((method) => ({ body: { result: method === 'ptyBufferText' ? '$ ls' : null } }))
    const publish = vi.fn()
    const machines = new HttpMachines({ machinesUrl: fake.url, token: 'tok', publish })
    current = machines
    machines.start()
    await fake.opened
    const events: unknown[] = []
    machines.ptyStart('m1', 'p1', 80, 24, undefined, (e) => events.push(e))
    await tick()
    expect(fake.rpcCalls).toEqual([{ method: 'ptyStart', args: ['m1', 'p1', 80, 24] }])
    expect(machines.ptyLive('p1')).toBe(true)
    fake.push({ kind: 'pty', event: { t: 'pty.output', ptyId: 'p1', data: '$ ' } })
    fake.push({ kind: 'frame', message: { t: 'board.changed', projectId: 'x' }, userId: 'ann' })
    await tick()
    expect(events).toEqual([{ t: 'pty.output', ptyId: 'p1', data: '$ ' }])
    // Буфер — у процесса машин: живую сессию спрашиваем по RPC, чужую — нет.
    expect(await machines.ptyBufferText('p1')).toBe('$ ls')
    expect(publish).toHaveBeenCalledWith({ t: 'board.changed', projectId: 'x' }, 'ann')
    machines.ptyInput('p1', 'ls\r')
    fake.push({ kind: 'pty', event: { t: 'pty.exit', ptyId: 'p1', exitCode: 0 } })
    await tick()
    expect(events.at(-1)).toEqual({ t: 'pty.exit', ptyId: 'p1', exitCode: 0 })
    expect(machines.ptyLive('p1')).toBe(false)
    expect(await machines.ptyBufferText('p1')).toBeNull()
    expect(fake.rpcCalls.map((c) => c.method)).toEqual(['ptyStart', 'ptyBufferText', 'ptyInput'])
    machines.stop()
  })

  it('тоннель: колбэки остаются у ядра, авторизация отвечается по шине, закрытие зовёт onClose; ошибка с кодом — AgentFsError', async () => {
    const fake = await fakeMachines((method) => {
      if (method === 'createTunnel') return { body: { result: 4242 } }
      if (method === 'fsRead') return { status: 500, body: { error: 'ENOENT: нет файла', code: 'ENOENT' } }
      return { body: { result: null } }
    })
    const machines = new HttpMachines({ machinesUrl: fake.url, token: 'tok', publish: () => {} })
    current = machines
    machines.start()
    await fake.opened
    const authorize = vi.fn(async () => true)
    const onClose = vi.fn(async () => {})
    expect(await machines.createTunnel('t1', 'src', 'dst', 3000, authorize, onClose)).toBe(4242)
    expect(machines.tunnelPort('t1')).toBe(4242)
    fake.push({ kind: 'tunnelAuthorize', requestId: 'r1', id: 't1' })
    fake.push({ kind: 'tunnelAuthorize', requestId: 'r2', id: 'unknown' })
    await tick()
    expect(authorize).toHaveBeenCalledTimes(1)
    // Чужой тоннель (r2) остаётся без ответа — его знает другой процесс; таймаут у процесса машин.
    expect(fake.clientMessages).toEqual([{ kind: 'tunnelAuthorizeResult', requestId: 'r1', ok: true }])
    fake.push({ kind: 'tunnelClosed', id: 't1' })
    await tick()
    expect(onClose).toHaveBeenCalled()
    expect(machines.tunnelPort('t1')).toBeNull()
    const error = await machines.fsRead('m1', '/nope').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentFsError)
    expect((error as AgentFsError).code).toBe('ENOENT')
    machines.stop()
  })
})
