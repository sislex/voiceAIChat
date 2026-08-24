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
  private connectedListeners = new Set<() => void>()
  private reconnectListeners = new Set<() => void>()
  private hasConnected = false
  private closed = false
  // Буфер сообщений, пришедших ДО регистрации слушателей: сокет открывается на
  // загрузке модуля, а подписки — позже, в React-эффекте. Без буфера снапшот
  // claude.active (шлётся один раз при открытии) терялся → частичный ответ пропадал
  // после обновления страницы. Флашим микротаском при первой подписке — к этому
  // моменту все синхронные on() текущего тика уже зарегистрированы.
  private buffered: AnyServerMessage[] = []
  private flushed = false
  private flushScheduled = false

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
      const reconnected = this.hasConnected
      this.hasConnected = true
      for (const listener of [...this.connectedListeners]) listener()
      if (reconnected) for (const listener of [...this.reconnectListeners]) listener()
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return // TTS приходит base64 в JSON, бинарь не ждём
      let msg: AnyServerMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (!this.flushed) {
        this.buffered.push(msg)
        return
      }
      this.dispatch(msg)
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

  /** Доставка сообщения текущим слушателям его типа. */
  private dispatch(msg: AnyServerMessage): void {
    const set = this.listeners.get(msg.t)
    if (set) for (const l of [...set]) l(msg)
  }

  /**
   * Единичный флаш буфера на микротаске. Планируется из on(): к моменту выполнения
   * все синхронные подписки тика уже добавлены, поэтому буфер доставляется в
   * исходном порядке уже зарегистрированным слушателям.
   */
  private scheduleFlush(): void {
    if (this.flushScheduled || this.flushed) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushed = true
      const items = this.buffered
      this.buffered = []
      for (const m of items) this.dispatch(m)
    })
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
    if (!this.flushed) this.scheduleFlush()
    return () => {
      set!.delete(listener)
    }
  }

  /** Подписка на каждое успешное соединение, включая reconnect. */
  onConnected(cb: () => void): () => void {
    this.connectedListeners.add(cb)
    return () => this.connectedListeners.delete(cb)
  }

  /** Подписка только на успешные восстановления после первого соединения. */
  onReconnect(cb: () => void): () => void {
    this.reconnectListeners.add(cb)
    return () => this.reconnectListeners.delete(cb)
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
