// WS-соединение с сервером: регистрация токеном, приём exec.*, реконнект с backoff.
// Побочные эффекты вынесены в handlers, чтобы ядро переиспользовалось и в CLI,
// и в трей-приложении (Electron).

import WebSocket from 'ws'
import {
  evaluateAgentCommand,
  AGENT_VERSION,
  DEFAULT_AGENT_POLICY,
  type AgentPolicy,
  type AgentToServer,
  type ServerToAgent
} from '@voicechat/shared'
import type { AgentConfig } from './config.js'
import { runCommand, cancelCommand } from './exec.js'
import { startPty, writePty, resizePty, killPty } from './pty.js'
import { fsDelete, fsList, fsMkdir, fsRead, fsRename, fsWrite } from './fileOps.js'
import { createTelemetryCollector } from './telemetry.js'

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000
/** Период отправки телеметрии машины на сервер. */
const TELEMETRY_INTERVAL_MS = 30_000

/** Статус соединения агента для индикации в UI. */
export type AgentStatus = 'connecting' | 'online' | 'offline' | 'stopped'

/** Колбэки жизненного цикла соединения (все необязательны). */
export interface AgentHandlers {
  onStatus?(status: AgentStatus): void
  onRegistered?(name: string): void
  onDenied?(reason: string): void
  onExec?(command: string): void
  onExecDone?(command: string, exitCode: number | null, timedOut: boolean, ms: number): void
  /** Сервер сообщил, что доступна новая версия агента. */
  onUpdateAvailable?(version: string): void
  /** Текущая политика изменилась (регистрация/пуш сервера/локальная правка). */
  onPolicy?(policy: AgentPolicy): void
  /** Свободная строка лога (для консоли/журнала). */
  onLog?(line: string): void
}

/** Управление запущенным соединением. */
export interface AgentConnection {
  /** Остановить: закрыть сокет, отменить reconnect (статус → stopped). */
  stop(): void
  /** Текущая политика возможностей машины. */
  getPolicy(): AgentPolicy
  /** Задать политику локально и отправить её серверу (правка с машины). */
  setPolicy(policy: AgentPolicy): void
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
    onUpdateAvailable: (version) =>
      console.log(`[agent] доступно обновление v${version} — перекачайте и перезапустите скрипт агента`),
    onLog: (line) => console.log(`[agent] ${line}`)
  }
}

export function startConnection(config: AgentConfig, handlers: AgentHandlers = {}): AgentConnection {
  let backoff = BACKOFF_START_MS
  let stopped = false
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let policy: AgentPolicy = DEFAULT_AGENT_POLICY
  // Ссылка на send текущего соединения — для отправки вне обработчика сообщений.
  let activeSend: ((msg: AgentToServer) => void) | null = null
  let telemetryTimer: ReturnType<typeof setInterval> | null = null
  const collectTelemetry = createTelemetryCollector(config.rootDir)

  /** Собирает и шлёт телеметрию (ошибки сбора не критичны — просто пропускаем). */
  const pushTelemetry = async (send: (msg: AgentToServer) => void): Promise<void> => {
    try {
      send({ t: 'agent.telemetry', telemetry: await collectTelemetry() })
    } catch {
      /* телеметрия best-effort */
    }
  }

  /** Останавливает периодическую отправку телеметрии. */
  const stopTelemetry = (): void => {
    if (telemetryTimer) clearInterval(telemetryTimer)
    telemetryTimer = null
  }

  /** Применяет политику локально (+ уведомляет UI); при emit — шлёт серверу. */
  const applyPolicy = (p: AgentPolicy, emit: boolean): void => {
    policy = p
    handlers.onPolicy?.(p)
    if (emit) activeSend?.({ t: 'agent.setPolicy', policy: p })
  }

  const connect = (): void => {
    handlers.onStatus?.('connecting')
    const ws = new WebSocket(config.serverUrl)
    socket = ws
    const send = (msg: AgentToServer): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }
    activeSend = send

    ws.on('open', () => {
      send({ t: 'agent.register', token: config.token, version: AGENT_VERSION })
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
          applyPolicy(msg.policy ?? DEFAULT_AGENT_POLICY, false)
          handlers.onStatus?.('online')
          handlers.onRegistered?.(msg.name)
          // Телеметрия: сразу снимок и далее по таймеру (пере-регистрация обнуляет).
          stopTelemetry()
          void pushTelemetry(send)
          telemetryTimer = setInterval(() => void pushTelemetry(send), TELEMETRY_INTERVAL_MS)
          break
        case 'agent.policy':
          applyPolicy(msg.policy, false)
          handlers.onLog?.('политика обновлена')
          break
        case 'agent.denied':
          stopped = true // не переподключаемся с заведомо неверным токеном
          handlers.onDenied?.(msg.reason)
          break
        case 'agent.updateAvailable':
          handlers.onUpdateAvailable?.(msg.version)
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
        case 'pty.start':
          // Живой терминал: доверенный shell без per-command гейта (см. PTY_CONSOLE.md).
          handlers.onLog?.(`терминал открыт (${msg.ptyId})`)
          startPty(msg.ptyId, msg.cols, msg.rows, config.rootDir, send)
          break
        case 'pty.input':
          writePty(msg.ptyId, msg.data)
          break
        case 'pty.resize':
          resizePty(msg.ptyId, msg.cols, msg.rows)
          break
        case 'pty.kill':
          handlers.onLog?.('терминал закрыт')
          killPty(msg.ptyId)
          break
        case 'fs.list':
        case 'fs.read':
        case 'fs.write':
        case 'fs.delete':
        case 'fs.rename':
        case 'fs.mkdir': {
          const root = config.rootDir
          try {
            let result
            switch (msg.t) {
              case 'fs.list':
                result = fsList(root, policy, msg.path)
                break
              case 'fs.read':
                result = fsRead(root, policy, msg.path)
                break
              case 'fs.write':
                result = fsWrite(root, policy, msg.path, msg.dataBase64)
                break
              case 'fs.delete':
                result = fsDelete(root, policy, msg.path)
                break
              case 'fs.rename':
                result = fsRename(root, policy, msg.from, msg.to)
                break
              case 'fs.mkdir':
                result = fsMkdir(root, policy, msg.path)
                break
            }
            send({ t: 'fs.result', opId: msg.opId, result })
          } catch (err) {
            send({ t: 'fs.error', opId: msg.opId, message: err instanceof Error ? err.message : String(err) })
          }
          break
        }
      }
    })

    const reconnect = (): void => {
      activeSend = null
      stopTelemetry()
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
      stopTelemetry()
      handlers.onStatus?.('stopped')
      try {
        socket?.close()
      } catch {
        /* уже закрыт */
      }
    },
    getPolicy: () => policy,
    setPolicy: (p: AgentPolicy) => applyPolicy(p, true)
  }
}
