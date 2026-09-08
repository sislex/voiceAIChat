// Прокси путей машин в ядре для режима `VC_MACHINES_MODE=remote`: REST машин, установщики, артефакты
// приложений и перенос хранилищ уходят в процесс машин тем же переносом заголовков и тела, что у Make и
// канбана; конкретные роуты ядра под общими префиксами (`/api/conversations/*`) выигрывают у wildcard.
// Компаньон-агенты подключаются к публичному хосту `/agent` — этот WebSocket ядро тоже переправляет в
// процесс машин само (Caddy не знает, включён ли профиль), кадр в кадр, с исходным IP в x-forwarded-for.
import type { FastifyInstance } from 'fastify'
import { WebSocket, type RawData } from 'ws'
import { registerServiceProxy } from '../makeBridge/proxy.js'

/** Всё, что регистрируют `routes/agents.ts` и `storageMigration/routes.ts`; полноту держит `proxy.test.ts`. */
export const MACHINES_PROXY_PREFIXES = ['/api/agents', '/api/login-application', '/api/app/desktop', '/api/storage-migrations', '/api/conversations/:id/storage', '/api/conversations/:id/machines'] as const

export function registerMachinesProxy(app: FastifyInstance, opts: { machinesUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): void {
  // Запись файла через проводник — base64 до десятков мегабайт (лимит WS агента 48 МБ).
  registerServiceProxy(app, { name: 'machines', baseUrl: opts.machinesUrl, prefixes: MACHINES_PROXY_PREFIXES, bodyLimit: 64 * 1024 * 1024, ...opts })
}

export interface AgentWsProxyOptions {
  machinesUrl: string
  /** Фабрика клиентского сокета (в тестах — подмена). */
  connect?: (url: string, headers: Record<string, string>) => WebSocket
}

/** WebSocket `/agent` → процесс машин: сообщения переносятся как есть в обе стороны, закрытие — тоже. */
export function registerAgentWsProxy(app: FastifyInstance, opts: AgentWsProxyOptions): void {
  const wsBase = opts.machinesUrl.replace(/\/+$/, '').replace(/^http/, 'ws')
  const connect = opts.connect ?? ((url, headers) => new WebSocket(url, { headers }))
  app.register(async (scoped) => {
    scoped.get('/agent', { websocket: true }, (socket, request) => {
      const fwd = String(request.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() || request.socket.remoteAddress || ''
      const upstream = connect(`${wsBase}/agent`, { 'x-forwarded-for': fwd })
      const queued: Array<[RawData, boolean]> = []
      upstream.on('open', () => { for (const [data, isBinary] of queued) upstream.send(data, { binary: isBinary }); queued.length = 0 })
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
        else if (upstream.readyState === WebSocket.CONNECTING) queued.push([data, isBinary])
      })
      upstream.on('message', (data: RawData, isBinary: boolean) => { if (socket.readyState === socket.OPEN) socket.send(data, { binary: isBinary }) })
      // Пинги процесса машин до агента не доходят (ws отвечает pong сам); last_seen обновляет пинг отсюда.
      upstream.on('ping', () => { try { socket.ping() } catch { /* закрывается */ } })
      const closeBoth = (): void => { try { upstream.close() } catch { /* уже закрыт */ } try { socket.close() } catch { /* уже закрыт */ } }
      socket.on('close', closeBoth)
      socket.on('error', closeBoth)
      upstream.on('close', closeBoth)
      upstream.on('error', (error) => { request.log.warn({ err: error }, '[machines-proxy] процесс машин недоступен для агента'); closeBoth() })
    })
  })
}
