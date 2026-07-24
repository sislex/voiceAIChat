// Устойчивое WS-соединение с сервером: типизированная отправка JSON/бинаря,
// подписка по типу сообщения (msg.t), очередь на время (пере)подключения и
// авто-reconnect. Один экземпляр на подключение (см. installRemoteBridges).

import type { ClientMessage, ServerMessage, ServerMessageType } from '@shared/protocol'

type AnyServerMessage = Extract<ServerMessage, { t: ServerMessageType }>
type Listener = (msg: AnyServerMessage) => void

export class WsClient {
  private ws: WebSocket | null = null
  private queue: Array<string | ArrayBuffer> = []
  private listeners = new Map<string, Set<Listener>>()
  private closed = false

  /**
   * baseUrl — адрес /ws; tokenProvider даёт актуальный токен сессии. Если провайдер
   * задан и токена пока нет (до логина) — не дозваниваемся, ждём reconnect().
   */
  constructor(
    private readonly baseUrl: string,
    private readonly tokenProvider?: () => string | null
  ) {
    this.connect()
  }

  private connect(): void {
    if (this.closed) return
    const token = this.tokenProvider ? this.tokenProvider() : undefined
    // Провайдер задан, но токена нет — соединение отложено до логина (reconnect()).
    if (this.tokenProvider && !token) return
    const url = token ? `${this.baseUrl}?token=${encodeURIComponent(token)}` : this.baseUrl
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      const pending = this.queue
      this.queue = []
      for (const m of pending) ws.send(m)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return // TTS приходит base64 в JSON, бинарь не ждём
      let msg: AnyServerMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const set = this.listeners.get(msg.t)
      if (set) for (const l of set) l(msg)
    }
    ws.onclose = () => {
      this.ws = null
      if (!this.closed) setTimeout(() => this.connect(), 1000)
    }
    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        // no-op
      }
    }
  }

  send(msg: ClientMessage): void {
    const s = JSON.stringify(msg)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s)
    else this.queue.push(s)
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf)
    else this.queue.push(buf)
  }

  /** Подписка на сообщения данного типа. Возвращает функцию отписки. */
  on<T extends ServerMessageType>(
    type: T,
    cb: (msg: Extract<ServerMessage, { t: T }>) => void
  ): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    const listener = cb as Listener
    set.add(listener)
    return () => {
      set!.delete(listener)
    }
  }

  /** Пере-дозвон с актуальным токеном (после логина/логаута). */
  reconnect(): void {
    if (this.closed) return
    const prev = this.ws
    this.ws = null
    if (prev) {
      prev.onclose = null // не даём авто-reconnect старого сокета
      try {
        prev.close()
      } catch {
        // no-op
      }
    }
    this.connect()
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }
}
