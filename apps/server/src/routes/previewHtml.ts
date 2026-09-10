import { rewritePreviewSrcset } from './previewStyles.js'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Element = DefaultTreeAdapterMap['element']
type Node = DefaultTreeAdapterMap['node']
interface Edit { start: number; end: number; value: string }
interface HtmlTransforms {
  url: (value: string, base: URL) => string
  css: (value: string, base: URL) => string
  module: (value: string, base: URL) => string
  importMap: (value: string, base: URL) => string
  context: (base: URL) => string
  inspector: string
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/**
 * Правим только диапазоны реальных атрибутов. Сериализация всего DOM меняет
 * пользовательский HTML, а regexp путал атрибуты с data-* и строками скриптов.
 */
export function rewritePreviewHtml(source: string, page: URL, transforms: HtmlTransforms): string {
  const document = parse(source, { sourceCodeLocationInfo: true })
  const elements: Element[] = []
  const visit = (node: Node): void => {
    if ('tagName' in node) elements.push(node)
    if ('childNodes' in node) node.childNodes.forEach(visit)
    if ('content' in node) visit(node.content as Node)
  }
  visit(document)
  const attr = (el: Element, name: string): string | undefined => el.attrs.find(item => item.name === name)?.value
  let base = page
  const baseElement = elements.find(el => el.tagName === 'base' && attr(el, 'href') !== undefined)
  if (baseElement) {
    try { const candidate = new URL(attr(baseElement, 'href')!, page); if (/^https?:$/.test(candidate.protocol)) base = candidate } catch { /* браузер тоже игнорирует некорректную базу */ }
  }
  const edits: Edit[] = []
  const replaceAttribute = (el: Element, name: string, value: string | null): void => {
    const loc = el.sourceCodeLocation?.attrs?.[name]
    if (loc) edits.push({ start: loc.startOffset, end: loc.endOffset, value: value === null ? '' : `${name}="${escapeAttribute(value)}"` })
  }
  for (const el of elements) {
    const loc = el.sourceCodeLocation
    if (!loc) continue
    if (el.tagName === 'base' || el.tagName === 'meta' && attr(el, 'http-equiv')?.toLowerCase() === 'content-security-policy') {
      edits.push({ start: loc.startOffset, end: loc.endOffset, value: '' })
      continue
    }
    for (const item of el.attrs) {
      if (['href', 'src', 'action', 'formaction', 'poster'].includes(item.name)) {
        // Якорь должен менять hash текущего документа без повторного open.
        const value = item.value.trim().startsWith('#') ? item.value : transforms.url(item.value, base)
        replaceAttribute(el, item.name, value)
      } else if (item.name === 'style') replaceAttribute(el, item.name, transforms.css(item.value, base))
      else if (item.name === 'srcset' || item.name === 'imagesrcset') {
        replaceAttribute(el, item.name, rewritePreviewSrcset(item.value, base, transforms.url))
      } else if (item.name === 'target' && ['_blank', '_parent', '_top'].includes(item.value.toLowerCase())) replaceAttribute(el, item.name, '_self')
      else if (item.name === 'integrity' && (el.tagName === 'script' || el.tagName === 'link')) replaceAttribute(el, item.name, null)
    }
    if (loc.startTag && loc.endTag) {
      const start = loc.startTag.endOffset; const end = loc.endTag.startOffset
      if (el.tagName === 'style') edits.push({ start, end, value: transforms.css(source.slice(start, end), base) })
      if (el.tagName === 'script' && attr(el, 'type')?.toLowerCase() === 'importmap') {
        edits.push({ start, end, value: transforms.importMap(source.slice(start, end), base) })
      }
      if (el.tagName === 'script' && attr(el, 'type')?.toLowerCase() === 'module' && !attr(el, 'src')) {
        edits.push({ start, end, value: transforms.module(source.slice(start, end), base) })
      }
    }
  }
  const head = elements.find(el => el.tagName === 'head')?.sourceCodeLocation?.startTag?.endOffset ?? 0
  const body = elements.find(el => el.tagName === 'body')?.sourceCodeLocation?.endTag?.startOffset ?? source.length
  edits.push({ start: head, end: head, value: transforms.context(base) }, { start: body, end: body, value: transforms.inspector })
  // Координаты парсера относятся к оригиналу, поэтому применяем с конца.
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
  return source
}
