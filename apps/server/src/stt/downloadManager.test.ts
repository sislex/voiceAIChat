import { describe, it, expect } from 'vitest'
import { ModelDownloadManager, type DownloadEvent } from './downloadManager.js'

/** Управляемая загрузка: резолвим/реджектим вручную, дёргаем onProgress. */
function deferredRun() {
  let onProgress!: (p: number) => void
  let resolve!: () => void
  let reject!: (e: Error) => void
  const run = (op: (p: number) => void) => {
    onProgress = op
    return new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
  }
  return { run, progress: (p: number) => onProgress(p), resolve, finish: () => resolve(), fail: (e: Error) => reject(e) }
}

describe('ModelDownloadManager', () => {
  it('идемпотентный start: повторный вызов во время загрузки не перезапускает', async () => {
    let runs = 0
    const mgr = new ModelDownloadManager(() => {
      runs++
      return new Promise<void>(() => {}) // висит
    })
    mgr.start()
    mgr.start()
    expect(runs).toBe(1)
    expect(mgr.getState().status).toBe('downloading')
  })

  it('новый подписчик во время загрузки сразу получает текущий прогресс', () => {
    const d = deferredRun()
    const mgr = new ModelDownloadManager(d.run)
    mgr.start()
    d.progress(42)

    // «Рефреш»: подписывается новое соединение уже после старта.
    const got: DownloadEvent[] = []
    mgr.subscribe((ev) => got.push(ev))
    expect(got).toEqual([{ t: 'stt.downloadProgress', percent: 42 }])
  })

  it('прогресс и done рассылаются всем подписчикам', async () => {
    const d = deferredRun()
    const mgr = new ModelDownloadManager(d.run)
    const a: DownloadEvent[] = []
    const b: DownloadEvent[] = []
    mgr.subscribe((ev) => a.push(ev))
    mgr.subscribe((ev) => b.push(ev))
    mgr.start()
    d.progress(50)
    d.finish()
    await new Promise((r) => setTimeout(r, 0))

    for (const log of [a, b]) {
      expect(log).toContainEqual({ t: 'stt.downloadProgress', percent: 50 })
      expect(log).toContainEqual({ t: 'stt.downloadDone' })
    }
    expect(mgr.getState().status).toBe('done')
  })

  it('ошибка загрузки рассылается как downloadError', async () => {
    const d = deferredRun()
    const mgr = new ModelDownloadManager(d.run)
    const got: DownloadEvent[] = []
    mgr.subscribe((ev) => got.push(ev))
    mgr.start()
    d.fail(new Error('сеть упала'))
    await new Promise((r) => setTimeout(r, 0))

    expect(got).toContainEqual({ t: 'stt.downloadError', message: 'сеть упала' })
    expect(mgr.getState().status).toBe('error')
  })

  it('отписка прекращает доставку событий', () => {
    const d = deferredRun()
    const mgr = new ModelDownloadManager(d.run)
    const got: DownloadEvent[] = []
    const off = mgr.subscribe((ev) => got.push(ev))
    mgr.start()
    off()
    d.progress(77)
    expect(got).not.toContainEqual({ t: 'stt.downloadProgress', percent: 77 })
  })
})
