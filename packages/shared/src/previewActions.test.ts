import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserId } from './browserId'
import {
  PREVIEW_ACTION_COMMAND_TYPE,
  PREVIEW_ACTION_LIMITS,
  PREVIEW_ACTION_RESULT_TYPE,
  isHttpUrl,
  isPreviewAction,
  isPreviewActionCommand,
  isPreviewActionResultMessage,
  isPreviewDomAction,
  previewResultJson,
  resolvePreviewUrl,
  previewToolHint
} from './previewActions'

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
  else delete (globalThis as { crypto?: Crypto }).crypto
})

describe('browserId', () => {
  it('prefers native randomUUID', () => {
    const randomUUID = vi.fn(() => 'native-id')
    const getRandomValues = vi.fn()
    vi.stubGlobal('crypto', { randomUUID, getRandomValues })
    expect(browserId()).toBe('native-id')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('creates a UUID-compatible value with getRandomValues', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(7); return bytes })
    vi.stubGlobal('crypto', { getRandomValues })
    expect(browserId()).toBe('07070707-0707-4707-8707-070707070707')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('stays non-empty and unique without Web Crypto in the same millisecond', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const ids = [browserId(), browserId(), browserId()]
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids)).toHaveLength(ids.length)
  })
})

describe('isPreviewAction', () => {
  it('проверяет порции текста и фильтр поиска на границе конверта', () => {
    expect(isPreviewAction({ kind: 'read', offset: 0, limit: 100 })).toBe(true)
    expect(isPreviewAction({ kind: 'read', offset: 4000, limit: 20000 })).toBe(true)
    for (const offset of [-1, 0.5, Infinity, '0']) expect(isPreviewAction({ kind: 'read', offset })).toBe(false)
    for (const limit of [0, 99, 20001, NaN, '100']) expect(isPreviewAction({ kind: 'read', limit })).toBe(false)
    expect(isPreviewAction({ kind: 'find', selector: 'button', visibleOnly: true })).toBe(true)
    expect(isPreviewAction({ kind: 'find', selector: 'button', visibleOnly: 'true' })).toBe(false)
  })
  it('принимает все виды действий', () => {
    expect(isPreviewAction({ kind: 'open', url: 'https://example.com' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', text: 'Электроника' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', selector: 'nav a', limit: 5 })).toBe(true)
    expect(isPreviewAction({ kind: 'click', text: 'Электроника' })).toBe(true)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'ноутбук', submit: true })).toBe(true)
    expect(isPreviewAction({ kind: 'read' })).toBe(true)
    expect(isPreviewAction({ kind: 'read', selector: 'main' })).toBe(true)
  })

  it('отклоняет не-HTTP url и мусор', () => {
    expect(isPreviewAction({ kind: 'open', url: 'javascript:alert(1)' })).toBe(false)
    expect(isPreviewAction({ kind: 'open', url: 'file:///etc/passwd' })).toBe(false)
    expect(isPreviewAction({ kind: 'open', url: 'не url' })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll' })).toBe(false)
    expect(isPreviewAction(null)).toBe(false)
    expect(isPreviewAction('open')).toBe(false)
  })

  it('find и click требуют text или selector', () => {
    expect(isPreviewAction({ kind: 'find' })).toBe(false)
    expect(isPreviewAction({ kind: 'click' })).toBe(false)
  })

  it('режет строки сверх лимита', () => {
    const long = 'x'.repeat(PREVIEW_ACTION_LIMITS.selector + 1)
    expect(isPreviewAction({ kind: 'read', selector: long })).toBe(false)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'y'.repeat(PREVIEW_ACTION_LIMITS.text + 1) })).toBe(false)
  })

  it('isPreviewDomAction не пускает open в iframe', () => {
    expect(isPreviewDomAction({ kind: 'open', url: 'https://example.com' })).toBe(false)
    expect(isPreviewDomAction({ kind: 'read' })).toBe(true)
  })
})

describe('isHttpUrl', () => {
  it('только http/https', () => {
    expect(isHttpUrl('http://a.b')).toBe(true)
    expect(isHttpUrl('https://a.b/path?x=1')).toBe(true)
    expect(isHttpUrl('ftp://a.b')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('конверты команд и результатов', () => {
  it('команда: тип, requestId и DOM-действие', () => {
    expect(
      isPreviewActionCommand({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: 'r1', action: { kind: 'read' } })
    ).toBe(true)
    expect(
      isPreviewActionCommand({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: 'r1', action: { kind: 'open', url: 'https://a.b' } })
    ).toBe(false)
    expect(isPreviewActionCommand({ type: 'other', requestId: 'r1', action: { kind: 'read' } })).toBe(false)
  })

  it('результат: ok/ошибка и кап размера', () => {
    expect(
      isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: { url: 'https://a.b' } })
    ).toBe(true)
    expect(
      isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: false, error: 'элемент не найден' })
    ).toBe(true)
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: 'да' })).toBe(false)
    const fat = { page: { url: 'https://a.b', title: '' }, text: 'x'.repeat(PREVIEW_ACTION_LIMITS.resultJson) }
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: fat })).toBe(false)
  })
})

describe('previewResultJson', () => {
  it('возвращает JSON в пределах капа и null сверх него', () => {
    expect(previewResultJson({ url: 'https://a.b' })).toBe('{"url":"https://a.b"}')
    expect(
      previewResultJson({
        page: { url: 'https://a.b', title: '' },
        headings: [],
        links: [],
        buttons: [],
        inputs: [],
        text: 'x'.repeat(PREVIEW_ACTION_LIMITS.resultJson)
      })
    ).toBeNull()
  })
})

describe('isPreviewAction: как пользователь — field, role, append, element, repeat, state', () => {
  it('type принимает field вместо selector и append, но требует хотя бы одну цель', () => {
    expect(isPreviewAction({ kind: 'type', field: 'Электронная почта', text: 'a@b.c' })).toBe(true)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'ещё', append: true })).toBe(true)
    expect(isPreviewAction({ kind: 'type', text: 'без цели' })).toBe(false)
    expect(isPreviewAction({ kind: 'type', field: '   ', text: 'x' })).toBe(false)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'x', append: 'yes' })).toBe(false)
  })
  it('find принимает role самостоятельно и вместе с текстом', () => {
    expect(isPreviewAction({ kind: 'find', role: 'button' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'link', text: 'Далее' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'button!' })).toBe(false)
  })
  it('scroll to: element требует selector; press repeat ограничен 1..50', () => {
    expect(isPreviewAction({ kind: 'scroll', to: 'element', selector: '#pricing' })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll', to: 'element' })).toBe(false)
    expect(isPreviewAction({ kind: 'press', key: 'ArrowDown', repeat: 3 })).toBe(true)
    expect(isPreviewAction({ kind: 'press', key: 'ArrowDown', repeat: 0 })).toBe(false)
    expect(isPreviewAction({ kind: 'press', key: 'ArrowDown', repeat: 51 })).toBe(false)
    expect(isPreviewAction({ kind: 'press', key: 'ArrowDown', repeat: 1.5 })).toBe(false)
  })
  it('open принимает относительный путь, read — visible; resolvePreviewUrl разрешает от базы', () => {
    expect(isPreviewAction({ kind: 'open', url: '/about' })).toBe(true)
    expect(isPreviewAction({ kind: 'open', url: '#/machines' })).toBe(true)
    expect(isPreviewAction({ kind: 'open', url: '?page=2' })).toBe(true)
    expect(isPreviewAction({ kind: 'open', url: '//evil.test/' })).toBe(false)
    expect(isPreviewAction({ kind: 'open', url: 'about' })).toBe(false)
    expect(isPreviewAction({ kind: 'read', visible: true })).toBe(true)
    expect(isPreviewAction({ kind: 'read', visible: 'yes' })).toBe(false)
    expect(resolvePreviewUrl('/about?x=1', 'https://shop.example/catalog/page')).toBe('https://shop.example/about?x=1')
    expect(resolvePreviewUrl('#/machines', 'https://app.internal/')).toBe('https://app.internal/#/machines')
    expect(resolvePreviewUrl('/about', null)).toBeNull()
    expect(resolvePreviewUrl('https://other.test/', null)).toBe('https://other.test/')
  })
  it('around, markdown, level, blur, percent и secret поля проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'read', around: 'Цены', markdown: true })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'heading', level: 2 })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'heading', level: 9 })).toBe(false)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'a', blur: true })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll', percent: 50 })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll', percent: 150 })).toBe(false)
    expect(isPreviewAction({ kind: 'fill', fields: [{ field: 'Пароль', value: 'x', secret: true }] })).toBe(true)
  })
  it('confirm, secret и show all проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'click', text: 'Оплатить', confirm: true })).toBe(true)
    expect(isPreviewAction({ kind: 'click', text: 'Оплатить', confirm: 'yes' })).toBe(false)
    expect(isPreviewAction({ kind: 'type', selector: '#pin', text: '1234', secret: true })).toBe(true)
    expect(isPreviewAction({ kind: 'show', text: 'Удалить', all: true })).toBe(true)
  })
  it('report, find reveal и changes selector проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'report' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', text: 'Цены', reveal: true })).toBe(true)
    expect(isPreviewAction({ kind: 'changes', selector: '#cart' })).toBe(true)
  })
  it('enabled/checked у find и check, role у click, perKey у fill и continueOnError проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'find', role: 'checkbox', checked: true })).toBe(true)
    expect(isPreviewAction({ kind: 'check', text: 'Сохранить', enabled: true })).toBe(true)
    expect(isPreviewAction({ kind: 'click', role: 'button', text: 'Сохранить' })).toBe(true)
    expect(isPreviewAction({ kind: 'click', role: 'button' })).toBe(true)
    expect(isPreviewAction({ kind: 'fill', fields: [{ field: 'Телефон', value: '+7' }], perKey: true })).toBe(true)
    expect(isPreviewAction({ kind: 'sequence', steps: [{ kind: 'check', text: 'a' }], continueOnError: true })).toBe(true)
  })
  it('changes, waitFor у действий, wait changed и адрес без схемы проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'changes' })).toBe(true)
    expect(isPreviewAction({ kind: 'click', text: 'Далее', waitFor: 'Шаг 2' })).toBe(true)
    expect(isPreviewAction({ kind: 'press', key: 'Enter', waitFor: 'Готово' })).toBe(true)
    expect(isPreviewAction({ kind: 'wait', changed: true })).toBe(true)
    expect(isPreviewAction({ kind: 'open', url: 'example.com/path' })).toBe(true)
    expect(isPreviewAction({ kind: 'open', url: 'not a url' })).toBe(false)
    expect(resolvePreviewUrl('example.com/path?x=1', null)).toBe('https://example.com/path?x=1')
  })
  it('check url/title, find href, hover waitMs, errors kinds и tables в parts проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'check', url: 'https://shop.example/dashboard*' })).toBe(true)
    expect(isPreviewAction({ kind: 'check', title: 'Кабинет' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', href: '/pricing' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'кнопка' })).toBe(true)
    expect(isPreviewAction({ kind: 'hover', text: 'Меню', waitMs: 300 })).toBe(true)
    expect(isPreviewAction({ kind: 'hover', text: 'Меню', waitMs: 5000 })).toBe(false)
    expect(isPreviewAction({ kind: 'errors', kinds: ['network'] })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', kinds: ['weird'] })).toBe(false)
    expect(isPreviewAction({ kind: 'read', parts: ['tables'] })).toBe(true)
  })
  it('sequence, parts, contains, nextPage, click по точке, back steps и network since проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'sequence', steps: [{ kind: 'click', text: 'Войти' }, { kind: 'type', field: 'Логин', text: 'a' }] })).toBe(true)
    expect(isPreviewAction({ kind: 'sequence', steps: [] })).toBe(false)
    expect(isPreviewAction({ kind: 'sequence', steps: [{ kind: 'open', url: 'https://x.test/' }] })).toBe(false)
    expect(isPreviewAction({ kind: 'read', parts: ['headings', 'text'] })).toBe(true)
    expect(isPreviewAction({ kind: 'read', parts: ['cells'] })).toBe(false)
    expect(isPreviewAction({ kind: 'check', text: 'Итого', contains: '₽' })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll', to: 'nextPage' })).toBe(true)
    expect(isPreviewAction({ kind: 'click', x: 10, y: 20 })).toBe(true)
    expect(isPreviewAction({ kind: 'click', x: 10 })).toBe(false)
    expect(isPreviewAction({ kind: 'back', steps: 2 })).toBe(true)
    expect(isPreviewAction({ kind: 'back', steps: 0 })).toBe(false)
    expect(isPreviewAction({ kind: 'network', since: 100 })).toBe(true)
  })
  it('open waitFor проходит валидацию', () => {
    expect(isPreviewAction({ kind: 'open', url: 'https://shop.example/', waitFor: 'Каталог' })).toBe(true)
    expect(isPreviewAction({ kind: 'open', url: 'https://shop.example/', waitFor: 5 })).toBe(false)
  })
  it('show, screenshot marks, read brief и wait idle проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'show', text: 'Оплатить', label: 'Вот эта кнопка' })).toBe(true)
    expect(isPreviewAction({ kind: 'show' })).toBe(false)
    expect(isPreviewAction({ kind: 'screenshot', marks: true })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', marks: 'yes' })).toBe(false)
    expect(isPreviewAction({ kind: 'read', brief: true })).toBe(true)
    expect(isPreviewAction({ kind: 'wait', idle: true })).toBe(true)
  })
  it('check, nth, scroll по тексту и errors since проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'check', text: 'Войти', state: 'visible' })).toBe(true)
    expect(isPreviewAction({ kind: 'check', selector: '.row', count: 3 })).toBe(true)
    expect(isPreviewAction({ kind: 'check', state: 'visible' })).toBe(false)
    expect(isPreviewAction({ kind: 'check', text: 'x', state: 'gone' })).toBe(false)
    expect(isPreviewAction({ kind: 'click', text: 'Удалить', nth: 2 })).toBe(true)
    expect(isPreviewAction({ kind: 'click', text: 'Удалить', nth: 0 })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll', to: 'element', text: 'Цены' })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', since: 1200 })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', since: -1 })).toBe(false)
  })
  it('section, onScreen, perKey и url-ожидание панели проходят валидацию', () => {
    expect(isPreviewAction({ kind: 'read', section: 'Цены' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'button', onScreen: true })).toBe(true)
    expect(isPreviewAction({ kind: 'find', role: 'button', onScreen: 'yes' })).toBe(false)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'a', perKey: true })).toBe(true)
    expect(isPreviewAction({ kind: 'wait', url: 'https://shop.example/dashboard*' })).toBe(true)
  })
  it('fill требует непустой список полей с целью, choose — текст пункта', () => {
    expect(isPreviewAction({ kind: 'fill', fields: [{ field: 'Логин', value: 'admin' }, { selector: '#pw', value: 'x' }], submit: true })).toBe(true)
    expect(isPreviewAction({ kind: 'fill', fields: [] })).toBe(false)
    expect(isPreviewAction({ kind: 'fill', fields: [{ value: 'x' }] })).toBe(false)
    expect(isPreviewAction({ kind: 'choose', text: 'Русский', in: 'Язык' })).toBe(true)
    expect(isPreviewAction({ kind: 'choose', text: '   ' })).toBe(false)
  })
  it('near и exact уточняют цель, status не требует аргументов', () => {
    expect(isPreviewAction({ kind: 'click', text: 'Удалить', near: 'Заказ №5' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', text: 'Купить', exact: true })).toBe(true)
    expect(isPreviewAction({ kind: 'hover', text: 'Меню', exact: 'yes' })).toBe(false)
    expect(isPreviewAction({ kind: 'type', field: 'Кол-во', near: 'Товар 2', text: '3' })).toBe(true)
    expect(isPreviewAction({ kind: 'status' })).toBe(true)
  })
  it('wait со state не требует Chromium — панель ждёт исчезновение сама', () => {
    expect(isPreviewAction({ kind: 'wait', selector: '.spinner', state: 'hidden' })).toBe(true)
  })
})

describe('previewToolHint', () => {
  it('называет инструменты и ограничение активной страницей', () => {
    const hint = previewToolHint()
    for (const tool of ['open', 'read', 'find', 'click', 'type']) expect(hint).toContain(tool)
    expect(hint).toContain('mcp__browser__')
    expect(hint).toContain('активного чата')
  })

  it('панель описана как видимая пользователю и объясняет новые человеческие параметры', () => {
    const hint = previewToolHint()
    expect(hint).toContain('видит каждое твоё действие')
    for (const term of ['field', 'role', 'navigated', 'to: element', 'repeat', 'state: hidden', 'append', 'onScreen', 'title', 'visible: true', 'dialogs', 'относительный путь', 'клиент не подключён', 'near', 'exact: true', 'status', 'outline', 'forms', 'landmarks', 'fill', 'choose', 'options', 'revealed', 'Control+a', 'section', 'selection', 'onScreen: true', 'perKey', 'obscuredBy', 'check', 'nth', 'errors {since}', 'show', 'marks: true', 'brief: true', 'idle: true', 'status.manual', 'waitFor', 'suggestions', 'missing', 'кнопка, ссылка', 'status.viewport', 'sequence', 'parts', 'contains', 'nextPage', 'click {x, y}', 'status.pending', 'check {url', 'href', 'tables', 'waitMs', 'kinds', 'Ввод', 'changes', 'waitFor у click', 'read.scroll', 'lastAction', 'example.com', 'notices', 'progress', 'enabled, checked', 'continueOnError', 'report', 'reveal: true', 'waitedMs', 'needsConfirmation', 'confirm: true', 'secret: true', 'show {all: true}', 'cursor', 'frames', 'crossSite', 'around', 'markdown: true', 'level: 2', 'percent: 50', 'blur: true', 'status.outline']) expect(hint).toContain(term)
  })

  it('для изолированного Chromium не обещает панель и требует поднять dev-сервер самому', () => {
    const hint = previewToolHint('chromium')
    expect(hint).toContain('изолированный Chromium')
    expect(hint).not.toContain('Рядом с чатом у пользователя открыта панель')
    expect(hint).toContain('mcp__remote__bash')
    expect(hint).toContain('screenshot')
    // Словарь инструментов у поверхностей общий — расходиться им незачем.
    for (const tool of ['open', 'read', 'find', 'click', 'type']) expect(hint).toContain(tool)
  })
})

describe('isPreviewAction: hover, scroll, press', () => {
  it('hover требует text или selector', () => {
    expect(isPreviewAction({ kind: 'hover', text: 'Меню' })).toBe(true)
    expect(isPreviewAction({ kind: 'hover', selector: '.menu' })).toBe(true)
    expect(isPreviewAction({ kind: 'hover' })).toBe(false)
  })

  it('scroll требует to или dy и валидирует значения', () => {
    expect(isPreviewAction({ kind: 'scroll', to: 'bottom' })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll', dy: -300, selector: '.feed' })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll' })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll', to: 'middle' })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll', dy: Number.NaN })).toBe(false)
  })

  it('press требует непустой key разумной длины', () => {
    expect(isPreviewAction({ kind: 'press', key: 'Escape' })).toBe(true)
    expect(isPreviewAction({ kind: 'press', key: 'Enter', selector: '#q' })).toBe(true)
    expect(isPreviewAction({ kind: 'press', key: '' })).toBe(false)
    expect(isPreviewAction({ kind: 'press', key: 'x'.repeat(40) })).toBe(false)
  })
})

describe('isPreviewAction: screenshot и кап результата снимка', () => {
  it('screenshot допускает selector, явный rect или пустые аргументы', () => {
    expect(isPreviewAction({ kind: 'screenshot' })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', selector: '#hero' })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', rect: { x: 10, y: 20, width: 300, height: 200 } })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', rect: { x: 0, y: 0, width: 0, height: 10 } })).toBe(false)
    expect(isPreviewAction({ kind: 'screenshot', rect: { x: Number.NaN, y: 0, width: 10, height: 10 } })).toBe(false)
  })

  it('результат со снимком проходит расширенный кап, обычный — нет', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(120_000)
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: { page: { url: '', title: '' }, rect: { x: 0, y: 0, width: 1, height: 1 }, dataUrl: big } })).toBe(true)
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: { text: 'A'.repeat(120_000) } })).toBe(false)
  })
})

describe('isPreviewAction: errors, wait, back, edits', () => {
  it('валидирует новые действия и их границы', () => {
    expect(isPreviewAction({ kind: 'errors' })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', clear: true })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', clear: 'yes' })).toBe(false)
    expect(isPreviewAction({ kind: 'wait', selector: '#x' })).toBe(true)
    expect(isPreviewAction({ kind: 'wait', text: 'Готово', timeoutMs: 3000 })).toBe(true)
    expect(isPreviewAction({ kind: 'wait' })).toBe(false)
    expect(isPreviewAction({ kind: 'wait', selector: '#x', timeoutMs: 60_000 })).toBe(false)
    expect(isPreviewAction({ kind: 'back' })).toBe(true)
    expect(isPreviewAction({ kind: 'edits' })).toBe(true)
  })
})

describe('isPreviewAction: network, console, evaluate', () => {
  it('журналы принимают фильтры и ограничивают limit', () => {
    expect(isPreviewAction({ kind: 'network' })).toBe(true)
    expect(isPreviewAction({ kind: 'network', filter: '/api/', clear: true, limit: 20 })).toBe(true)
    expect(isPreviewAction({ kind: 'network', limit: PREVIEW_ACTION_LIMITS.logMax + 1 })).toBe(false)
    expect(isPreviewAction({ kind: 'console', pattern: '[App]', level: 'warn' })).toBe(true)
    expect(isPreviewAction({ kind: 'console', level: 'debug' })).toBe(false)
  })

  it('evaluate требует код в пределах капа', () => {
    expect(isPreviewAction({ kind: 'evaluate', code: '2 + 2' })).toBe(true)
    expect(isPreviewAction({ kind: 'evaluate' })).toBe(false)
    expect(isPreviewAction({ kind: 'evaluate', code: 'x'.repeat(PREVIEW_ACTION_LIMITS.evaluateCode + 1) })).toBe(false)
  })
})

describe('isPreviewAction: drag, set, upload, viewport, a11y, forward', () => {
  it('drag требует selector или координаты у обеих точек', () => {
    expect(isPreviewAction({ kind: 'drag', from: { selector: '#card' }, to: { x: 10, y: 20 } })).toBe(true)
    expect(isPreviewAction({ kind: 'drag', from: {}, to: { selector: '#col' } })).toBe(false)
    expect(isPreviewAction({ kind: 'drag', from: { x: 1 }, to: { selector: '#col' } })).toBe(false)
  })

  it('set требует value или checked', () => {
    expect(isPreviewAction({ kind: 'set', selector: 'select', value: 'ru' })).toBe(true)
    expect(isPreviewAction({ kind: 'set', selector: '#agree', checked: true })).toBe(true)
    expect(isPreviewAction({ kind: 'set', selector: 'select' })).toBe(false)
  })

  it('upload валидирует имя и кап base64', () => {
    expect(isPreviewAction({ kind: 'upload', selector: 'input[type=file]', name: 'a.txt', base64: 'aGk=' })).toBe(true)
    expect(isPreviewAction({ kind: 'upload', selector: 'input', name: '', base64: 'aGk=' })).toBe(false)
    expect(isPreviewAction({ kind: 'upload', selector: 'input', name: 'a.bin', base64: 'x'.repeat(PREVIEW_ACTION_LIMITS.uploadBase64 + 1) })).toBe(false)
  })

  it('viewport — конечная неотрицательная ширина', () => {
    expect(isPreviewAction({ kind: 'viewport', width: 375 })).toBe(true)
    expect(isPreviewAction({ kind: 'viewport', width: 0 })).toBe(true)
    expect(isPreviewAction({ kind: 'viewport', width: -1 })).toBe(false)
    expect(isPreviewAction({ kind: 'viewport' })).toBe(false)
  })

  it('a11y и forward валидны без аргументов', () => {
    expect(isPreviewAction({ kind: 'a11y' })).toBe(true)
    expect(isPreviewAction({ kind: 'a11y', selector: 'main', limit: 50 })).toBe(true)
    expect(isPreviewAction({ kind: 'forward' })).toBe(true)
  })

  it('click с расширениями: кнопка, двойной, модификаторы', () => {
    expect(isPreviewAction({ kind: 'click', selector: '#a', button: 'right' })).toBe(true)
    expect(isPreviewAction({ kind: 'click', selector: '#a', dblclick: true, modifiers: ['shift', 'meta'] })).toBe(true)
    expect(isPreviewAction({ kind: 'click', selector: '#a', button: 'middle' })).toBe(false)
    expect(isPreviewAction({ kind: 'click', selector: '#a', modifiers: ['hyper'] })).toBe(false)
  })
})
