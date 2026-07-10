// Скачивание голоса Piper (.onnx + .onnx.json) с прогрессом. Чистая логика +
// стриминг; fetch инжектируется для тестов.

import { createWriteStream } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { progressPercent } from '../stt/download'
import { voiceUrls } from './piperCatalog'

type FetchLike = (url: string) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
  body: ReadableStream<Uint8Array> | null
}>

async function streamToFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  fetchImpl: FetchLike
): Promise<void> {
  const res = await fetchImpl(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const out = createWriteStream(dest)
  let received = 0
  let last = -1
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      out.write(Buffer.from(value))
      const p = progressPercent(received, total)
      if (p !== last) {
        last = p
        onProgress(p)
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
  } catch (err) {
    out.destroy()
    await rm(dest, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Скачивает голос Piper по id в `voicesDir`: сначала .onnx (с прогрессом),
 * затем небольшой .onnx.json. При ошибке удаляет частичные файлы.
 */
export async function downloadPiperVoice(
  id: string,
  voicesDir: string,
  onProgress: (percent: number) => void,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<void> {
  const urls = voiceUrls(id)
  if (!urls) throw new Error(`Неизвестный голос: ${id}`)

  const onnxPath = join(voicesDir, `${id}.onnx`)
  const configPath = join(voicesDir, `${id}.onnx.json`)

  await streamToFile(urls.onnx, onnxPath, onProgress, fetchImpl)

  const cfgRes = await fetchImpl(urls.config)
  if (!cfgRes.ok) {
    await rm(onnxPath, { force: true }).catch(() => {})
    throw new Error(`HTTP ${cfgRes.status} (config)`)
  }
  await writeFile(configPath, Buffer.from(await cfgRes.arrayBuffer()))
  onProgress(100)
}
