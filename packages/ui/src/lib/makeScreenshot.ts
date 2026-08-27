// Скриншот превью Make (п.10): same-origin iframe → html2canvas по документу iframe → PNG-файл
// для вложения в чат. Библиотека грузится лениво: нужна редко, а весит ~200 КБ.
export interface ScreenshotTarget {
  doc: Document
  /** Элемент внутри документа; по умолчанию — вся страница. */
  element?: Element | null
  /** Ширина viewport iframe — чтобы медиа-запросы совпали с тем, что видит пользователь. */
  width?: number
}

export async function captureIframeScreenshot(target: ScreenshotTarget, filename = 'preview.png'): Promise<File> {
  const { default: html2canvas } = await import('html2canvas')
  const el = (target.element ?? target.doc.documentElement) as HTMLElement
  // html2canvas перезапрашивает <link rel=stylesheet> сам — без preview-cookie превью отдаёт 401, и снимок
  // выходит «голым». Поэтому правила уже загруженных таблиц инлайним в клон документа, а ссылки убираем.
  const cssText = Array.from(target.doc.styleSheets).map((sheet) => {
    try { return Array.from(sheet.cssRules).map((r) => r.cssText).join('\n') } catch { return '' }
  }).join('\n')
  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    logging: false,
    onclone: (cloned) => {
      cloned.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.remove())
      const style = cloned.createElement('style')
      style.textContent = cssText
      cloned.head.appendChild(style)
    },
    windowWidth: target.width ?? target.doc.documentElement.clientWidth,
    scale: Math.min(2, window.devicePixelRatio || 1)
  })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Не удалось получить изображение')
  return new File([blob], filename, { type: 'image/png' })
}
