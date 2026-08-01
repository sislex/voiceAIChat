// Перенос картинок, созданных моделью, на машину разговора.
//
// Встроенный генератор Codex пишет png в профиль пользователя на исполнителе.
// После хода файл перекладывается на выбранную машину в
// `<корень проводника>/.generated_images`, откуда его раздаёт HTTP-сервер агента,
// а браузер тянет картинку напрямую.

import { basename } from 'node:path'
import { imageBlock, parseImages, type ImageRef } from '@voicechat/shared'

/** Каталог раздачи внутри корня машины (совпадает с IMAGE_DIR_NAME агента). */
export const MACHINE_IMAGE_DIR = '.generated_images'

export interface RelocateDeps {
  /** Чтение файла-картинки из сервера или исполнителя; null — не наш или не найден. */
  readFile(path: string): Promise<{ name: string; dataBase64: string } | null>
  /** Листинг машины: нужен только ради `root` (корня проводника). */
  fsList(agentId: string, path: string): Promise<{ root: string }>
  fsMkdir(agentId: string, path: string): Promise<unknown>
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<unknown>
}

/** Собирает путь внутри каталога раздачи машины (разделитель — как у корня). */
export function machineImagePath(root: string, name: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[/\\]$/, '')}${sep}${MACHINE_IMAGE_DIR}${sep}${name}`
}

export async function relocateImagesToMachine(
  text: string,
  agentId: string,
  deps: RelocateDeps
): Promise<string> {
  const { images } = parseImages(text)
  if (images.length === 0) return text

  const local: Array<{ img: ImageRef; file: { name: string; dataBase64: string } }> = []
  for (const img of images) {
    if (img.agentId) continue
    const file = await deps.readFile(img.path)
    if (file) local.push({ img, file })
  }
  if (local.length === 0) return text

  let root: string
  try {
    root = (await deps.fsList(agentId, '')).root
  } catch {
    return text
  }

  try {
    await deps.fsMkdir(agentId, machineImagePath(root, '').replace(/[/\\]$/, ''))
  } catch {
    /* already exists or write denied */
  }

  let out = text
  for (const { img, file } of local) {
    const name = basename(img.path || file.name)
    const target = machineImagePath(root, name)
    try {
      await deps.fsWrite(agentId, target, file.dataBase64)
    } catch {
      continue
    }
    const moved: ImageRef = {
      path: target,
      agentId,
      ...(img.caption ? { caption: img.caption } : {})
    }
    out = replaceImage(out, img, moved)
  }
  return out
}

function replaceImage(text: string, from: ImageRef, to: ImageRef): string {
  const block = imageBlock(to)
  const fenced = new RegExp(
    '```image[^\\S\\n]*\\n[\\s\\S]*?' + escapeRe(from.path) + '[\\s\\S]*?```[^\\S\\n]*'
  )
  if (fenced.test(text)) return text.replace(fenced, block)
  const md = new RegExp('!\\[[^\\]]*\\]\\(\\s*<?' + escapeRe(from.path) + '>?[^)]*\\)')
  if (md.test(text)) return text.replace(md, block)
  return text
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
