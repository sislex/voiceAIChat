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

/**
 * Потолок исходящей очереди одного соединения. Кадры, которые клиент не вычитывает (вкладка усыплена,
 * связь висит), `ws` копит в памяти сервера без ограничения — так ядро на проде набирало сотни мегабайт
 * буферов и падало по потолку кучи (2026-09-08). Разрыв дешевле: клиент переподключится и получит
 * свежее состояние снимками, а не хвостом накопленных кадров.
 */
export const WS_MAX_BUFFERED_BYTES = 8 * 1024 * 1024

export interface AttachWsOptions {
  maxBufferedBytes?: number
  /** Куда сообщить о разрыве: счётчики кадров по типам показывают, что именно переполнило очередь. */
  onOverflow?: (info: { bufferedAmount: number; frames: Array<[string, number]> }) => void
}

/** Регистрирует обработчики на сокете; возвращает контекст. */
export async function attachWs(socket: WebSocket, handlers: WsHandlers, options: AttachWsOptions = {}): Promise<WsContext> {
  const limit = options.maxBufferedBytes ?? WS_MAX_BUFFERED_BYTES
  const frames = new Map<string, number>()
  let overflowed = false
  const guard = (): boolean => {
    if (overflowed || socket.bufferedAmount <= limit) return false
    overflowed = true
    options.onOverflow?.({ bufferedAmount: socket.bufferedAmount, frames: [...frames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) })
    try { socket.terminate() } catch { /* уже закрыт */ }
    return true
  }
  const ctx: WsContext = {
    send: (msg) => {
      if (socket.readyState !== socket.OPEN || overflowed) return
      frames.set(msg.t, (frames.get(msg.t) ?? 0) + 1)
      socket.send(JSON.stringify(msg))
      guard()
    },
    sendBinary: (data) => {
      if (socket.readyState !== socket.OPEN || overflowed) return
      frames.set('(binary)', (frames.get('(binary)') ?? 0) + 1)
      socket.send(data)
      guard()
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
