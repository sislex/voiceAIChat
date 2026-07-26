// Перенос картинок, созданных моделью, на машину разговора.
//
// Встроенный генератор Codex пишет png в профиль пользователя НА СЕРВЕРЕ (CLI
// крутится в контейнере). Показывать оттуда можно, но байты тогда идут через
// сервер дважды. Поэтому после хода файл перекладывается на выбранную машину в
// `<корень проводника>/.generated_images`, откуда его раздаёт HTTP-сервер агента,
// а браузер тянет картинку напрямую.
//
// В тексте сообщения адрес НЕ сохраняется: IP машины меняется. Сохраняем путь на
// машине + agentId, а URL клиент собирает заново из живого AgentInfo.

import { basename } from 'node:path'
import { imageBlock, parseImages, type ImageRef } from '@voicechat/shared'
import { readUserFile } from './serverFiles.js'

/** Каталог раздачи внутри корня машины (совпадает с IMAGE_DIR_NAME агента). */
export const MACHINE_IMAGE_DIR = '.generated_images'

export interface RelocateDeps {
  /** Корни «своей» области сервера — откуда вообще можно забирать файл. */
  roots: string[]
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

/**
 * Перекладывает на машину все картинки ответа, которые лежат на сервере, и
 * возвращает текст с переписанными блоками. Любая осечка (машина офлайн, нет
 * прав на запись, файл не наш) оставляет соответствующую картинку как была —
 * она по-прежнему покажется через сервер.
 */
export async function relocateImagesToMachine(
  text: string,
  agentId: string,
  deps: RelocateDeps
): Promise<string> {
  const { images } = parseImages(text)
  if (images.length === 0) return text

  // Забираем только то, что действительно лежит у нас и ещё не привязано к машине.
  const local = images.filter((img) => !img.agentId && readUserFile(img.path, deps.roots).ok)
  if (local.length === 0) return text

  let root: string
  try {
    root = (await deps.fsList(agentId, '')).root
  } catch {
    return text // машина офлайн или не отвечает — оставляем всё как есть
  }

  // Каталог создаём один раз на ход; уже существующий — не ошибка.
  try {
    await deps.fsMkdir(agentId, machineImagePath(root, '').replace(/[/\\]$/, ''))
  } catch {
    /* уже есть либо запись запрещена — вторая ошибка вылезет на fsWrite */
  }

  let out = text
  for (const img of local) {
    const file = readUserFile(img.path, deps.roots)
    if (!file.ok) continue
    const name = basename(img.path)
    const target = machineImagePath(root, name)
    try {
      await deps.fsWrite(agentId, target, file.file.dataBase64)
    } catch {
      continue // не записалось — эта картинка останется серверной
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

/**
 * Меняет ссылку на картинку в тексте: блок ```image перезаписывается, а
 * markdown-картинка с локальным путём заменяется на блок (её всё равно не
 * отрисовать браузером).
 */
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
