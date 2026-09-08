// Сток чанков вывода команды с обратным давлением. Исполнитель отдаёт чанки со скоростью машины,
// а запись в базу асинхронна: если звать `appendCiLog` на каждый чанк и не ждать, в полёте
// оказываются тысячи записей, каждая со своей копией данных — так ядро на проде упиралось в потолок
// кучи посреди регрессии релиза (2026-09-08). Сток копит чанки в одном буфере, пишет их одной записью
// не чаще интервала и держит не больше одной записи в полёте; память ограничена объёмом вывода за
// время одной записи, а не всем выводом команды.
export interface ChunkSink {
  /** Принять чанк — синхронно, без ожидания записи. */
  push(data: string): void
  /** Дописать всё накопленное и дождаться записей в полёте; ошибка записи всплывает здесь. */
  flush(): Promise<void>
}

export interface ChunkSinkOptions {
  /** Пауза между записями, пока предыдущая не завершилась и буфер не переполнен. */
  intervalMs?: number
  /** Буфер такого размера пишется сразу, не дожидаясь интервала. */
  maxBytes?: number
}

export function createChunkSink(write: (data: string) => Promise<void> | void, opts: ChunkSinkOptions = {}): ChunkSink {
  const intervalMs = opts.intervalMs ?? 200
  const maxBytes = opts.maxBytes ?? 64 * 1024
  let buffer: string[] = []
  let bytes = 0
  let timer: NodeJS.Timeout | null = null
  let inflight: Promise<void> | null = null
  let failure: unknown = null

  const drain = (): Promise<void> => {
    if (inflight) return inflight
    if (!buffer.length) return Promise.resolve()
    const data = buffer.join('')
    buffer = []
    bytes = 0
    inflight = Promise.resolve()
      .then(() => write(data))
      .catch((error) => { failure ??= error })
      .then(() => {
        inflight = null
        // Пока писали, накопилось ещё — пишем следом, не дожидаясь интервала.
        if (buffer.length) void drain()
      })
    return inflight
  }
  const schedule = (): void => {
    if (timer || inflight) return
    timer = setTimeout(() => { timer = null; void drain() }, intervalMs)
    timer.unref?.()
  }

  return {
    push(data) {
      if (!data) return
      buffer.push(data)
      bytes += data.length
      if (bytes >= maxBytes) { if (timer) { clearTimeout(timer); timer = null } void drain() } else schedule()
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null }
      while (inflight || buffer.length) await drain()
      if (failure) { const error = failure; failure = null; throw error }
    }
  }
}
