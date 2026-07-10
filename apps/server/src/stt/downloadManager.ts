// Процесс-глобальный менеджер скачивания модели Whisper.
//
// Зачем: скачивание не должно быть привязано к конкретному WS-соединению. Клиент
// может обновить страницу (переподключиться) посреди загрузки — новое соединение
// должно немедленно увидеть текущий прогресс и дождаться завершения. Раньше прогресс
// слался в закрытый сокет и терялся, а состояние нигде не хранилось.
//
// Менеджер держит единственную активную загрузку на процесс, хранит её состояние и
// рассылает события всем подписчикам (сессиям). При подписке во время активной
// загрузки сразу отдаёт текущий процент — так обновлённая страница восстанавливает
// прогресс-бар.

/** События, совпадающие по форме с соответствующими ServerMessage. */
export type DownloadEvent =
  | { t: 'stt.downloadProgress'; percent: number }
  | { t: 'stt.downloadDone' }
  | { t: 'stt.downloadError'; message: string }

export interface DownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error'
  percent: number
  message?: string
}

type Listener = (ev: DownloadEvent) => void

export class ModelDownloadManager {
  private state: DownloadState = { status: 'idle', percent: 0 }
  private listeners = new Set<Listener>()

  /** `run` инкапсулирует конкретную загрузку (модель/каталог берутся при вызове). */
  constructor(private readonly run: (onProgress: (percent: number) => void) => Promise<void>) {}

  getState(): DownloadState {
    return this.state
  }

  /** Запускает загрузку, если она ещё не идёт (идемпотентно). */
  start(): void {
    if (this.state.status === 'downloading') return
    this.state = { status: 'downloading', percent: 0 }
    this.emit({ t: 'stt.downloadProgress', percent: 0 })
    void this.run((percent) => {
      this.state = { status: 'downloading', percent }
      this.emit({ t: 'stt.downloadProgress', percent })
    })
      .then(() => {
        this.state = { status: 'done', percent: 100 }
        this.emit({ t: 'stt.downloadDone' })
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        this.state = { status: 'error', percent: this.state.percent, message }
        this.emit({ t: 'stt.downloadError', message })
      })
  }

  /**
   * Подписка на события. Возвращает функцию отписки. Если загрузка активна —
   * сразу отдаёт подписчику текущий прогресс (для восстановления UI после рефреша).
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.state.status === 'downloading') {
      listener({ t: 'stt.downloadProgress', percent: this.state.percent })
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(ev: DownloadEvent): void {
    for (const l of this.listeners) l(ev)
  }
}
