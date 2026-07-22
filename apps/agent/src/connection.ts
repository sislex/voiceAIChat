// WS-соединение с сервером: регистрация токеном, приём exec.*, реконнект с backoff.
// Побочные эффекты вынесены в handlers, чтобы ядро переиспользовалось и в CLI,
// и в трей-приложении (Electron).

import WebSocket from 'ws'
import {
  evaluateAgentCommand,
  DEFAULT_AGENT_POLICY,
  type AgentPolicy,
  type AgentToServer,
  type ServerToAgent
} from '@voicechat/shared'
import type { AgentConfig } from './config.js'
import { runCommand, cancelCommand } from './exec.js'

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000

/** Статус соединения агента для индикации в UI. */
export type AgentStatus = 'connecting' | 'online' | 'offline' | 'stopped'

/** Колбэки жизненного цикла соединения (все необязательны). */
export interface AgentHandlers {
  onStatus?(status: AgentStatus): void
  onRegistered?(name: string): void
  onDenied?(reason: string): void
  onExec?(command: string): void
  onExecDone?(command: string, exitCode: number | null, timedOut: boolean, ms: number): void
  /** Свободная строка лога (для консоли/журнала). */
  onLog?(line: string): void
}

/** Управление запущенным соединением. */
export interface AgentConnection {
  /** Остановить: закрыть сокет, отменить reconnect (статус → stopped). */
  stop(): void
}

/** Дефолтные handlers для CLI: печать в консоль, выход при отказе. */
export function consoleHandlers(): AgentHandlers {
  return {
    onRegistered: (name) => console.log(`[agent] подключён как «${name}»`),
    onDenied: (reason) => {
      console.error(`[agent] сервер отклонил подключение: ${reason}`)
      process.exit(1)
    },
    onExec: (command) => console.log(`[agent] $ ${command}`),
    onExecDone: (_c, exitCode, timedOut, ms) =>
      console.log(
        `[agent] → exit ${exitCode ?? '?'}${timedOut ? ' (таймаут)' : ''} (${(ms / 1000).toFixed(1)}с)`
      ),
    onLog: (line) => console.log(`[agent] ${line}`)
  }
}

export function startConnection(config: AgentConfig, handlers: AgentHandlers = {}): AgentConnection {
  let backoff = BACKOFF_START_MS
  let stopped = false
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let policy: AgentPolicy = DEFAULT_AGENT_POLICY

  const connect = (): void => {
    handlers.onStatus?.('connecting')
    const ws = new WebSocket(config.serverUrl)
    socket = ws
    const send = (msg: AgentToServer): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    ws.on('open', () => {
      send({ t: 'agent.register', token: config.token })
    })

    ws.on('message', (data) => {
      let msg: ServerToAgent
      try {
        msg = JSON.parse(data.toString()) as ServerToAgent
      } catch {
        return
      }
      switch (msg.t) {
        case 'agent.registered':
          backoff = BACKOFF_START_MS
          policy = msg.policy ?? DEFAULT_AGENT_POLICY
          handlers.onStatus?.('online')
          handlers.onRegistered?.(msg.name)
          break
        case 'agent.policy':
          policy = msg.policy
          handlers.onLog?.('политика обновлена')
          break
        case 'agent.denied':
          stopped = true // не переподключаемся с заведомо неверным токеном
          handlers.onDenied?.(msg.reason)
          break
        case 'exec.start': {
          const command = msg.command
          // Локальная проверка политики — жёсткая граница на клиенте (второй барьер).
          const verdict = evaluateAgentCommand(policy, command)
          if (!verdict.allowed) {
            handlers.onExec?.(command)
            handlers.onExecDone?.(command, null, false, 0)
            handlers.onLog?.(`команда отклонена политикой: ${verdict.reason}`)
            send({ t: 'exec.error', execId: msg.execId, message: `Запрещено политикой: ${verdict.reason}` })
            break
          }
          handlers.onExec?.(command)
          const started = Date.now()
          runCommand(msg.execId, command, msg.timeoutMs, (out) => {
            if (out.t === 'exec.done') {
              handlers.onExecDone?.(command, out.exitCode, out.timedOut === true, Date.now() - started)
            }
            send(out)
          })
          break
        }
        case 'exec.cancel':
          handlers.onLog?.('отмена команды')
          cancelCommand(msg.execId)
          break
      }
    })

    const reconnect = (): void => {
      if (stopped) return
      handlers.onStatus?.('offline')
      handlers.onLog?.(`соединение потеряно, повтор через ${Math.round(backoff / 1000)}с`)
      reconnectTimer = setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    }

    ws.on('close', reconnect)
    ws.on('error', (err) => {
      handlers.onLog?.(`ошибка соединения: ${err.message}`)
      ws.close() // close-событие вызовет reconnect
    })
  }

  connect()

  return {
    stop: () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      handlers.onStatus?.('stopped')
      try {
        socket?.close()
      } catch {
        /* уже закрыт */
      }
    }
  }
}
