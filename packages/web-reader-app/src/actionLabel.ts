import type { PreviewAction } from '@shared/previewActions'

export function previewActionLabel(action: PreviewAction): string {
  switch (action.kind) {
    case 'open': return `Открыл ${action.url}`
    case 'click': return `Нажал ${action.text ?? action.selector ?? 'элемент'}`
    case 'type': return `Ввёл текст в ${action.selector}`
    case 'read': return `Прочитал ${action.selector ?? 'страницу'}`
    case 'accessibility': return `Inspected browser accessibility: ${action.selector}`
    case 'probe': return `Осмотрел элемент ${action.selector}`
    case 'audit': return 'Проверил страницу'
    case 'find': return `Нашёл ${action.text ?? action.selector ?? 'элементы'}`
    case 'screenshot': return 'Сделал снимок страницы'
    case 'errors': return 'Проверил ошибки страницы'
    case 'back': return 'Перешёл назад'
    case 'forward': return 'Перешёл вперёд'
    default: return `Выполнил: ${action.kind}`
  }
}

