import { describe, it, expect } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadModel, modelUrl, progressPercent } from './download'

describe('modelUrl / progressPercent', () => {
  it('строит URL GGML на HuggingFace', () => {
    expect(modelUrl('small')).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
    )
  })

  it('считает процент, безопасен к нулевому total', () => {
    expect(progressPercent(0, 100)).toBe(0)
    expect(progressPercent(50, 100)).toBe(50)
    expect(progressPercent(200, 100)).toBe(100) // клип
    expect(progressPercent(10, 0)).toBe(0) // неизвестный размер
  })
})

describe('downloadModel', () => {
  it('стримит в файл и репортит прогресс до 100%', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7, 8, 9, 10])]
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(ch))
        c.close()
      }
    })
    const fakeFetch = async (): Promise<never> =>
      ({
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n === 'content-length' ? '10' : null) },
        body
      }) as never

    const dir = tmpdir()
    const percents: number[] = []
    await downloadModel('small', dir, (p) => percents.push(p), fakeFetch)

    const dest = join(dir, 'ggml-small.bin')
    try {
      const data = readFileSync(dest)
      expect(data.length).toBe(10)
      expect(percents[percents.length - 1]).toBe(100)
      expect(percents).toContain(30)
    } finally {
      rmSync(dest, { force: true })
    }
  })

  it('бросает и чистит файл при HTTP-ошибке', async () => {
    const fakeFetch = async (): Promise<never> =>
      ({ ok: false, status: 404, headers: { get: () => null }, body: null }) as never
    await expect(downloadModel('small', tmpdir(), () => {}, fakeFetch)).rejects.toThrow(/404/)
  })

  it('создаёт каталог моделей, если его нет (не роняет процесс)', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3, 4, 5]))
        c.close()
      }
    })
    const fakeFetch = async (): Promise<never> =>
      ({
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n === 'content-length' ? '5' : null) },
        body
      }) as never

    const dir = join(tmpdir(), `vc-dl-${Date.now()}`, 'models') // ещё не существует
    await downloadModel('small', dir, () => {}, fakeFetch)
    const dest = join(dir, 'ggml-small.bin')
    try {
      expect(readFileSync(dest).length).toBe(5)
    } finally {
      rmSync(dest, { force: true })
    }
  })
})
