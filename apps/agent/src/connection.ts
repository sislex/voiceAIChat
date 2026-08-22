// WS-соединение с сервером: регистрация токеном, приём exec.*, реконнект с backoff.
// Побочные эффекты вынесены в handlers, чтобы ядро переиспользовалось и в CLI,
// и в трей-приложении (Electron).

import WebSocket from 'ws'
import { createServer, connect as connectSocket, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
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
import { resolveShellInfo } from './platform.js'
import { ensureImageDir, localAddresses, startImageHost, type ImageHost } from './imageHost.js'

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000
/** Период отправки телеметрии машины на сервер. */
const TELEMETRY_INTERVAL_MS = 30_000

interface LocalTunnel { server: Server; sockets: Map<string, Socket> }
const localTunnels = new Map<string, LocalTunnel>()
const targetSockets = new Map<string, Socket>()
const tunnelKey = (tunnelId: string, connectionId: string): string => `${tunnelId}:${connectionId}`
function closeTunnel(tunnelId: string): void {
  const local = localTunnels.get(tunnelId)
  if (local) {
    for (const socket of local.sockets.values()) socket.destroy()
    local.server.close(); localTunnels.delete(tunnelId)
  }
  for (const [key, socket] of targetSockets) if (key.startsWith(tunnelId + ':')) { socket.destroy(); targetSockets.delete(key) }
}

/** Статус соединения агента для индикации в UI. */
export type AgentStatus = 'connecting' | 'online' | 'offline' | 'stopped'

/** Колбэки жизненного цикла соединения (все необязательны). */
export interface AgentHandlers {
  onStatus?(status: AgentStatus): void
  onRegistered?(name: string, id?: string): void
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
  // Раздача картинок поднимается один раз на процесс и переживает реконнекты;
  // при каждой регистрации сообщаем серверу порт и текущие адреса машины.
  let imageHost: ImageHost | null = null
  // Разрешаем shell один раз на процесс — и логируем деградацию/игнор override
  // сразу, не дожидаясь первого подключения (пользователю важно увидеть это
  // в логе агента, даже если WS ещё не поднялся).
  const shellInfo = resolveShellInfo()
  if (shellInfo.ignoredOverride) {
    handlers.onLog?.(
      `переменная SHELL/VC_PTY_SHELL="${shellInfo.ignoredOverride}" — Unix-путь, на Windows не применяется; использую ${shellInfo.shell}`
    )
  }
  if (shellInfo.degraded) {
    handlers.onLog?.(
      `bash.exe не найден (PATH и стандартные пути Git for Windows) — команды и терминал идут через ${shellInfo.shell}, ` +
        'функциональность ограничена. Поставьте Git for Windows для полноценной работы.'
    )
  }
  const collectTelemetry = createTelemetryCollector(config.rootDir, shellInfo)

  /** Описание раздачи для agent.register (адреса пересчитываем каждый раз: IP меняется). */
  const imageHostInfo = (): { port: number; hosts: string[] } | undefined => {
    if (!imageHost) return undefined
    ensureImageDir(config.rootDir) // каталог могли удалить между подключениями
    return { port: imageHost.port, hosts: localAddresses() }
  }

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
    // Самоподписанный TLS (Caddy `tls internal`): VC_AGENT_INSECURE_TLS=1 отключает
    // проверку сертификата для wss:// — иначе Node ws рвёт соединение. Нужно на телефоне.
    const wsOpts =
      process.env.VC_AGENT_INSECURE_TLS && config.serverUrl.startsWith('wss:')
        ? { rejectUnauthorized: false }
        : undefined
    const ws = new WebSocket(config.serverUrl, wsOpts)
    socket = ws
    const send = (msg: AgentToServer): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }
    activeSend = send

    ws.on('open', () => {
      const images = imageHostInfo()
      send({
        t: 'agent.register',
        token: config.token,
        version: AGENT_VERSION,
        ...(images ? { imageHost: images } : {})
      })
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
          if (msg.id) handlers.onRegistered?.(msg.name, msg.id)
          else handlers.onRegistered?.(msg.name)
          // Телеметрия: сразу снимок и далее по таймеру (пере-регистрация обнуляет).
          stopTelemetry()
          void pushTelemetry(send)
          telemetryTimer = setInterval(() => void pushTelemetry(send), TELEMETRY_INTERVAL_MS)
          // Адреса машины могли смениться, пока агент был офлайн.
          {
            const info = imageHostInfo()
            if (info) send({ t: 'agent.imageHost', imageHost: info })
          }
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
          // Живой терминал: доверенный shell без per-command гейта (см. docs/plans/PTY_CONSOLE.md).
          handlers.onLog?.(`терминал открыт (${msg.ptyId})`)
          startPty(msg.ptyId, msg.cols, msg.rows, msg.cwd || config.rootDir, send)
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
        case 'tunnel.listen': {
          const existing = localTunnels.get(msg.tunnelId)
          const address = existing?.server.address()
          if (address && typeof address !== 'string') {
            send({ t: 'tunnel.listening', tunnelId: msg.tunnelId, port: address.port }); break
          }
          const tunnel: LocalTunnel = { server: createServer(), sockets: new Map() }
          localTunnels.set(msg.tunnelId, tunnel)
          tunnel.server.on('connection', (client) => {
            const connectionId = randomUUID(); tunnel.sockets.set(connectionId, client)
            send({ t: 'tunnel.open', tunnelId: msg.tunnelId, connectionId })
            client.on('data', (data) => send({ t: 'tunnel.data', tunnelId: msg.tunnelId, connectionId, data: data.toString('base64') }))
            client.on('end', () => send({ t: 'tunnel.end', tunnelId: msg.tunnelId, connectionId }))
            client.on('error', () => send({ t: 'tunnel.end', tunnelId: msg.tunnelId, connectionId }))
          })
          tunnel.server.listen(0, '127.0.0.1', () => {
            const bound = tunnel.server.address()
            if (bound && typeof bound !== 'string') send({ t: 'tunnel.listening', tunnelId: msg.tunnelId, port: bound.port })
          })
          tunnel.server.on('error', (error) => send({ t: 'tunnel.error', tunnelId: msg.tunnelId, message: error.message }))
          break
        }
        case 'tunnel.connect': {
          const key = tunnelKey(msg.tunnelId, msg.connectionId)
          const target = connectSocket({ host: '127.0.0.1', port: msg.port }); targetSockets.set(key, target)
          target.on('connect', () => send({ t: 'tunnel.connected', tunnelId: msg.tunnelId, connectionId: msg.connectionId }))
          target.on('data', (data) => send({ t: 'tunnel.data', tunnelId: msg.tunnelId, connectionId: msg.connectionId, data: data.toString('base64') }))
          target.on('end', () => send({ t: 'tunnel.end', tunnelId: msg.tunnelId, connectionId: msg.connectionId }))
          target.on('error', (error) => send({ t: 'tunnel.connectionError', tunnelId: msg.tunnelId, connectionId: msg.connectionId, message: error.message }))
          break
        }
        case 'tunnel.data': {
          const socket = targetSockets.get(tunnelKey(msg.tunnelId, msg.connectionId)) ?? localTunnels.get(msg.tunnelId)?.sockets.get(msg.connectionId)
          socket?.write(Buffer.from(msg.data, 'base64')); break
        }
        case 'tunnel.end': {
          const key = tunnelKey(msg.tunnelId, msg.connectionId)
          const socket = targetSockets.get(key) ?? localTunnels.get(msg.tunnelId)?.sockets.get(msg.connectionId)
          socket?.end(); targetSockets.delete(key); localTunnels.get(msg.tunnelId)?.sockets.delete(msg.connectionId); break
        }
        case 'tunnel.close':
          closeTunnel(msg.tunnelId); break
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
            const code = typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
              ? err.code
              : undefined
            send({ t: 'fs.error', opId: msg.opId, message: err instanceof Error ? err.message : String(err), ...(code ? { code } : {}) })
          }
          break
        }
      }
    })

    const reconnect = (): void => {
      activeSend = null
      stopTelemetry()
      for (const id of [...localTunnels.keys()]) closeTunnel(id)
      for (const socket of targetSockets.values()) socket.destroy()
      targetSockets.clear()
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

  // Раздача картинок поднимается параллельно подключению: слушающий сокет — это
  // асинхронно, а держать из-за него реконнект нельзя. Поднялась — досылаем порт
  // и адреса отдельным сообщением. Не поднялась — сервер просто не увидит
  // imageHost и оставит картинки у себя (прежний путь через REST).
  void startImageHost(config.rootDir)
    .then((host) => {
      if (!host || stopped) return
      imageHost = host
      handlers.onLog?.(`раздача картинок на :${host.port}`)
      const info = imageHostInfo()
      if (info) activeSend?.({ t: 'agent.imageHost', imageHost: info })
    })
    .catch(() => undefined)

  return {
    stop: () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      stopTelemetry()
      imageHost?.stop()
      for (const id of [...localTunnels.keys()]) closeTunnel(id)
      for (const target of targetSockets.values()) target.destroy()
      targetSockets.clear()
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
