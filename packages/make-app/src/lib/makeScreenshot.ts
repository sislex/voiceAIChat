// Make preview screenshot (item 10): capture the same-origin iframe document with html2canvas and
// attach the PNG to chat. Load the roughly 200 KB library lazily because screenshots are
// infrequent.
export interface ScreenshotTarget {
  doc: Document
  /** Target element inside the document; defaults to the whole page. */
  element?: Element | null
  /** Iframe viewport width so media queries match what the user sees. */
  width?: number
}

/** Clone CSS: combine readable stylesheet rules and record hrefs of successfully read links. */
export function collectInlineCss(doc: Document): { cssText: string; inlinedHrefs: Set<string> } {
  const parts: string[] = []
  const inlinedHrefs = new Set<string>()
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      parts.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'))
      if (sheet.href) inlinedHrefs.add(sheet.href)
    } catch { /* Keep cross-origin stylesheet links in the clone. */ }
  }
  return { cssText: parts.join('\n'), inlinedHrefs }
}

export async function captureIframeScreenshot(target: ScreenshotTarget, filename = 'preview.png'): Promise<File> {
  const { default: html2canvas } = await import('html2canvas')
  const el = (target.element ?? target.doc.documentElement) as HTMLElement
  // html2canvas refetches stylesheet links without the preview cookie, causing 401 responses and
  // unstyled screenshots. Inline readable same-origin rules into the clone and remove their links.
  // Keep cross-origin links such as Google Fonts, whose cssRules cannot be read, for html2canvas to
  // load itself (roadmap-3, item 5).
  const { cssText, inlinedHrefs } = collectInlineCss(target.doc)
  // Wait for web fonts so the clone does not render with fallback fonts.
  try { await (target.doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready } catch { /* Continue without FontFaceSet. */ }
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
