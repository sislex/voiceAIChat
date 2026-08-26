// Засев голосов Piper. В Docker каталог голосов — пустой том, а скачивание голосов
// из UI убрано; без засева озвучка в контейнере не заработает никогда («No TTS
// engine available»). Образ несёт голос по умолчанию в seed-каталоге, и при старте
// раннер копирует полные пары .onnx + .onnx.json в voicesDir, если там ещё нет ни
// одного голоса. Уже наполненный каталог не трогаем: пользователь мог удалить голос.

import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Полные пары голосов (id → есть и .onnx, и .onnx.json) в каталоге; [] если каталога нет. */
async function completeVoiceIds(dir: string): Promise<string[]> {
  let files: string[]
  try { files = await readdir(dir) } catch { return [] }
  const set = new Set(files)
  return files.filter((f) => f.endsWith('.onnx') && set.has(`${f}.json`)).map((f) => f.slice(0, -5))
}

/** Копирует seed-голоса в пустой voicesDir; возвращает id скопированных (пусто — ничего не делали). */
export async function seedVoices(voicesDir: string, seedDir: string | undefined): Promise<string[]> {
  if (!seedDir) return []
  if ((await completeVoiceIds(voicesDir)).length > 0) return []
  const ids = await completeVoiceIds(seedDir)
  if (ids.length === 0) return []
  await mkdir(voicesDir, { recursive: true })
  for (const id of ids) {
    await copyFile(join(seedDir, `${id}.onnx`), join(voicesDir, `${id}.onnx`))
    await copyFile(join(seedDir, `${id}.onnx.json`), join(voicesDir, `${id}.onnx.json`))
  }
  return ids
}
