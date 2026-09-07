// WS-маршрут /agent: подключение компаньон-агента с машины пользователя.
// Первое сообщение — agent.register {token}; после успешной авторизации
// сообщения exec.* уходят в реестр. Ping каждые 30с поддерживает last_seen.

import type { WebSocket } from 'ws'
import type { AgentToServer, ServerToAgent } from '@voicechat/shared'
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

  const send = (msg: ServerToAgent): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  socket.on('message', (data: Buffer, isBinary: boolean) => {
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
      const rec = db.machines.findAgentByTokenHash(hashAgentToken(msg.token))
      const ip = meta.ip ?? ''
      const deny = (reason: string): void => {
        if (rec?.userId) db.identity.logSecurityEvent({ user: rec.userId, type: 'agent_rejected', ip, details: `${rec.name}: ${reason}` })
        send({ t: 'agent.denied', reason })
        socket.close()
      }
      if (!rec) return deny('Неверный токен')
      // Срок токена и привязка к IP (machines-roadmap п.11).
      if (rec.tokenExpiresAt !== null && rec.tokenExpiresAt <= Date.now()) return deny('Токен истёк — перевыпустите его в списке машин')
      if (rec.pinIp && rec.lastIp && ip && rec.lastIp !== ip) return deny(`Токен привязан к IP ${rec.lastIp}, подключение с ${ip} отклонено`)
      agentId = rec.id
      owner = rec.userId
      if (ip) db.machines.recordAgentIp(rec.id, ip)
      if (rec.userId) db.identity.logSecurityEvent({ user: rec.userId, type: 'agent_connected', ip, details: `${rec.name} v${msg.version ?? '0.1.0'}` })
      // Версия из рапорта агента; отсутствует (старый агент) → legacy '0.1.0'.
      registry.register(rec.id, rec.name, socket, rec.policy, msg.version ?? '0.1.0', msg.imageHost)
      db.machines.touchAgent(rec.id)
      send({ t: 'agent.registered', id: rec.id, name: rec.name, policy: rec.policy })
      pingTimer = setInterval(() => {
        try {
          socket.ping()
        } catch {
          /* закрывается */
        }
      }, PING_INTERVAL_MS)
      return
    }

    // Смена политики с машины: сохраняем у владельца и раздаём (эхо агенту).
    if (msg.t === 'agent.setPolicy') {
      if (owner) db.machines.setAgentPolicy(owner, agentId, msg.policy)
      registry.updatePolicy(agentId, msg.policy)
      return
    }

    registry.handleMessage(agentId, msg)
  })

  socket.on('pong', () => {
    if (agentId) db.machines.touchAgent(agentId)
  })

  socket.on('close', () => {
    if (pingTimer) clearInterval(pingTimer)
    if (agentId) {
      db.machines.touchAgent(agentId)
      registry.unregister(agentId)
    }
  })
}
