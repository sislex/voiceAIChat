// WS-маршрут /agent: подключение компаньон-агента с машины пользователя.
// Первое сообщение — agent.register {token}; после успешной авторизации
// сообщения exec.* уходят в реестр. Ping каждые 30с поддерживает last_seen.

import type { WebSocket } from 'ws'
import { compareVersions, type ServerToAgent } from '@sislexa/agent-contracts'
import type { AgentToServer } from '@voicechat/shared'
import { servedAgent } from './agentScript.js'
import { hashAgentToken, type VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from './registry.js'

const PING_INTERVAL_MS = 30_000

export interface AgentWsMeta {
  /** IP подключения (x-forwarded-for / remoteAddress) — для привязки токена и журнала безопасности. */
  ip?: string
}

export function attachAgentWs(socket: WebSocket, db: VoiceChatDb, registry: AgentRegistry, meta: AgentWsMeta = {}): void {
  let agentId: string | null = null
  let owner: string | null = null
  let pingTimer: NodeJS.Timeout | null = null
  let updateOffered = false

  const send = (msg: ServerToAgent): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  let stopped = false
  let registered = false
  const cleanup = (): void => {
    stopped = true
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = null
    if (registered && agentId) {
      registered = false
      registry.unregister(agentId)
    }
  }
  const failed = (event: string, error: unknown): void => {
    console.error(`[agent-ws] ${event} failed:`, error)
    cleanup()
    // 1013 asks the companion to reconnect; do not report a permanent token denial.
    try { socket.close(1013, 'Service temporarily unavailable; retry later') }
    catch { /* The transport may already be gone. */ }
  }

  const handleMessage = async (data: Buffer, isBinary: boolean): Promise<void> => {
    if (stopped) return
    if (isBinary) return
    let msg: AgentToServer
    try {
      msg = JSON.parse(data.toString()) as AgentToServer
    } catch {
      return
    }

    if (!agentId) {
      // До регистрации принимаем только agent.register.
      if (msg.t !== 'agent.register' || typeof msg.token !== 'string') {
        send({ t: 'agent.denied', reason: 'Сначала agent.register с токеном' })
        socket.close()
        return
      }
      const rec = await db.machines.findAgentByTokenHash(hashAgentToken(msg.token))
      const ip = meta.ip ?? ''
      const deny = async (reason: string): Promise<void> => {
        if (rec?.userId) await db.identity.logSecurityEvent({ user: rec.userId, type: 'agent_rejected', ip, details: `${rec.name}: ${reason}` })
        send({ t: 'agent.denied', reason })
        socket.close()
      }
      if (!rec) return deny('Неверный токен')
      // Срок токена и привязка к IP (machines-roadmap п.11).
      if (rec.tokenExpiresAt !== null && rec.tokenExpiresAt <= Date.now()) return deny('Токен истёк — перевыпустите его в списке машин')
      if (rec.pinIp && rec.lastIp && ip && rec.lastIp !== ip) return deny(`Токен привязан к IP ${rec.lastIp}, подключение с ${ip} отклонено`)
      agentId = rec.id
      owner = rec.userId
      if (ip) await db.machines.recordAgentIp(rec.id, ip)
      if (rec.userId) await db.identity.logSecurityEvent({ user: rec.userId, type: 'agent_connected', ip, details: `${rec.name} v${msg.version ?? '0.1.0'}` })
      // Версия из рапорта агента; отсутствует (старый агент) → legacy '0.1.0'.
      if (stopped) return
      registry.register(rec.id, rec.name, socket, rec.policy, msg.version ?? '0.1.0', msg.imageHost)
      registered = true
      await db.machines.touchAgent(rec.id)
      if (stopped) return
      send({ t: 'agent.registered', id: rec.id, name: rec.name, policy: rec.policy })
      pingTimer = setInterval(() => {
        try {
          socket.ping()
        } catch {
          /* закрывается */
        }
      }, PING_INTERVAL_MS)
      // Self-update (stand-https-v1 C01): only a supervised agent (systemd/launchd/Android restarts it) older
      // than the served bundle gets agent.update, once per connection. Unsupervised and legacy agents
      // keep the agent.updateAvailable hint sent by the registry version checks.
      if ((msg.supervisor === 'systemd' || msg.supervisor === 'launchd' || msg.supervisor === 'android') && !updateOffered) {
        let served: ReturnType<typeof servedAgent> | null = null
        try { served = servedAgent() } catch { /* bundle unreadable: no update offer */ }
        if (served && compareVersions(served.version, msg.version ?? '0.1.0') > 0) {
          updateOffered = true
          send({ t: 'agent.update', version: served.version, sha256: served.sha256 })
          if (rec.userId) await db.identity.logSecurityEvent({ user: rec.userId, type: 'agent_update_sent', ip, details: `${rec.name} v${msg.version ?? '0.1.0'} → v${served.version} (${msg.supervisor})` })
        }
      }
      return
    }

    // Registration is handled only once per connection.
    if (msg.t === 'agent.register') return

    // Смена политики с машины: сохраняем у владельца и раздаём (эхо агенту).
    if (msg.t === 'agent.setPolicy') {
      if (owner) await db.machines.setAgentPolicy(owner, agentId, msg.policy)
      registry.updatePolicy(agentId, msg.policy)
      return
    }

    await registry.handleMessage(agentId, msg)
  }

  // EventEmitter does not await listeners. Own every rejection and serialize registration.
  let messages: Promise<void> = Promise.resolve()
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    messages = messages.then(() => handleMessage(data, isBinary)).catch(error => failed('message', error))
    return messages
  })

  socket.on('pong', () => {
    if (!stopped && agentId) return db.machines.touchAgent(agentId).catch(error => failed('pong', error))
  })

  socket.on('close', () => {
    cleanup()
    if (agentId) return db.machines.touchAgent(agentId).catch(error => {
      console.error('[agent-ws] close failed:', error)
    })
  })
}
