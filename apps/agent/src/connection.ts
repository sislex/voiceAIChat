// WS-соединение с сервером: регистрация токеном, приём exec.*, реконнект с backoff.

import WebSocket from 'ws'
import type { AgentToServer, ServerToAgent } from '@voicechat/shared'
import type { AgentConfig } from './config.js'
import { runCommand, cancelCommand } from './exec.js'

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function startConnection(config: AgentConfig): void {
  let backoff = BACKOFF_START_MS

  const connect = (): void => {
    const socket = new WebSocket(config.serverUrl)
    const send = (msg: AgentToServer): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
    }

    socket.on('open', () => {
      send({ t: 'agent.register', token: config.token })
    })

    socket.on('message', (data) => {
      let msg: ServerToAgent
      try {
        msg = JSON.parse(data.toString()) as ServerToAgent
      } catch {
        return
      }
      switch (msg.t) {
        case 'agent.registered':
          backoff = BACKOFF_START_MS
          console.log(`[agent] подключён как «${msg.name}» к ${config.serverUrl}`)
          break
        case 'agent.denied':
          console.error(`[agent] сервер отклонил подключение: ${msg.reason}`)
          process.exit(1)
          break
        case 'exec.start': {
          console.log(`[agent] $ ${msg.command}`)
          const started = Date.now()
          runCommand(msg.execId, msg.command, msg.timeoutMs, (out) => {
            if (out.t === 'exec.done') {
              const sec = ((Date.now() - started) / 1000).toFixed(1)
              console.log(
                `[agent] → exit ${out.exitCode ?? '?'}${out.timedOut ? ' (таймаут)' : ''} (${sec}с)`
              )
            }
            send(out)
          })
          break
        }
        case 'exec.cancel':
          console.log('[agent] отмена команды')
          cancelCommand(msg.execId)
          break
      }
    })

    const reconnect = (): void => {
      console.log(`[agent] соединение потеряно, повтор через ${Math.round(backoff / 1000)}с`)
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    }

    socket.on('close', reconnect)
    socket.on('error', (err) => {
      console.error(`[agent] ошибка соединения: ${err.message}`)
      socket.close() // close-событие вызовет reconnect
    })
  }

  connect()
}
