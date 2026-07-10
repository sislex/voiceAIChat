// WebSocket-соединение: разбор кадров (JSON + бинарные аудио-чанки) и маршрутизация.
// Обработчики по типам сообщений подключают фазы STT/Claude/TTS (Ф4–Ф6).

import type { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@voicechat/shared'

/** Обработчик одного WS-соединения (per-connection состояние). */
export interface WsHandlers {
  /** Соединение открыто (ctx готов) — до первого сообщения. */
  onOpen?(ctx: WsContext): void
  /** JSON-сообщение клиента. */
  onMessage?(msg: ClientMessage, ctx: WsContext): void
  /** Бинарный кадр (аудио PCM Int16). */
  onBinary?(data: Buffer, ctx: WsContext): void
  /** Закрытие соединения (очистка). */
  onClose?(ctx: WsContext): void
}

export interface WsContext {
  send(msg: ServerMessage): void
  sendBinary(data: Buffer): void
}

/** Регистрирует обработчики на сокете; возвращает контекст. */
export function attachWs(socket: WebSocket, handlers: WsHandlers): WsContext {
  const ctx: WsContext = {
    send: (msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
    },
    sendBinary: (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data)
    }
  }

  handlers.onOpen?.(ctx)

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      handlers.onBinary?.(data, ctx)
      return
    }
    let msg: ClientMessage
    try {
      msg = JSON.parse(data.toString()) as ClientMessage
    } catch {
      return // игнорируем не-JSON
    }
    handlers.onMessage?.(msg, ctx)
  })

  socket.on('close', () => handlers.onClose?.(ctx))

  return ctx
}
