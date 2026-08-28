// Скриншот превью Make (п.10): same-origin iframe → html2canvas по документу iframe → PNG-файл
// для вложения в чат. Библиотека грузится лениво: нужна редко, а весит ~200 КБ.
export interface ScreenshotTarget {
  doc: Document
  /** Элемент внутри документа; по умолчанию — вся страница. */
  element?: Element | null
  /** Ширина viewport iframe — чтобы медиа-запросы совпали с тем, что видит пользователь. */
  width?: number
}

/** CSS документа для клона: правила читаемых таблиц одним текстом + href тех <link>, что удалось прочитать. */
export function collectInlineCss(doc: Document): { cssText: string; inlinedHrefs: Set<string> } {
  const parts: string[] = []
  const inlinedHrefs = new Set<string>()
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      parts.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'))
      if (sheet.href) inlinedHrefs.add(sheet.href)
    } catch { /* кросс-доменная таблица — оставим её <link> в клоне */ }
  }
  return { cssText: parts.join('\n'), inlinedHrefs }
}

export async function captureIframeScreenshot(target: ScreenshotTarget, filename = 'preview.png'): Promise<File> {
  const { default: html2canvas } = await import('html2canvas')
  const el = (target.element ?? target.doc.documentElement) as HTMLElement
  // html2canvas перезапрашивает <link rel=stylesheet> сам — без preview-cookie превью отдаёт 401, и снимок
  // выходит «голым». Поэтому правила same-origin таблиц инлайним в клон, а их <link> убираем; кросс-доменные
  // (Google Fonts и т.п., cssRules недоступны) оставляем — их html2canvas дотянет сам (roadmap-3 п.5).
  const { cssText, inlinedHrefs } = collectInlineCss(target.doc)
  // Дождаться загрузки веб-шрифтов, иначе клон отрисуется запасным шрифтом.
  try { await (target.doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready } catch { /* без FontFaceSet — как есть */ }
  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    logging: false,
    onclone: (cloned) => {
      cloned.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((l) => { if (inlinedHrefs.has(l.href)) l.remove() })
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
