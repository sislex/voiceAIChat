import type { PreviewAction } from '@shared/previewActions'

/** Адрес в ленте — как в адресной строке: host и путь без схемы, не длиннее 60 символов. */
function shortUrl(url: string): string {
  try { const parsed = new URL(url); const text = parsed.host + (parsed.pathname === '/' && !parsed.search && !parsed.hash ? '' : parsed.pathname + parsed.search + parsed.hash); return text.length > 60 ? text.slice(0, 59) + '…' : text } catch { return url.length > 60 ? url.slice(0, 59) + '…' : url }
}

export function previewActionLabel(action: PreviewAction): string {
  switch (action.kind) {
    case 'open': return `Открыл ${shortUrl(action.url)}`
    case 'click': return action.peek ? `Посмотрел, куда ведёт ${action.text ?? action.selector ?? 'ссылка'}` : `Нажал ${action.text ?? action.selector ?? 'элемент'}`
    case 'type': return `Ввёл текст в ${action.selector ?? (action.field ? `поле «${action.field}»` : 'поле')}`
    case 'read': return action.table ? `Прочитал таблицу «${action.table}»` : action.toc ? 'Посмотрел оглавление' : action.next ? 'Читал дальше' : `Прочитал ${action.selector ?? 'страницу'}`
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
    case 'scroll': return action.until ? `Листал до «${action.until}»` : action.to === 'element' && action.selector ? `Показал ${action.selector}` : 'Прокрутил страницу'
    case 'press': return `Нажал клавишу ${action.key}${action.repeat && action.repeat > 1 ? ` ×${action.repeat}` : ''}`
    case 'back': return action.to ? `Вернулся на «${action.to}»` : 'Перешёл назад'
    case 'forward': return 'Перешёл вперёд'
    case 'dismiss': return action.what === 'cookies' ? 'Убрал баннер cookie' : action.what === 'dialog' ? 'Закрыл окно' : 'Убрал баннер или окно'
    case 'search': return `Искал на сайте «${action.text}»`
    case 'bookmark': return action.remove ? `Убрал закладку ${action.remove}` : `Запомнил страницу${action.label ? ` как «${action.label}»` : ''}`
    case 'question': return `Спросил: ${action.question}`
    case 'handover': return `Передал шаг вам: ${action.reason}`
    case 'focus': return `Поставил курсор в ${action.field ? `поле «${action.field}»` : action.selector ?? 'поле'}`
    case 'select': return `Выделил ${action.text ? `«${action.text}»` : action.selector ?? 'текст'}`
    case 'show': return `Показал ${action.text ?? action.selector ?? 'элемент'}`
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
    case 'dismiss': return action.what === 'cookies' ? 'убирает баннер cookie' : 'закрывает окно или баннер'
    case 'search': return `ищет на сайте «${action.text}»`
    case 'bookmark': return action.remove ? 'убирает закладку' : 'запоминает страницу'
    case 'question': return 'ждёт вашего ответа'
    case 'handover': return 'ждёт, пока вы сделаете свой шаг'
    case 'focus': return 'ставит курсор в поле'
    case 'select': return `выделяет ${action.text ? `«${action.text}»` : 'текст'}`
    case 'show': return `показывает ${action.text ?? action.selector ?? 'элемент'}`
    default: return `выполняет ${action.kind}`
  }
}
