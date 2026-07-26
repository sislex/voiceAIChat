// Завершение агента по сигналу.
//
// Явный слушатель здесь — не косметика. Без него процесс наследует расположение
// сигнала от того, кто его запустил: если родитель игнорировал SIGTERM (а обёртки
// вида `setsid nohup …` это делают), агент тоже его игнорирует, и `pkill` его не
// гасит. Установщик считал старый агент остановленным и поднимал второй — два
// соединения с одним токеном вытесняли друг друга по кругу, машина «мигала».
// Добавленный слушатель делает расположение «обрабатывается», и SIGTERM работает.

/** Что нужно от соединения при остановке (полный AgentConnection тоже подходит). */
export interface Stoppable {
  stop(): void
}

/** Сколько ждём тихого завершения, прежде чем выйти принудительно. */
export const FORCE_EXIT_MS = 3000

export interface SignalDeps {
  /** Подписка на сигнал (по умолчанию process.on). */
  on?: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void
  /** Выход из процесса (по умолчанию process.exit). */
  exit?: (code: number) => void
  /** Таймер принудительного выхода (по умолчанию setTimeout + unref). */
  setTimer?: (fn: () => void, ms: number) => void
  log?: (message: string) => void
}

/**
 * Вешает обработчики SIGTERM/SIGINT: закрываем соединение и выходим. Второй
 * сигнал — выходим немедленно, не дожидаясь ничего.
 */
export function installSignalHandlers(connection: Stoppable, deps: SignalDeps = {}): void {
  const on = deps.on ?? ((s, h) => void process.on(s, h))
  const exit = deps.exit ?? ((code) => process.exit(code))
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      // unref: таймер не должен сам держать процесс живым.
      setTimeout(fn, ms).unref()
    })
  const log = deps.log ?? ((m) => console.log(m))

  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    on(signal, () => {
      if (stopping) {
        exit(1)
        return
      }
      stopping = true
      log(`[agent] ${signal} — завершаюсь`)
      try {
        connection.stop()
      } catch {
        /* уже остановлено — не мешаем выходу */
      }
      // Страховка: если что-то держит event loop (открытое соединение раздачи
      // картинок, живой PTY), всё равно уходим.
      setTimer(() => exit(0), FORCE_EXIT_MS)
    })
  }
}
