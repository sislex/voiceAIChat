// Свёрнутость панелей чата: виджет задачи сверху (`TaskChatHeader`) и композер
// снизу (`VoiceBar`). Обе панели занимают постоянную высоту колонки, и на
// телефоне вдвоём (особенно с раскрытой лентой рана) они не оставляли ленте
// сообщений и сотни пикселей — поэтому каждую можно убрать в одну строку.
//
// Состояние переживает перезагрузку и переключение чата: панель, свёрнутую
// ради места, незачем разворачивать заново на каждом разговоре. Хранится в
// localStorage — это предпочтение вида, а не данные, и на сервер ему не надо.

import { useCallback, useEffect, useState } from 'react'

/** Ключи хранилища: префикс `vc:`, как у недавних команд в `lib/commands.ts`. */
export const COMPOSER_COLLAPSE_KEY = 'vc:chat:composer-collapsed'
export const TASK_HEADER_COLLAPSE_KEY = 'vc:chat:task-header-collapsed'

/** Прочитать сохранённую свёрнутость. Нет ключа или мусор — панель раскрыта. */
export function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // Приватный режим: панель просто всегда открыта после перезагрузки.
    return false
  }
}

function writeCollapsed(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Персиста нет — сворачивание работает, просто до перезагрузки.
  }
}

/**
 * Свёрнутость панели: текущее значение и переключатель. Запись — эффектом, а не
 * внутри `setState`: обновляющая функция обязана быть чистой (StrictMode зовёт
 * её дважды).
 */
export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(key))
  useEffect(() => {
    writeCollapsed(key, collapsed)
  }, [key, collapsed])
  const toggle = useCallback(() => setCollapsed((prev) => !prev), [])
  return [collapsed, toggle]
}
