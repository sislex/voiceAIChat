import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadPiperVoice } from './voiceDownload'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes)
      c.close()
    }
  })
}

describe('downloadPiperVoice', () => {
  it('качает onnx (с прогрессом) и config, репортит 100%', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voices-'))
    const percents: number[] = []
    const onnxBytes = new Uint8Array(10)
    const fakeFetch = async (url: string): Promise<never> => {
      if (url.endsWith('.onnx')) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => (n === 'content-length' ? '10' : null) },
          body: streamOf(onnxBytes),
          arrayBuffer: async () => new ArrayBuffer(0)
        } as never
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        arrayBuffer: async () => new TextEncoder().encode('{"config":true}').buffer
      } as never
    }

    try {
      await downloadPiperVoice('ru_RU-irina-medium', dir, (p) => percents.push(p), fakeFetch)
      expect(existsSync(join(dir, 'ru_RU-irina-medium.onnx'))).toBe(true)
      expect(readFileSync(join(dir, 'ru_RU-irina-medium.onnx.json'), 'utf8')).toContain('config')
      expect(percents[percents.length - 1]).toBe(100)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('бросает на неизвестном id', async () => {
    await expect(downloadPiperVoice('мусор', tmpdir(), () => {})).rejects.toThrow(/Неизвестный/)
  })
})
