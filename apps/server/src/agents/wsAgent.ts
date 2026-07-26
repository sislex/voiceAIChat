// WS-маршрут /agent: подключение компаньон-агента с машины пользователя.
// Первое сообщение — agent.register {token}; после успешной авторизации
// сообщения exec.* уходят в реестр. Ping каждые 30с поддерживает last_seen.

import type { WebSocket } from 'ws'
import type { AgentToServer, ServerToAgent } from '@voicechat/shared'
import { hashAgentToken, type VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from './registry.js'

const PING_INTERVAL_MS = 30_000

export function attachAgentWs(socket: WebSocket, db: VoiceChatDb, registry: AgentRegistry): void {
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
      const rec = db.findAgentByTokenHash(hashAgentToken(msg.token))
      if (!rec) {
        send({ t: 'agent.denied', reason: 'Неверный токен' })
        socket.close()
        return
      }
      agentId = rec.id
      owner = rec.userId
      // Версия из рапорта агента; отсутствует (старый агент) → legacy '0.1.0'.
      registry.register(rec.id, rec.name, socket, rec.policy, msg.version ?? '0.1.0', msg.imageHost)
      db.touchAgent(rec.id)
      send({ t: 'agent.registered', name: rec.name, policy: rec.policy })
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
      if (owner) db.setAgentPolicy(owner, agentId, msg.policy)
      registry.updatePolicy(agentId, msg.policy)
      return
    }

    registry.handleMessage(agentId, msg)
  })

  socket.on('pong', () => {
    if (agentId) db.touchAgent(agentId)
  })

  socket.on('close', () => {
    if (pingTimer) clearInterval(pingTimer)
    if (agentId) {
      db.touchAgent(agentId)
      registry.unregister(agentId)
    }
  })
}
