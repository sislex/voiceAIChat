// Процесс-глобальный эмиттер изменений сессий. Аналог BoardHub: состояния не
// держит, только сообщает WS-соединениям, что список пора перечитать или что
// конкретную сессию завершили.
//
// Зачем адресное событие об отзыве: без него вкладка узнаёт о своей смерти
// только на следующем запросе к API и до тех пор показывает рабочий интерфейс,
// хотя доступа уже нет. Именно этот разрыв и просили закрыть.

export interface SessionsChanged {
  user: string
  /** Отозванная сессия, если событие про конкретную; иначе список просто устарел. */
  revokedSid?: string
}

export type SessionsListener = (event: SessionsChanged) => void

export class SessionHub {
  private readonly listeners = new Set<SessionsListener>()

  emit(user: string, revokedSid?: string): void {
    for (const listener of this.listeners) listener({ user, ...(revokedSid ? { revokedSid } : {}) })
  }

  onChange(listener: SessionsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
