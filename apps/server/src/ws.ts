// WebSocket-соединение: разбор кадров (JSON + бинарные аудио-чанки) и маршрутизация.
// Обработчики по типам сообщений подключают фазы STT/Claude/TTS (Ф4–Ф6).

import type { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@voicechat/shared'

/** Обработчик одного WS-соединения (per-connection состояние). */
export interface WsHandlers {
  /** Соединение открыто (ctx готов) — до первого сообщения. */
  onOpen?(ctx: WsContext): Promise<void>
  /** JSON-сообщение клиента. */
  onMessage?(msg: ClientMessage, ctx: WsContext): Promise<void>
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
export async function attachWs(socket: WebSocket, handlers: WsHandlers): Promise<WsContext> {
  const ctx: WsContext = {
    send: (msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
    },
    sendBinary: (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data)
    }
  }

  await handlers.onOpen?.(ctx)

  // Сообщения одного сокета обрабатываются строго по очереди: обработчики ходят
  // в БД через асинхронные порты, а порядок «audio.start → чанки → audio.stop» и
  // подобных цепочек — часть контракта. Ошибка одного сообщения очередь не роняет.
  let queue: Promise<void> = Promise.resolve()
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    queue = queue
      .then(async () => {
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
        await handlers.onMessage?.(msg, ctx)
      })
      .catch((err) => console.error('[ws] обработчик сообщения упал:', err instanceof Error ? err.message : err))
  })

  socket.on('close', () => handlers.onClose?.(ctx))

  return ctx
}
