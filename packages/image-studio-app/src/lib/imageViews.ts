// Виды галереи студии: снимок условий отбора и порядка, его человеческая
// подпись и упаковка в ссылку. Чистая логика — панель только применяет
// результат, поэтому и подпись, и разбор ссылки проверяются без DOM.

/** Снимок вида галереи: что отобрано и в каком порядке показано. */
export interface StudioView {
  query?: string
  origin?: '' | 'ai' | 'own' | 'derived'
  mark?: '' | 'noted' | 'draft' | 'ready' | 'none'
  set?: string
  kind?: string
  order?: 'new' | 'name' | 'size' | 'stars' | 'ready' | 'pixels' | 'noted' | 'tint'
  grouped?: boolean
  starsOnly?: boolean
  /** Ориентация по известным размерам превью. */
  shape?: '' | 'square' | 'portrait' | 'landscape'
}

const ORDER_LABELS: Record<string, string> = {
  name: 'по имени',
  size: 'по размеру',
  pixels: 'по разрешению',
  noted: 'с заметками вперёд',
  tint: 'по цвету',
  stars: 'избранные вперёд',
  ready: 'готовые вперёд'
}
const MARK_LABELS: Record<string, string> = { noted: 'с заметкой', draft: 'черновики', ready: 'готовые', none: 'неразобранное' }
const ORIGIN_LABELS: Record<string, string> = { ai: 'нарисованные', own: 'свои файлы', derived: 'производные' }
const SHAPE_LABELS: Record<string, string> = { square: 'квадратные', portrait: 'портрет', landscape: 'пейзаж' }

/** Человеческая подпись вида: в списке видно, что он отбирает. */
export function viewSummary(view: StudioView): string {
  const parts = [
    view.query ? `«${view.query}»` : '',
    view.origin ? ORIGIN_LABELS[view.origin] ?? '' : '',
    view.mark ? MARK_LABELS[view.mark] ?? '' : '',
    view.set ? `набор «${view.set}»` : '',
    view.kind ? view.kind.toUpperCase() : '',
    view.shape ? SHAPE_LABELS[view.shape] ?? '' : '',
    view.starsOnly ? 'только избранные' : '',
    view.grouped ? 'по датам' : '',
    view.order && ORDER_LABELS[view.order] ? ORDER_LABELS[view.order]! : ''
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'без условий'
}

/** Пустой вид: у него нет ни одного условия и порядок обычный. */
export function isEmptyView(view: StudioView): boolean {
  return Object.entries(view).every(([, value]) => value === '' || value === false || value === undefined)
}

/**
 * Вид → сегмент ссылки. Только заданные поля: короткая ссылка читается
 * глазами, а пустые условия всё равно означают «снято».
 */
export function encodeStudioView(view: StudioView): string {
  const params = new URLSearchParams()
  if (view.query) params.set('q', view.query)
  if (view.origin) params.set('from', view.origin)
  if (view.mark) params.set('mark', view.mark)
  if (view.set) params.set('set', view.set)
  if (view.kind) params.set('kind', view.kind)
  if (view.shape) params.set('shape', view.shape)
  if (view.order && view.order !== 'new') params.set('order', view.order)
  if (view.grouped) params.set('grouped', '1')
  if (view.starsOnly) params.set('stars', '1')
  return params.toString()
}

/**
 * Сегмент ссылки → вид. Незнакомые значения отбрасываются: ссылка приходит
 * извне, и «order=rm -rf» не должен становиться состоянием панели.
 */
export function decodeStudioView(raw: string): StudioView {
  const params = new URLSearchParams(raw)
  const pick = <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const value = params.get(name)
    return value && (allowed as readonly string[]).includes(value) ? value as T : undefined
  }
  const view: StudioView = {}
  const query = params.get('q')
  if (query) view.query = query
  const origin = pick('from', ['ai', 'own', 'derived'] as const)
  if (origin) view.origin = origin
  const mark = pick('mark', ['noted', 'draft', 'ready', 'none'] as const)
  if (mark) view.mark = mark
  const set = params.get('set')
  if (set) view.set = set
  const kind = params.get('kind')
  // Расширение — короткое слово из букв и цифр: всё прочее в галерее не живёт.
  if (kind && /^[a-z0-9]{1,8}$/i.test(kind)) view.kind = kind.toLowerCase()
  const shape = pick('shape', ['square', 'portrait', 'landscape'] as const)
  if (shape) view.shape = shape
  const order = pick('order', ['name', 'size', 'pixels', 'stars', 'ready', 'noted', 'tint'] as const)
  if (order) view.order = order
  if (params.get('grouped') === '1') view.grouped = true
  if (params.get('stars') === '1') view.starsOnly = true
  return view
}

/** Ориентация по подписи размеров вида «1024×768»; null — размер неизвестен. */
export function shapeOf(dimensions: string | undefined): 'square' | 'portrait' | 'landscape' | null {
  const [width, height] = (dimensions ?? '').split('×').map((part) => Number.parseInt(part, 10))
  if (!width || !height) return null
  // Пять процентов допуска: 1024×1000 глазами квадрат, а не портрет.
  if (Math.abs(width - height) / Math.max(width, height) < 0.05) return 'square'
  return width > height ? 'landscape' : 'portrait'
}

/** Площадь в пикселях для сортировки «по разрешению»; 0 — размер неизвестен. */
export function pixelsOf(dimensions: string | undefined): number {
  const [width, height] = (dimensions ?? '').split('×').map((part) => Number.parseInt(part, 10))
  return width && height ? width * height : 0
}
