// Копирование в буфер обмена. Изолировано ради тестируемости и fallback:
// navigator.clipboard доступен только в secure context; иначе — execCommand.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* упало (нет прав/insecure) — пробуем fallback ниже */
  }
  let ta: HTMLTextAreaElement | null = null
  try {
    ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta?.remove()
  }
}

/**
 * Копирует картинку в буфер. Работает только через async clipboard API
 * (ClipboardItem); Safari/Firefox без image/png в буфере вернут false — вызывающий
 * показывает «не получилось», а пользователь всегда может скачать файл.
 */
export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (!CI || !navigator?.clipboard?.write) return false
    await navigator.clipboard.write([new CI({ [blob.type]: blob })])
    return true
  } catch {
    return false
  }
}
