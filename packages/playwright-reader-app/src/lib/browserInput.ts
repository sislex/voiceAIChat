import type { BrowserInputAction } from '@shared/types'

export interface FrameKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}
const SPECIAL = new Set([
  'Enter',
  'Backspace',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert'
])

/** Вставку обрабатывает paste с реальным текстом; Ctrl+V в другом Chromium
 * прочитал бы его собственный пустой буфер. IME не отправляет промежуточные keydown. */
export function frameKeyAction(event: FrameKeyEvent): BrowserInputAction | null {
  if (event.isComposing || ['Dead', 'Process', 'Unidentified'].includes(event.key)) return null
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return null
  const printable = Array.from(event.key).length === 1
  if (printable && !event.ctrlKey && !event.metaKey && !event.altKey) return { type: 'type', text: event.key }
  if (!SPECIAL.has(event.key) && !(printable && (event.ctrlKey || event.metaKey || event.altKey))) return null
  const modifiers: string[] = []
  // Редактор работает на машине раннера: привычные сочетания выбора/отмены
  // должны использовать её primary modifier, даже если панель открыта на macOS.
  const editing = /^(a|c|x|z|y)$/i.test(event.key)
  if (editing && (event.ctrlKey || event.metaKey)) modifiers.push('ControlOrMeta')
  else {
    if (event.ctrlKey) modifiers.push('Control')
    if (event.metaKey) modifiers.push('Meta')
  }
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  const key =
    event.key === ' ' ? 'Space' : printable && (event.ctrlKey || event.metaKey) ? event.key.toLowerCase() : event.key
  return { type: 'press', key: [...modifiers, key].join('+') }
}

/** DOM_DELTA_LINE не равен пикселю. Для кадров без живого DOM используем 16px
 * на строку, а page — фактический размер вьюпорта по соответствующей оси. */
export function frameWheelDelta(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  viewport: { width: number; height: number }
): { deltaX: number; deltaY: number } {
  const x = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.width : 1
  const y = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
  return { deltaX: Math.round(event.deltaX * x), deltaY: Math.round(event.deltaY * y) }
}

/** Ответ прежнего запроса не должен стирать уже набранное продолжение. */
export function remainingTypedDraft(current: string, submitted: string): string {
  return current.startsWith(submitted) ? current.slice(submitted.length) : current
}
