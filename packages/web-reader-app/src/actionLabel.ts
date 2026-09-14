import type { PreviewAction } from '@shared/previewActions'

/** Адрес в ленте — как в адресной строке: host и путь без схемы, не длиннее 60 символов. */
function shortUrl(url: string): string {
  try { const parsed = new URL(url); const text = parsed.host + (parsed.pathname === '/' && !parsed.search && !parsed.hash ? '' : parsed.pathname + parsed.search + parsed.hash); return text.length > 60 ? text.slice(0, 59) + '…' : text } catch { return url.length > 60 ? url.slice(0, 59) + '…' : url }
}

export function previewActionLabel(action: PreviewAction): string {
  switch (action.kind) {
    case 'open': return `Открыл ${shortUrl(action.url)}`
    case 'click': return `Нажал ${action.text ?? action.selector ?? 'элемент'}`
    case 'type': return `Ввёл текст в ${action.selector ?? (action.field ? `поле «${action.field}»` : 'поле')}`
    case 'read': return `Прочитал ${action.selector ?? 'страницу'}`
    case 'accessibility': return `Inspected browser accessibility: ${action.selector}`
    case 'probe': return `Осмотрел элемент ${action.selector}`
    case 'audit': return 'Проверил страницу'
    case 'check': return `Проверил ${action.text ? `«${action.text}»` : action.selector ?? 'элемент'}`
    case 'fill': return `Заполнил форму (${action.fields.length} ${action.fields.length === 1 ? 'поле' : 'поля'})`
    case 'choose': return `Выбрал «${action.text}»`
    case 'status': return 'Проверил состояние панели'
    case 'find': return `Нашёл ${action.text ?? action.selector ?? (action.role ? `элементы с ролью ${action.role}` : 'элементы')}`
    case 'screenshot': return 'Сделал снимок страницы'
    case 'errors': return 'Проверил ошибки страницы'
    case 'scroll': return action.to === 'element' && action.selector ? `Показал ${action.selector}` : 'Прокрутил страницу'
    case 'press': return `Нажал клавишу ${action.key}${action.repeat && action.repeat > 1 ? ` ×${action.repeat}` : ''}`
    case 'back': return 'Перешёл назад'
    case 'forward': return 'Перешёл вперёд'
    default: return `Выполнил: ${action.kind}`
  }
}


/** Подпись действия в настоящем времени — для живого статуса «ассистент сейчас…». */
export function previewActionProgressLabel(action: PreviewAction): string {
  switch (action.kind) {
    case 'open': return `открывает ${action.url}`
    case 'click': return `нажимает ${action.text ?? action.selector ?? 'элемент'}`
    case 'type': return `вводит текст в ${action.selector ?? (action.field ? `поле «${action.field}»` : 'поле')}`
    case 'read': return `читает ${action.selector ?? 'страницу'}`
    case 'find': return `ищет ${action.text ?? action.selector ?? action.role ?? 'элементы'}`
    case 'screenshot': return 'делает снимок страницы'
    case 'scroll': return action.to === 'element' && action.selector ? `показывает ${action.selector}` : 'прокручивает страницу'
    case 'press': return `нажимает клавишу ${action.key}`
    case 'wait': return 'ждёт страницу'
    case 'errors': return 'проверяет ошибки страницы'
    case 'check': return `проверяет ${action.text ? `«${action.text}»` : action.selector ?? 'элемент'}`
    case 'fill': return 'заполняет форму'
    case 'choose': return `выбирает «${action.text}»`
    case 'status': return 'смотрит состояние панели'
    case 'back': return 'переходит назад'
    case 'forward': return 'переходит вперёд'
    default: return `выполняет ${action.kind}`
  }
}
