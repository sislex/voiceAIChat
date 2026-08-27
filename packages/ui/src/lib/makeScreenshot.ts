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
  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    logging: false,
    windowWidth: target.width ?? target.doc.documentElement.clientWidth,
    scale: Math.min(2, window.devicePixelRatio || 1)
  })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Не удалось получить изображение')
  return new File([blob], filename, { type: 'image/png' })
}
