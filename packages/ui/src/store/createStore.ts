// Общая основа доменных хранилищ (CHAT-236).
//
// Ни одно хранилище не знает про React, транспорт и другие домены: это обычное
// замыкание с `getState/subscribe/actions/dispose`. Ядро добавляет к нему две
// вещи, которых раньше не было у глобального стора: владение таймерами (их
// снимает `dispose`) и «немой» режим после `dispose` — уснувший ответ уже
// упавшего в никуда запроса не будит подписчиков размонтированного дерева.

/** Публичный контракт доменного хранилища. */
export interface Store<TState, TActions> {
  getState(): Readonly<TState>
  subscribe(listener: () => void): () => void
  actions: TActions
  dispose(): void
}

/** Внутреннее ядро хранилища: то, чем пользуется его фабрика. */
export interface StoreCore<TState> {
  getState(): TState
  /** Слить патч в состояние и уведомить подписчиков (после dispose — no-op). */
  setState(patch: Partial<TState>): void
  /** Заменить состояние целиком (logout, полная очистка домена). */
  resetState(next: TState): void
  subscribe(listener: () => void): () => void
  /** Отменяемый таймер: снимается `clearTimers()` и `dispose()`. */
  timer(fn: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimer(id: ReturnType<typeof setTimeout> | null): void
  clearTimers(): void
  /** Отменяемый интервал: снимается `dispose()`. */
  interval(fn: () => void, ms: number): ReturnType<typeof setInterval>
  clearInterval(id: ReturnType<typeof setInterval> | null): void
  /** Освобождение ресурса домена (подписка моста, аудио, tail) при dispose. */
  onDispose(fn: () => void): void
  disposed(): boolean
  dispose(): void
}

export function createStoreCore<TState extends object>(initial: TState): StoreCore<TState> {
  let state = initial
  let dead = false
  const listeners = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const intervals = new Set<ReturnType<typeof setInterval>>()
  const cleanups: Array<() => void> = []

  function notify(): void {
    // Копия: слушатель может отписаться прямо в обработчике.
    for (const listener of [...listeners]) listener()
  }

  return {
    getState: () => state,
    setState(patch) {
      if (dead) return
      state = { ...state, ...patch }
      notify()
    },
    resetState(next) {
      if (dead) return
      state = next
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    timer(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id)
        if (!dead) fn()
      }, ms)
      timers.add(id)
      return id
    },
    clearTimer(id) {
      if (id === null) return
      clearTimeout(id)
      timers.delete(id)
    },
    clearTimers() {
      timers.forEach((id) => clearTimeout(id))
      timers.clear()
    },
    interval(fn, ms) {
      const id = setInterval(() => {
        if (!dead) fn()
      }, ms)
      intervals.add(id)
      return id
    },
    clearInterval(id) {
      if (id === null) return
      globalThis.clearInterval(id)
      intervals.delete(id)
    },
    onDispose(fn) {
      cleanups.push(fn)
    },
    disposed: () => dead,
    dispose() {
      if (dead) return
      dead = true
      timers.forEach((id) => clearTimeout(id))
      timers.clear()
      intervals.forEach((id) => globalThis.clearInterval(id))
      intervals.clear()
      // Порядок обратный регистрации: ресурс, открытый последним, закрываем первым.
      for (const fn of cleanups.reverse()) {
        try {
          fn()
        } catch {
          /* освобождение ресурса не должно рвать dispose остальных */
        }
      }
      cleanups.length = 0
      listeners.clear()
    }
  }
}

