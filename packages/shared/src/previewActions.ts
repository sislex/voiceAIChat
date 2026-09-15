import { isPreviewAccessibilityOptions, type PreviewAccessibilityOptions, type PreviewAccessibilityResult } from './previewAccessibility'
import { BROWSER_EVALUATE_CODE_LIMIT, normalizeBrowserEvaluateOptions, type BrowserEvaluateOptions } from './browserEvaluation'
import { isPreviewAuditOptions, type PreviewAuditOptions, type PreviewAuditResult } from './previewAudit'
import { isPreviewProbeOptions, type PreviewProbeOptions, type PreviewProbeResult } from './previewProbe'
import { normalizeBrowserDiagnosticOptions, type BrowserConsoleOptions, type BrowserNetworkOptions } from './browserDiagnostics'
// Управление открытым сайтом в панели превью и чтение его DOM из хода модели.
//
// Три берега одного протокола:
//  - сервер (mcp/previewMcp.ts) транслирует вызов инструмента модели клиенту
//    кадром ServerMessage `preview.action` и ждёт `preview.result`;
//  - UI (PreviewPane) выполняет `open` сам, а DOM-действия пересылает в iframe
//    превью postMessage-командой и возвращает ответ странице;
//  - автономный скрипт превью (previewProxy.ts) исполняет DOM-действие и
//    отвечает result-сообщением родителю.
// Здесь — типы действий, лимиты и runtime-валидаторы конвертов. Чистые функции:
// без DOM и сети, чтобы обе стороны (сервер и UI) проверяли одно и то же.

import { isBrowserFramePath, type BrowserFrameTarget } from './browserFrames'
import type { BrowserActionOutcome } from './playwrightReader'
import { BROWSER_UPLOAD_LIMIT_BYTES } from './browserLimits'
import { isBrowserWaitOptions, type BrowserWaitOptions } from './browserWaiting'

export const PREVIEW_ACTION_COMMAND_TYPE = 'voicechat.preview.action.v1' as const
export const PREVIEW_ACTION_RESULT_TYPE = 'voicechat.preview.action-result.v1' as const
/** Внутренний iframe сообщает recorder-оболочке, что инъецированный мост DOM готов. */
export const PREVIEW_PAGE_READY_TYPE = 'voicechat.preview.page-ready.v1' as const
export const PREVIEW_PAGE_LOADING_TYPE = 'voicechat.preview.page-loading.v1' as const

/** Лимиты полезной нагрузки: страница не должна вливать в ход мегабайты DOM. */
export const PREVIEW_ACTION_LIMITS = {
  selector: 2_000,
  url: 4_096,
  /** Текст для ввода/поиска. */
  text: 2_000,
  /** Текст одного элемента в списках (find/read). */
  elementText: 200,
  findDefault: 10,
  findMax: 30,
  headings: 64,
  links: 100,
  buttons: 50,
  inputs: 50,
  /** Текстовая выжимка страницы в `read`. */
  snippet: 4_000,
  /** Кап сериализованного результата, который сервер вернёт модели. */
  resultJson: 32_000,
  /** Отдельный кап результата со снимком (dataUrl не влезает в resultJson). */
  screenshotJson: 2_000_000,
  /** Код evaluate и сериализованное значение его результата. */
  evaluateCode: BROWSER_EVALUATE_CODE_LIMIT,
  evaluateValue: 8_000,
  /** Файл upload: до 8 МиБ бинарных данных с учётом увеличения в base64. */
  uploadBase64: Math.ceil(BROWSER_UPLOAD_LIMIT_BYTES / 3) * 4,
  /** Журналы network/console: сколько записей отдаётся за раз. */
  logDefault: 50,
  logMax: 100,
  /** Узлы дерева доступности в a11y. */
  a11yNodes: 200
} as const

/** Модификаторы клика (клавиши, зажатые на время события). */
export const PREVIEW_CLICK_MODIFIERS = ['shift', 'ctrl', 'alt', 'meta'] as const
export type PreviewClickModifier = (typeof PREVIEW_CLICK_MODIFIERS)[number]

export type PreviewReadPart = 'headings' | 'links' | 'buttons' | 'inputs' | 'forms' | 'landmarks' | 'tables' | 'images' | 'text'
export const PREVIEW_READ_PARTS: readonly PreviewReadPart[] = ['headings', 'links', 'buttons', 'inputs', 'forms', 'landmarks', 'tables', 'images', 'text']

/** Стороны, которыми человек описывает место: «кнопка под ценой», «поле справа от подписи». */
export const PREVIEW_SPATIAL_SIDES = ['below', 'above', 'leftOf', 'rightOf'] as const
export type PreviewSpatialSide = (typeof PREVIEW_SPATIAL_SIDES)[number]
/** Пространственные уточнения цели: текст-ориентир с нужной стороны. */
export type PreviewSpatialHints = Partial<Record<PreviewSpatialSide, string>>
/** Шаг последовательности — любое действие панели, кроме open и вложенных последовательностей. */
export type PreviewSequenceStep = Exclude<PreviewAction, { kind: 'open' } | { kind: 'sequence' }>

/** Появившиеся и исчезнувшие видимые тексты между двумя моментами. */
export interface PreviewChanges {
  added: string[]
  removed: string[]
  addedTotal: number
  removedTotal: number
}

export interface PreviewChangesResult {
  page: PreviewPageInfo
  changes: PreviewChanges
  /** Снимка ещё не было: сравнивать нечего, текущее состояние запомнено. */
  baseline?: boolean
}

export interface PreviewReportResult {
  page: PreviewPageInfo | null
  history: string[]
  checks: { summary: string; pass: boolean; at: number; url: string | null }[]
  passed: number
  failed: number
  actions: number
  lastAction?: { kind: string; ok: boolean; at: number; error?: string }
  /** Закладки сеанса — что человек и модель отметили как важное. */
  bookmarks?: PreviewBookmarkEntry[]
  /** Вопросы человеку и его ответы за сеанс — часть отчёта о работе. */
  questions?: { question: string; answer?: string; answered: boolean; at: number }[]
}

export interface PreviewSequenceResult {
  page: PreviewPageInfo | null
  /** Итог каждого выполненного шага в порядке следования; после первой ошибки шаги не выполняются. */
  steps: { kind: string; ok: boolean; error?: string; summary?: string }[]
  completed: number
  total: number
}

/** Одно поле для `fill`: адресуется селектором либо подписью (как `type`). */
export interface PreviewFillField {
  selector?: string
  field?: string
  near?: string
  value: string
  /** Значение не возвращать и не записывать (пароли, коды). */
  secret?: boolean
}

export const PREVIEW_HOTKEY_MODIFIERS = ['shift', 'ctrl', 'alt', 'meta', 'primary'] as const
export type PreviewHotkeyModifier = (typeof PREVIEW_HOTKEY_MODIFIERS)[number]

export type PreviewExpectation =
  | { is: 'text'; selector?: string; value: string; absent?: boolean }
  | { is: 'visible'; selector: string; absent?: boolean }
  | { is: 'count'; selector: string; value: number }
  | { is: 'value'; selector: string; value: string }
  | { is: 'url'; value: string }

export interface PreviewFormField {
  selector: string
  value?: string
  values?: string[]
  checked?: boolean
}

export interface PreviewUploadFile {
  name: string
  mimeType?: string
  base64: string
}

/** Точка или элемент — источник/цель перетаскивания. */
export interface PreviewDragPoint {
  selector?: string
  x?: number
  y?: number
}

/** Действие браузера, запрошенное моделью. `open` выполняет сам UI (без iframe). */
export type PreviewAction = BrowserFrameTarget & (
  | ({ kind: 'audit'; diagnostic?: boolean } & PreviewAuditOptions)
  | ({ kind: 'probe'; diagnostic?: boolean } & PreviewProbeOptions)
  | ({ kind: 'accessibility'; diagnostic?: boolean } & PreviewAccessibilityOptions)
  /** url — абсолютный http(s) либо относительный путь (`/about`, `?page=2`, `#/route`): панель разрешает его от открытой страницы. */
  /** waitFor — текст, которого дождаться после загрузки: open и wait одним действием. */
  | { kind: 'open'; url: string; waitFor?: string; diagnostic?: boolean }
  /** role сужает совпадения по роли элемента (button, link, textbox…): так ищет пользователь, а не CSS. */
  /** onScreen — только то, что пользователь видит сейчас без прокрутки. */
  /** nth — взять N-е совпадение (с 1), когда одинаковых элементов несколько и near не помогает. */
  /** href — подстрока адреса ссылки («ссылка на /pricing»). */
  /** enabled/checked — состояние контрола, как его видит человек: «активная кнопка», «отмеченный флажок». */
  /** reveal — прокрутить к первому найденному и подсветить: «найди и покажи». */
  /** level — уровень заголовка для role: heading. */
  /** below/above/leftOf/rightOf — ориентир по сторонам: «кнопка под ценой»; ближайшее с той стороны идёт первым. */
  /** details — подробности элемента (атрибуты, размеры, путь по странице), когда описания мало. */
  /** in — искать только в разделе под этим заголовком, как человек смотрит в нужной главе. */
  | ({ kind: 'find'; text?: string; selector?: string; role?: string; level?: number; near?: string; in?: string; exact?: boolean; nth?: number; href?: string; enabled?: boolean; checked?: boolean; reveal?: boolean; details?: boolean; limit?: number; visibleOnly?: boolean; onScreen?: boolean; diagnostic?: boolean } & PreviewSpatialHints)
  /** Клик: обычный, двойной (dblclick), правый (button: right) и с модификаторами. */
  /** near — текст рядом с целью («Удалить» возле «Заказ №5»), exact — точное совпадение текста. */
  /** x/y — клик по точке вьюпорта (карты, canvas), когда у цели нет текста и селектора. */
  /** waitFor — текст, которого дождаться после действия (click/type/press/choose/fill), одним ходом. */
  /** confirm — пользователь явно разрешил опасное действие (оплата, удаление, скачивание). */
  /** peek — не нажимать, а посмотреть, куда ведёт ссылка (href, другой сайт, новая вкладка), как человек читает адрес в строке состояния. */
  | ({ kind: 'click'; selector?: string; text?: string; role?: string; near?: string; exact?: boolean; nth?: number; x?: number; y?: number; button?: 'left' | 'right'; dblclick?: boolean; modifiers?: PreviewClickModifier[]; waitFor?: string; confirm?: boolean; peek?: boolean; diagnostic?: boolean } & PreviewSpatialHints)
  /** field — подпись, placeholder или name поля вместо CSS-селектора; append дописывает к текущему значению. */
  /** perKey — посимвольный ввод с событиями клавиатуры: для полей, слушающих keydown (маски, автодополнение). */
  /** secret — значение не возвращать и не записывать в сценарий, даже если поле не помечено как пароль. */
  /** blur — убрать фокус после ввода: формы часто проверяют поле именно по blur. */
  | { kind: 'type'; selector?: string; field?: string; near?: string; text: string; submit?: boolean; append?: boolean; perKey?: boolean; waitFor?: string; secret?: boolean; blur?: boolean; delay?: number; diagnostic?: boolean }
  /** visible — только то, что сейчас в видимой области окна: экран пользователя, а не весь документ. */
  /** section — прочитать раздел под заголовком с этим текстом, как человек листает до нужного места. */
  /** brief — короткое человеческое описание страницы вместо полной структуры. */
  /** parts — какие части отдать (headings, links, buttons, inputs, forms, landmarks, text): меньше ответ — меньше контекста. */
  /** around — текст вокруг фразы (±600 символов); markdown — текст с заголовками и списками в лёгкой разметке. */
  /** main — только основное содержимое страницы (article/main/самый текстовый блок), без меню, шапки и подвала. */
  /** next — продолжить чтение с того места, где остановился прошлый read этой страницы: человек не считает символы. */
  /** toc — оглавление страницы: заголовки с уровнями и селекторами, чтобы прыгнуть в нужный раздел. */
  /** table — прочитать одну таблицу по подписи или селектору; rowOffset листает её строки. */
  | { kind: 'read'; selector?: string; section?: string; around?: string; markdown?: boolean; main?: boolean; next?: boolean; toc?: boolean; table?: string; rowOffset?: number; limit?: number; offset?: number; visible?: boolean; brief?: boolean; parts?: PreviewReadPart[]; diagnostic?: boolean }
  | { kind: 'styles'; selector: string; properties?: string[]; diagnostic?: boolean }
  /** Наведение курсора: pointer/mouse-события по элементу (выпадающие меню). */
  /** waitMs — подождать после наведения, пока меню анимируется, и только потом собрать revealed. */
  | { kind: 'hover'; selector?: string; text?: string; role?: string; near?: string; exact?: boolean; nth?: number; waitMs?: number; diagnostic?: boolean }
  /** Прокрутка окна или контейнера: к краю (`to`) либо на `dy` пикселей. */
  /** to: 'element' прокручивает страницу так, чтобы selector оказался в видимой области. */
  /** to: nextPage/prevPage — на экран вниз/вверх, как PageDown/PageUp. */
  /** percent — к доле высоты документа (0–100). */
  /** until — листать ленту, пока не покажется текст (ленивая подгрузка), не больше maxScreens экранов. */
  | { kind: 'scroll'; selector?: string; text?: string; to?: 'top' | 'bottom' | 'element' | 'nextPage' | 'prevPage'; percent?: number; dx?: number; dy?: number; until?: string; maxScreens?: number; diagnostic?: boolean }
  /** Нажатие клавиши (Escape, Enter, Tab, ArrowDown, …) на элементе или активном поле. */
  /** repeat повторяет нажатие (ArrowDown ×3) одним действием. */
  | { kind: 'press'; key: string; selector?: string; repeat?: number; waitFor?: string; diagnostic?: boolean }
  /** Снимок области: элемент по селектору, явный rect (координаты документа) или видимая область. */
  /** marks — пронумеровать на снимке кликабельные элементы и вернуть их список: модель кликает «по номеру», как человек указывает пальцем. */
  | { kind: 'screenshot'; selector?: string; rect?: { x: number; y: number; width: number; height: number }; marks?: boolean; diagnostic?: boolean }
  /** Ошибки открытой страницы: JS-исключения, unhandledrejection, console.error, неуспешные fetch/XHR. */
  /** since — только ошибки после этой отметки времени страницы (`at` из прошлого ответа). */
  | { kind: 'errors'; clear?: boolean; since?: number; kinds?: PreviewPageError['kind'][]; diagnostic?: boolean }
  /** Дождаться появления элемента (selector или видимый text) с таймаутом. */
  | ({ kind: 'wait'; diagnostic?: boolean } & BrowserWaitOptions)
  /** Назад по истории внутренней страницы (переход подтверждается page-ready). */
  /** to — вернуться к странице этого сеанса по части адреса или заголовка («вернись на страницу поиска»); исполняет мост панели. */
  | { kind: 'back'; steps?: number; to?: string; diagnostic?: boolean }
  /** Вперёд по истории внутренней страницы (симметрично back). */
  | { kind: 'forward'; steps?: number; diagnostic?: boolean }
  /** Сохранённые правки edit-режима текущей страницы (перенести «как поправил» в код). */
  | { kind: 'edits'; diagnostic?: boolean }
  /** Журнал сетевых запросов страницы (fetch/XHR/beacon): фильтр по подстроке URL. */
  | ({ kind: 'network'; since?: number; diagnostic?: boolean } & BrowserNetworkOptions)
  /** Журнал console.log/info/warn/error страницы: фильтр по подстроке и уровню. */
  | ({ kind: 'console'; diagnostic?: boolean } & Omit<BrowserConsoleOptions, 'regex'>)
  /** Выполнить JS в контексте страницы; результат сериализуется JSON (кап evaluateValue). */
  | ({ kind: 'evaluate'; diagnostic?: boolean } & BrowserEvaluateOptions)
  /** Перетаскивание pointer-событиями (или HTML5 DnD у draggable) от from к to. */
  | { kind: 'drag'; from: PreviewDragPoint; to: PreviewDragPoint; diagnostic?: boolean }
  /** Установить значение сложного контрола: select (по value или подписи option), checkbox/radio (checked), date/range (value). */
  | { kind: 'set'; selector: string; value?: string; values?: string[]; checked?: boolean; diagnostic?: boolean }
  /** Загрузить файл в input type=file: содержимое приходит base64 от модели. */
  | { kind: 'upload'; selector: string; name: string; mimeType?: string; base64: string; files?: PreviewUploadFile[]; diagnostic?: boolean }
  /** Ширина вьюпорта превью в пикселях (исполняет Reader, не страница); 0 — адаптив. */
  | { kind: 'viewport'; width: number; diagnostic?: boolean }
  /**
   * Keyboard shortcut with modifiers held, the way a person presses it
   * (Control+A, Meta+C, Shift+Tab). Separate from `press` because the model
   * kept spelling shortcuts as three keyDown/keyUp calls and lost a modifier
   * in the middle, leaving the page typing in uppercase forever.
   */
  | { kind: 'hotkey'; key: string; modifiers: PreviewHotkeyModifier[]; repeat?: number; selector?: string; diagnostic?: boolean }
  /** Empty an input the way Ctrl+A Delete does, firing input/change. */
  | { kind: 'clear'; selector: string; diagnostic?: boolean }
  /** Select the text of an element (or the whole page) as a drag would. */
  | { kind: 'selectText'; selector?: string; diagnostic?: boolean }
  /** Read the current selection — what Ctrl+C would copy. */
  | { kind: 'copy'; diagnostic?: boolean }
  /** Paste text into the focused field (or `selector`), firing a paste event. */
  | { kind: 'paste'; selector?: string; text: string; diagnostic?: boolean }
  /** Tab order of the page: the path a keyboard-only person walks, in order. */
  | { kind: 'focusOrder'; selector?: string; limit?: number; diagnostic?: boolean }
  /** Прокручивать ленту, пока не появится цель или не кончится содержимое. */
  | { kind: 'scrollUntil'; selector?: string; text?: string; container?: string; maxScrolls?: number; step?: number; diagnostic?: boolean }
  /** Сколько узлов подходит под условие — проверка без чтения их текста. */
  | { kind: 'count'; selector?: string; text?: string; visibleOnly?: boolean; diagnostic?: boolean }
  /** Таблица строками под заголовками, с порциями. */
  | { kind: 'table'; selector: string; offset?: number; limit?: number; columns?: string[]; diagnostic?: boolean }
  /** Повторяющиеся блоки (карточки, лента) записями со своими действиями. */
  | { kind: 'list'; selector: string; offset?: number; limit?: number; diagnostic?: boolean }
  /** Куда прокручена страница и сколько её осталось ниже. */
  | { kind: 'metrics'; diagnostic?: boolean }
  /** Геометрия элемента: виден ли, перекрыт ли, сколько прокрутки до него. */
  | { kind: 'measure'; selector: string; diagnostic?: boolean }
  /** Обвести элемент в кадре, чтобы человек увидел, о чём речь. */
  | { kind: 'highlight'; selector: string; ms?: number; diagnostic?: boolean }
  /** Видео и аудио страницы: состояние и управление, как у человека. */
  | { kind: 'media'; selector?: string; do?: 'play' | 'pause' | 'mute' | 'unmute'; seconds?: number; diagnostic?: boolean }
  /** Хранилище сайта: что страница держит между перезагрузками. */
  | { kind: 'storage'; area?: 'local' | 'session' | 'both'; do?: 'read' | 'set' | 'remove' | 'clear'; key?: string; value?: string; limit?: number; diagnostic?: boolean }
  /** Исходник страницы порциями — та самая разметка, что смотрит человек. */
  | { kind: 'source'; selector?: string; offset?: number; limit?: number; diagnostic?: boolean }
  /** Таблица как CSV: форма, которую человек вставляет в таблицу. */
  | { kind: 'csv'; selector: string; offset?: number; limit?: number; diagnostic?: boolean }
  /** Несколько проверок разом с общим вердиктом — как человек описывает экран. */
  | { kind: 'expect'; checks: PreviewExpectation[]; diagnostic?: boolean }
  /** Что происходило в сессии: обе стороны, в порядке событий. */
  | { kind: 'history'; actor?: 'user' | 'assistant'; limit?: number; clear?: boolean; diagnostic?: boolean }
  /** Строка от модели в панель человека: чем она сейчас занята. */
  | { kind: 'note'; text: string; diagnostic?: boolean }
  /** Среда браузера: тема системы, уменьшенная анимация, контраст, сеть, место. */
  | { kind: 'environment'; colorScheme?: 'light' | 'dark' | 'no-preference'; reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none'; offline?: boolean; geolocation?: { latitude: number; longitude: number; accuracy?: number } | null; permissions?: string[]; diagnostic?: boolean }
  /** Заполнить форму целиком: человек заполняет её одним действием, а не полем за вызов. */
  | { kind: 'fillForm'; selector?: string; fields: PreviewFormField[]; delay?: number; diagnostic?: boolean }
  /** Что сейчас в форме: поля, значения, обязательность — проверка результата заполнения. */
  | { kind: 'formState'; selector?: string; limit?: number; diagnostic?: boolean }
  /** Валидация браузера: какие поля не дают отправить форму и почему. */
  | { kind: 'validity'; selector?: string; diagnostic?: boolean }
  /** Отправить форму так же, как Enter: с валидацией и обработчиком submit. */
  | { kind: 'submit'; selector?: string; diagnostic?: boolean }
  /** Варианты контрола: select, datalist, группа radio. */
  | { kind: 'options'; selector: string; limit?: number; diagnostic?: boolean }
  /** Перетащить файлы в зону загрузки — путь без input[type=file]. */
  | { kind: 'dropFile'; selector: string; files: PreviewUploadFile[]; diagnostic?: boolean }
  /** Где сейчас фокус: чтение, которое ничего не двигает. */
  | { kind: 'focusState'; diagnostic?: boolean }
  /** Дерево доступности страницы: роли и имена как их видит скринридер. */
  | { kind: 'a11y'; selector?: string; limit?: number; diagnostic?: boolean }
  /** Состояние панели без обращения к странице: подключена ли, что открыто, загружена ли страница. */
  | { kind: 'status'; diagnostic?: boolean }
  /** Заполнить несколько полей формы разом, как человек, и при submit отправить её. */
  | { kind: 'fill'; fields: PreviewFillField[]; submit?: boolean; perKey?: boolean; waitFor?: string; confirm?: boolean; diagnostic?: boolean }
  /** Выбрать пункт из выпадающего меню или списка: открыть триггер (in), дождаться пункта и нажать его. */
  | { kind: 'choose'; text: string; in?: string; near?: string; waitFor?: string; confirm?: boolean; diagnostic?: boolean }
  /** Что изменилось на странице с прошлого снимка (read/changes/действие): появившиеся и исчезнувшие тексты. */
  | { kind: 'changes'; selector?: string; diagnostic?: boolean }
  /** Отчёт о сеансе панели: где были, что проверили, что упало — для отчёта по задаче. */
  | { kind: 'report'; diagnostic?: boolean }
  /** Запомнить открытую страницу в панели, как человек кладёт закладку: список видит и пользователь, и модель. */
  | { kind: 'bookmark'; label?: string; remove?: string; diagnostic?: boolean }
  /** Спросить человека прямо в панели и дождаться ответа: «какой размер брать?», «этот пункт?». options — быстрые ответы кнопками. */
  | { kind: 'question'; question: string; options?: string[]; timeoutMs?: number; diagnostic?: boolean }
  /** Передать шаг человеку («войди сам, я подожду») и ждать, пока он вернёт управление. */
  | { kind: 'handover'; reason: string; timeoutMs?: number; diagnostic?: boolean }
  /** Показать пользователю элемент: прокрутить к нему и подсветить с подписью на несколько секунд. */
  /** all — подсветить все совпадения (до 10), не только первое. */
  | { kind: 'show'; selector?: string; text?: string; near?: string; label?: string; all?: boolean; diagnostic?: boolean }
  /** Убрать то, что мешает читать: баннер cookie (предпочтительно «отклонить»/«только необходимые») или всплывающее окно — как человек закрывает их первым делом. */
  | { kind: 'dismiss'; what?: 'cookies' | 'dialog' | 'any'; diagnostic?: boolean }
  /** Поиск по самому сайту: найти его поле поиска, ввести запрос и отправить — первое, что делает человек на большом сайте. */
  | { kind: 'search'; text: string; in?: string; waitFor?: string; diagnostic?: boolean }
  /** Поставить курсор в поле, ничего не вводя: так человек готовится печатать и проверяет, куда попадёт ввод. */
  | { kind: 'focus'; selector?: string; field?: string; near?: string; diagnostic?: boolean }
  /** Выделить текст на странице — пользователь видит выделение и понимает, о каком месте речь. */
  | { kind: 'select'; text?: string; selector?: string; near?: string; diagnostic?: boolean }
  /** Проверка ожидания как у тестировщика: pass/fail с фактическим значением, без исключений. */
  /** url/title — проверка адреса и заголовка страницы (мост панели), без text/selector. */
  | { kind: 'check'; text?: string; selector?: string; near?: string; state?: 'visible' | 'hidden' | 'present' | 'absent'; value?: string; contains?: string; count?: number; enabled?: boolean; checked?: boolean; url?: string; title?: string; diagnostic?: boolean }
  /** Несколько шагов одним действием: рутина человека «нажать → ввести → нажать» без лишних ходов; стоп на первой ошибке. */
  /** continueOnError — пройти все шаги и собрать итоги (чек-лист проверок), а не остановиться на первом сбое. */
  | { kind: 'sequence'; steps: PreviewSequenceStep[]; continueOnError?: boolean; diagnostic?: boolean }
)

/** DOM-действия, которые уходят в iframe (все, кроме `open`). */
export type PreviewDomAction = Exclude<PreviewAction, { kind: 'open' }>

/** Короткое описание элемента страницы в ответах find/click/type. */
export interface PreviewActionElement {
  selector: string
  tag: string
  text: string
  /** Ссылка (для <a>) — как в DOM страницы, без переписывания на прокси. */
  href?: string
  /** ARIA-роль или тип поля ввода — чем элемент является для пользователя. */
  role?: string
  disabled?: boolean
  readOnly?: boolean
  checked?: boolean | 'mixed'
  expanded?: boolean
  selected?: boolean
  required?: boolean
  invalid?: boolean
  /** Элемент сейчас в видимой области окна — то, что пользователь видит без прокрутки. */
  onScreen?: boolean
  /** Подсказка и текущее значение поля ввода (значение скрыто у секретных полей). */
  placeholder?: string
  value?: string
  /** Где элемент стоит на странице: текст ближайшей строки/секции/формы — так человек различает одинаковые кнопки. */
  context?: string
  /** Подробности по запросу find {details: true}: атрибуты, размеры и путь по ориентирам страницы. */
  details?: PreviewElementDetails
}

export interface PreviewElementDetails {
  id?: string
  classes: string[]
  /** Значимые атрибуты (type, name, href, aria-*, data-*), обрезанные по длине. */
  attributes: Record<string, string>
  /** Положение и размер в координатах вьюпорта (CSS px). */
  box: { x: number; y: number; width: number; height: number }
  /** Путь по ориентирам: «main › form «Вход» › строка 3» — где элемент лежит для человека. */
  path: string
}

/** Короткая сводка страницы после загрузки: модель ориентируется без отдельного read. */
export interface PreviewPageOutline {
  headings: string[]
  links: number
  buttons: number
  inputs: number
  /** Слов видимого текста — оценка времени чтения. */
  words?: number
}

/** Состояние панели пользователя (`status`): что открыто и готова ли страница. */
export interface PreviewStatusResult {
  connected: boolean
  pageStatus: 'empty' | 'loading' | 'ready' | 'error'
  page: PreviewPageInfo | null
  error?: string
  /** Последние адреса этой панели, новые первыми — куда «ходили» в этом разговоре. */
  history?: string[]
  /** Пользователь взял управление («Только я управляю»): действия будут отклонены. */
  manual?: boolean
  /** Сколько действий модели ещё выполняется в панели. */
  pending?: number
  /** Последнее завершённое действие модели и его итог — чтобы продолжить после паузы. */
  lastAction?: { kind: string; ok: boolean; at: number; error?: string }
  /** Итоги проверок за сеанс. */
  checks?: { passed: number; failed: number }
  /** Сводка текущей страницы, как у open. */
  outline?: PreviewPageOutline
  /** Закладки этого сеанса панели: их видит и пользователь. */
  bookmarks?: PreviewBookmarkEntry[]
  /** Панель ждёт человека: заданный вопрос или переданный ему шаг. */
  waitingFor?: { kind: 'question' | 'handover'; text: string; since: number }
  /** Размер видимой области страницы: понять, мобильная ли раскладка у пользователя. */
  viewport?: { width: number; height: number }
}

export interface PreviewPageInfo {
  url: string
  title: string
  /** Язык документа, описание и иконка сайта — ориентиры, которые человек видит во вкладке браузера. */
  lang?: string
  description?: string
  icon?: string
}

export interface PreviewCheckResult {
  page: PreviewPageInfo
  pass: boolean
  expected: { text?: string; selector?: string; state: 'visible' | 'hidden' | 'present' | 'absent'; value?: string; count?: number }
  actual: { count: number; visible: number; value?: string; element?: PreviewActionElement }
  /** Короткая фраза для ленты действий: «Кнопка „Войти“ видна». */
  summary: string
}

export interface PreviewFindResult {
  page: PreviewPageInfo
  elements: PreviewActionElement[]
  /** Сколько всего совпадений на странице (elements обрезан лимитом). */
  total: number
  /** Ничего не нашлось — похожие тексты на странице, как человек «поискал бы глазами рядом». */
  suggestions?: string[]
}

export interface PreviewClickResult {
  page: PreviewPageInfo
  clicked: PreviewActionElement
  /** Клик привёл к загрузке новой страницы: page уже описывает её, читать заново обязательно. */
  navigated?: boolean
  /** Открытые после клика диалоги (role=dialog, <dialog open>) — «появилось окно». */
  dialogs?: string[]
  /** Элемент с фокусом после клика. */
  focus?: string
  /** Ошибки страницы, возникшие синхронно в ответ на клик. */
  newErrors?: PreviewPageError[]
  /** Элемент, перекрывающий цель в точке клика (оверлей, модалка): клик мог не дойти. */
  obscuredBy?: string
  /** Что изменилось сразу после клика: появившиеся и исчезнувшие тексты. */
  changes?: PreviewChanges
  /** Итог ожидания waitFor. */
  waited?: { text: string; found: boolean; error?: string }
  /** Цель появилась не сразу: сколько ждали, как ждёт человек, пока кнопка прорисуется. */
  waitedMs?: number
  /** peek: клика не было — только адрес ссылки, другой ли это сайт и откроется ли она в новой вкладке. */
  peeked?: true
  href?: string
  external?: boolean
  newTab?: boolean
}

export interface PreviewTypeResult {
  page: PreviewPageInfo
  typed: PreviewActionElement
  submitted: boolean
  /** Итоговое значение поля после ввода (пустое у секретных полей). */
  value?: string
  navigated?: boolean
  /** Подсказки автодополнения, показавшиеся после ввода (listbox/datalist). */
  options?: string[]
  /** Что изменилось на странице сразу после ввода (подсказки, сообщения). */
  changes?: PreviewChanges
  waitedMs?: number
  /** Сообщения валидации после отправки: то, что пользователь увидел бы красным. */
  validation?: { field: string; message: string }[]
}

export interface PreviewFillResult {
  page: PreviewPageInfo
  filled: { field: string; selector: string; value: string }[]
  /** Поля, которые не нашлись: остальные всё равно заполнены. */
  missing?: { field: string; error: string }[]
  submitted: boolean
  validation?: { field: string; message: string }[]
  navigated?: boolean
}

export interface PreviewChooseResult {
  page: PreviewPageInfo
  chosen: PreviewActionElement
  /** Триггер, который открыл список, если он был. */
  opened?: PreviewActionElement
  navigated?: boolean
}

/** Структурированное содержимое страницы (или поддерева по selector). */
export interface PreviewReadResult {
  page: PreviewPageInfo
  /** selector — чтобы прокрутить к заголовку или прочитать раздел под ним. */
  headings: { level: number; text: string; selector?: string }[]
  links: { text: string; href: string }[]
  buttons: string[]
  inputs: { selector: string; type: string; name: string; placeholder: string; value: string; label?: string; expanded?: boolean; selected?: boolean; disabled?: boolean; readOnly?: boolean; checked?: boolean | 'mixed'; required?: boolean; invalid?: boolean; /** Варианты select — из чего человек выбирает. */ options?: string[] }[]
  /** Формы страницы: поля и кнопка отправки — маршрут входа или поиска виден целиком. */
  forms?: { selector: string; fields: string[]; submit?: string }[]
  /** Ориентиры страницы (navigation, main, banner…) с именами — как их видит скринридер. */
  landmarks?: { role: string; name: string; selector: string }[]
  /** Таблицы: заголовки и первые строки — человек читает таблицу по строкам. */
  tables?: { selector: string; caption?: string; headers: string[]; rows: string[][]; totalRows: number }[]
  /** Встроенные iframe: часть содержимого живёт в них и недоступна прокси-панели. */
  frames?: { selector: string; src: string; title: string }[]
  /** Видимые картинки: подпись alt, реальный адрес и размер — человек видит их, модель без этого нет. */
  images?: { selector: string; alt: string; src: string; width: number; height: number }[]
  /** Что лежит поверх страницы: баннер cookie, модальное окно, липкая панель — то, что человек убирает первым. */
  overlays?: { selector: string; text: string; kind: 'cookies' | 'dialog' | 'sticky' }[]
  /** Путь по сайту (хлебные крошки) — где страница лежит в иерархии. */
  breadcrumbs?: { text: string; href?: string }[]
  /** Листалка страницы: куда вести «дальше» и «назад», как их видит человек. */
  pagination?: { next?: string; prev?: string; label?: string }
  /** Что за материал: дата публикации и автор, если страница их показывает. */
  published?: { date?: string; author?: string }
  /** Поле поиска самого сайта (для search). */
  search?: string
  /** Прочитано только основное содержимое (main: true) — selector найденного блока. */
  main?: string
  /** Оглавление страницы: заголовки с уровнями и селекторами для scroll и read {section}. */
  toc?: { level: number; text: string; selector: string }[]
  /** Однотипные списки карточек: сколько элементов и первые из них — так человек оценивает выдачу. */
  lists?: { selector: string; count: number; items: string[] }[]
  /** Прочитана одна таблица (table): её строки с учётом rowOffset. */
  table?: { selector: string; caption?: string; headers: string[]; rows: string[][]; totalRows: number; rowOffset: number; nextRowOffset?: number }
  /** Элемент с фокусом — где сейчас «курсор» пользователя. */
  focus?: string
  /** Текст, выделенный пользователем на странице (до 2000 символов). */
  selection?: string
  /** Заголовок раздела, если читали section. */
  section?: string
  /** Открытое модальное окно: чтение ограничено им, как и внимание человека. */
  dialog?: string
  /** Короткое описание страницы (brief: true). */
  brief?: string
  /** Прокрутка окна: насколько человек уже долистал. */
  scroll?: { top: number; max: number; percent: number }
  /** Уведомления и баннеры, видимые сейчас (role=alert/status, тосты). */
  notices?: string[]
  /** Что ещё загружается: индикаторы прогресса и aria-busy-области. */
  progress?: { selector: string; value?: number; max?: number; label?: string }[]
  /** Видимый текст (обрезан лимитом) — на случай страниц без семантики. */
  text: string
  total?: number
  offset?: number
  nextOffset?: number
  truncated?: boolean
}

export interface PreviewOpenResult {
  url: string
  /** Заголовок загруженной страницы — модели не нужен отдельный read ради него. */
  title?: string
  outline?: PreviewPageOutline
  /** Итоговый адрес отличается от запрошенного — сайт перенаправил. */
  redirected?: boolean
  /** Итог ожидания waitFor: текст дождались или нет (с причиной). */
  waited?: { text: string; found: boolean; error?: string }
  /** Новый адрес на другом сайте, чем прежний: человек заметил бы смену домена. */
  crossSite?: boolean
}

export interface PreviewStylesResult {
  page: PreviewPageInfo
  selector: string
  styles: Record<string, string>
}

export interface PreviewHoverResult {
  page: PreviewPageInfo
  hovered: PreviewActionElement
  /** Подсказка, которую увидел бы пользователь: title, aria-describedby или появившийся role=tooltip. */
  tooltip?: string
  /** Курсор над элементом (pointer, not-allowed, text…) — «рука» подсказывает кликабельность. */
  cursor?: string
  /** Элементы, показавшиеся после наведения (пункты меню): их можно нажать следующим шагом. */
  revealed?: PreviewActionElement[]
}

export interface PreviewScrollResult {
  page: PreviewPageInfo
  /** Что прокручено: окно или контейнер по селектору. */
  target: string
  scrolled: { top: number; left: number; maxTop: number; maxLeft?: number }
  /** Достигнут край: дальше ленивая лента либо подгрузится, либо это конец. */
  atTop?: boolean
  atBottom?: boolean
  /** Насколько долистано, 0–100: «на середине страницы». */
  percent?: number
  /** Итог scroll {until}: нашёлся ли текст и сколько экранов пролистали. */
  found?: PreviewActionElement
  screens?: number
  /** Элемент, к которому листали (to: element). */
  element?: PreviewActionElement
}

export interface PreviewPressResult {
  page: PreviewPageInfo
  pressed: { key: string; selector: string; repeat?: number }
  navigated?: boolean
  /** Диалоги, оставшиеся открытыми после нажатия (Escape закрыл окно или нет). */
  dialogs?: string[]
}

/** Снимок области страницы: PNG/JPEG data-URL и итоговый rect в координатах документа. */
export interface PreviewScreenshotResult {
  page: PreviewPageInfo
  rect: { x: number; y: number; width: number; height: number }
  dataUrl: string
  /** Пронумерованные на снимке элементы (marks: true). */
  marks?: { n: number; selector: string; text: string; role?: string }[]
}

export interface PreviewQuestionResult {
  page: PreviewPageInfo | null
  question: string
  /** Ответ человека; answered: false — он не ответил за отведённое время или отложил вопрос. */
  answered: boolean
  answer?: string
  waitedMs: number
}

export interface PreviewHandoverResult {
  page: PreviewPageInfo | null
  reason: string
  /** Человек вернул управление (true) или время вышло. */
  returned: boolean
  waitedMs: number
}

export interface PreviewBookmarkEntry {
  url: string
  label: string
  at: number
}

export interface PreviewBookmarkResult {
  page: PreviewPageInfo | null
  bookmarks: PreviewBookmarkEntry[]
  added?: PreviewBookmarkEntry
  removed?: PreviewBookmarkEntry
}

export interface PreviewSearchResult {
  page: PreviewPageInfo
  /** Поле поиска сайта, которым воспользовались. */
  field: PreviewActionElement
  query: string
  submitted: boolean
  /** Подсказки, которые сайт показал под полем. */
  suggestions?: string[]
  navigated?: boolean
  waited?: { text: string; found: boolean; error?: string }
}

export interface PreviewFocusResult {
  page: PreviewPageInfo
  focused: PreviewActionElement
}

export interface PreviewSelectResult {
  page: PreviewPageInfo
  selected: string
  target: PreviewActionElement
}

export interface PreviewDismissResult {
  page: PreviewPageInfo
  dismissed: boolean
  /** Как убрали: отклонили cookie, закрыли крестиком, приняли (когда иного выбора нет) или нажали Escape. */
  how?: 'rejected' | 'closed' | 'accepted' | 'escape'
  target?: PreviewActionElement
  /** Сколько окон/баннеров ещё видно после действия. */
  remaining: number
}

export interface PreviewShowResult {
  page: PreviewPageInfo
  shown: PreviewActionElement
  /** Сколько элементов подсвечено при all: true. */
  shownCount?: number
}

/** Опасное действие остановлено до подтверждения: модель спрашивает человека и повторяет с confirm: true. */
export interface PreviewConfirmationResult {
  page: PreviewPageInfo
  needsConfirmation: true
  /** Почему: оплата, удаление, отправка, скачивание файла. */
  reason: string
  target: PreviewActionElement
}

/** Запись об ошибке страницы (кольцевой буфер инъецированного скрипта). */
export interface PreviewPageError {
  kind: 'error' | 'unhandledrejection' | 'console.error' | 'network'
  message: string
  /** Для network: реальный (не прокси) адрес и статус ответа. */
  url?: string
  status?: number
  /** Миллисекунды с загрузки страницы (performance.now на момент ошибки). */
  at: number
}

export interface PreviewErrorsResult {
  page: PreviewPageInfo
  /** Одинаковые сообщения схлопнуты; count — сколько раз повторилось. */
  errors: (PreviewPageError & { count?: number })[]
  /** Сколько всего накоплено (errors обрезан лимитом выдачи). */
  total: number
}

export interface PreviewWaitResult {
  page: PreviewPageInfo
  /** Найденный элемент; для state hidden/detached отсутствует. */
  found?: PreviewActionElement
  waitedMs: number
  state?: 'attached' | 'detached' | 'visible' | 'hidden'
}

export interface PreviewBackResult {
  page: PreviewPageInfo
  navigating: boolean
}

/** Запись журнала сетевых запросов страницы (кольцевой буфер скрипта). */
export interface PreviewNetworkEntry {
  /** Транспорт запроса: fetch, XHR, beacon или загрузка самой страницы. */
  via: 'fetch' | 'xhr' | 'beacon'
  method: string
  /** Реальный (не прокси) адрес. */
  url: string
  status?: number
  /** Длительность запроса, мс (нет — запрос ещё в полёте или упал до ответа). */
  ms?: number
  error?: string
  /** Миллисекунды с загрузки страницы на момент старта запроса. */
  at: number
}

export interface PreviewNetworkResult {
  page: PreviewPageInfo
  requests: PreviewNetworkEntry[]
  /** Сколько всего накоплено (requests обрезан лимитом выдачи). */
  total: number
}

/** Запись журнала консоли страницы. */
export interface PreviewConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  at: number
}

export interface PreviewConsoleResult {
  page: PreviewPageInfo
  messages: PreviewConsoleEntry[]
  total: number
}

export interface PreviewEvaluateResult {
  page: PreviewPageInfo
  /** JSON.stringify результата (обрезан капом evaluateValue); undefined → "undefined". */
  value: string
}

export interface PreviewDragResult {
  page: PreviewPageInfo
  dragged: PreviewActionElement
  /** Итоговая точка отпускания в координатах вьюпорта. */
  to: { x: number; y: number }
  /** Какой механикой выполнено: pointer-события или HTML5 DnD. */
  via: 'pointer' | 'html5'
}

export interface PreviewSetResult {
  page: PreviewPageInfo
  set: PreviewActionElement
  /** Итоговое состояние контрола после установки. */
  value: string
}

export interface PreviewUploadResult {
  page: PreviewPageInfo
  uploaded: { selector: string; name: string; size: number }
}

/** Результат viewport: исполняет Reader-оболочка, страница не участвует. */
export interface PreviewViewportResult {
  /** Применённая ширина в px; 0 — адаптив (по ширине панели). */
  width: number
}

/** Узел дерева доступности: роль и имя как их видит скринридер. */
export interface PreviewA11yNode {
  disabled?: boolean
  readOnly?: boolean
  checked?: boolean | 'mixed'
  expanded?: boolean
  selected?: boolean
  required?: boolean
  invalid?: boolean
  role: string
  name: string
  selector: string
  /** Глубина вложенности узла относительно корня обхода. */
  level: number
}

export interface PreviewA11yResult {
  page: PreviewPageInfo
  nodes: PreviewA11yNode[]
  total: number
}

/** Правка edit-режима одного элемента (selector → что изменено). */
export interface PreviewEditEntry {
  selector: string
  style?: Record<string, string>
  text?: string
  deleted?: boolean
}

export interface PreviewEditsResult {
  page: PreviewPageInfo
  edits: PreviewEditEntry[]
}

export type PreviewActionResult =
  | PreviewAuditResult
  | PreviewProbeResult
  | PreviewAccessibilityResult
  | PreviewOpenResult
  | PreviewFindResult
  | PreviewClickResult
  | PreviewTypeResult
  | PreviewReadResult
  | PreviewStylesResult
  | PreviewHoverResult
  | PreviewScrollResult
  | PreviewPressResult
  | PreviewScreenshotResult
  | PreviewErrorsResult
  | PreviewWaitResult
  | PreviewBackResult
  | PreviewEditsResult
  | PreviewNetworkResult
  | PreviewConsoleResult
  | PreviewEvaluateResult
  | PreviewDragResult
  | PreviewSetResult
  | PreviewUploadResult
  | PreviewViewportResult
  | PreviewA11yResult
  | PreviewStatusResult
  | PreviewFillResult
  | PreviewChooseResult
  | PreviewCheckResult
  | PreviewShowResult
  | PreviewDismissResult
  | PreviewSearchResult
  | PreviewFocusResult
  | PreviewSelectResult
  | PreviewBookmarkResult
  | PreviewQuestionResult
  | PreviewHandoverResult
  | PreviewSequenceResult
  | PreviewChangesResult
  | PreviewReportResult
  | PreviewConfirmationResult

/** Команда родителя в iframe превью. */
export interface PreviewActionCommand {
  type: typeof PREVIEW_ACTION_COMMAND_TYPE
  requestId: string
  action: PreviewDomAction
}

/** Ответ iframe родителю (тот же конверт UI шлёт серверу в preview.result). */
export interface PreviewActionResultMessage {
  type: typeof PREVIEW_ACTION_RESULT_TYPE
  requestId: string
  ok: boolean
  result?: PreviewActionResult
  error?: string
}

function validNth(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}
function optBounded(value: unknown, max: number): boolean {
  return value === undefined || bounded(value, max)
}

/** Валидатор действия (вход инструмента уже проверил zod — это проверка КОНВЕРТА). */
export function isPreviewAction(value: unknown): value is PreviewAction {
  if (!record(value)) return false
  if (value.frame !== undefined && !isBrowserFramePath(value.frame)) return false
  const L = PREVIEW_ACTION_LIMITS
  switch (value.kind) {
    case 'open':
      return bounded(value.url, L.url) && (isHttpUrl(value.url) || isRelativePreviewPath(value.url) || isBareHostUrl(value.url)) && optBounded(value.waitFor, L.text)
    case 'find':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        optBounded(value.near, L.text) && (value.exact === undefined || typeof value.exact === 'boolean') && validNth(value.nth) && optBounded(value.href, L.url) &&
        (value.enabled === undefined || typeof value.enabled === 'boolean') && (value.checked === undefined || typeof value.checked === 'boolean') && (value.reveal === undefined || typeof value.reveal === 'boolean') &&
        (value.level === undefined || (typeof value.level === 'number' && Number.isInteger(value.level) && value.level >= 1 && value.level <= 6)) &&
        (value.role === undefined || (bounded(value.role, 40) && /^[a-zа-яё]+$/i.test(value.role))) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isFinite(value.limit))) &&
        (value.visibleOnly === undefined || typeof value.visibleOnly === 'boolean') &&
        (value.onScreen === undefined || typeof value.onScreen === 'boolean') && (value.details === undefined || typeof value.details === 'boolean') && optBounded(value.in, L.text) &&
        (PREVIEW_SPATIAL_SIDES as readonly string[]).every((side) => optBounded(value[side], L.text)) &&
        (value.text !== undefined || value.selector !== undefined || value.role !== undefined || value.href !== undefined)
      )
    case 'click':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        optBounded(value.near, L.text) && (value.exact === undefined || typeof value.exact === 'boolean') && validNth(value.nth) &&
        (value.x === undefined && value.y === undefined || typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y) && value.x >= 0 && value.y >= 0 && value.x <= 100_000 && value.y <= 100_000) &&
        (value.role === undefined || (bounded(value.role, 40) && /^[a-zа-яё]+$/i.test(value.role))) &&
        (value.text !== undefined || value.selector !== undefined || value.x !== undefined || value.role !== undefined) && optBounded(value.waitFor, L.text) && (value.confirm === undefined || typeof value.confirm === 'boolean') &&
        (value.peek === undefined || typeof value.peek === 'boolean') && (PREVIEW_SPATIAL_SIDES as readonly string[]).every((side) => optBounded(value[side], L.text)) &&
        (value.button === undefined || value.button === 'left' || value.button === 'right') &&
        (value.dblclick === undefined || typeof value.dblclick === 'boolean') &&
        (value.modifiers === undefined || (Array.isArray(value.modifiers) && value.modifiers.length <= 4 && value.modifiers.every((item) => (PREVIEW_CLICK_MODIFIERS as readonly string[]).includes(item as string))))
      )
    case 'type':
      return optBounded(value.selector, L.selector) && optBounded(value.field, L.text) && optBounded(value.near, L.text) &&
        (bounded(value.selector, L.selector) && value.selector.length > 0 || bounded(value.field, L.text) && value.field.trim().length > 0) &&
        bounded(value.text, L.text) &&
        (value.submit === undefined || typeof value.submit === 'boolean') &&
        (value.append === undefined || typeof value.append === 'boolean') &&
        (value.perKey === undefined || typeof value.perKey === 'boolean') && optBounded(value.waitFor, L.text) && (value.secret === undefined || typeof value.secret === 'boolean') && (value.blur === undefined || typeof value.blur === 'boolean') &&
        // Посимвольный ввод: пауза больше пятой доли секунды превращает
        // проверку в ожидание, а не в ввод.
        (value.delay === undefined || (typeof value.delay === 'number' && Number.isFinite(value.delay) && value.delay >= 0 && value.delay <= 200))
    case 'read':
      return optBounded(value.selector, L.selector) && optBounded(value.section, L.text) && optBounded(value.around, L.text) && (value.markdown === undefined || typeof value.markdown === 'boolean') && (value.main === undefined || typeof value.main === 'boolean') &&
        (value.next === undefined || typeof value.next === 'boolean') && (value.toc === undefined || typeof value.toc === 'boolean') && optBounded(value.table, L.text) &&
        (value.rowOffset === undefined || (typeof value.rowOffset === 'number' && Number.isInteger(value.rowOffset) && value.rowOffset >= 0 && value.rowOffset <= 100_000)) &&
        (value.visible === undefined || typeof value.visible === 'boolean') && (value.brief === undefined || typeof value.brief === 'boolean') &&
        (value.parts === undefined || (Array.isArray(value.parts) && value.parts.length >= 1 && value.parts.length <= 9 && value.parts.every((part) => (PREVIEW_READ_PARTS as readonly string[]).includes(part as string)))) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 100 && value.limit <= 20_000)) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0))
    case 'styles':
      return bounded(value.selector, L.selector) &&
        (value.properties === undefined || (Array.isArray(value.properties) && value.properties.length <= 32 && value.properties.every((item) => bounded(item, 100))))
    case 'hover':
      return (
        optBounded(value.text, L.text) &&
        optBounded(value.selector, L.selector) &&
        optBounded(value.near, L.text) && (value.exact === undefined || typeof value.exact === 'boolean') && validNth(value.nth) &&
        (value.waitMs === undefined || (typeof value.waitMs === 'number' && Number.isFinite(value.waitMs) && value.waitMs >= 0 && value.waitMs <= 2000)) &&
        (value.role === undefined || (bounded(value.role, 40) && /^[a-zа-яё]+$/i.test(value.role))) &&
        (value.text !== undefined || value.selector !== undefined || value.role !== undefined)
      )
    case 'scroll':
      return (
        optBounded(value.selector, L.selector) && optBounded(value.text, L.text) &&
        (value.to === undefined || value.to === 'top' || value.to === 'bottom' || value.to === 'nextPage' || value.to === 'prevPage' || value.to === 'element' && (bounded(value.selector, L.selector) || bounded(value.text, L.text))) &&
        (value.percent === undefined || (typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100)) &&
        (value.dy === undefined || (typeof value.dy === 'number' && Number.isFinite(value.dy) && Math.abs(value.dy) <= 100_000)) &&
        (value.dx === undefined || (typeof value.dx === 'number' && Number.isFinite(value.dx) && Math.abs(value.dx) <= 100_000)) &&
        optBounded(value.until, L.text) &&
        (value.maxScreens === undefined || (typeof value.maxScreens === 'number' && Number.isInteger(value.maxScreens) && value.maxScreens >= 1 && value.maxScreens <= 50)) &&
        (value.to !== undefined || value.dy !== undefined || value.dx !== undefined || value.percent !== undefined || value.until !== undefined)
      )
    case 'press':
      return (
        typeof value.key === 'string' && value.key.length >= 1 && value.key.length <= 32 &&
        optBounded(value.selector, L.selector) && optBounded(value.waitFor, L.text) &&
        (value.repeat === undefined || (typeof value.repeat === 'number' && Number.isInteger(value.repeat) && value.repeat >= 1 && value.repeat <= 50))
      )
    case 'screenshot': {
      if (!optBounded(value.selector, L.selector) || (value.marks !== undefined && typeof value.marks !== 'boolean')) return false
      if (value.rect === undefined) return true
      if (!record(value.rect)) return false
      const rect = value.rect
      return (['x', 'y', 'width', 'height'] as const).every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key] as number) && Math.abs(rect[key] as number) <= 100_000) &&
        (rect.width as number) > 0 && (rect.height as number) > 0
    }
    case 'audit':
      return value.frame === undefined && isPreviewAuditOptions(value)
    case 'accessibility':
      return isPreviewAccessibilityOptions(value)
    case 'probe':
      return value.frame === undefined && isPreviewProbeOptions(value)
    case 'errors':
      return (value.clear === undefined || typeof value.clear === 'boolean') && (value.since === undefined || (typeof value.since === 'number' && Number.isFinite(value.since) && value.since >= 0)) &&
        (value.kinds === undefined || (Array.isArray(value.kinds) && value.kinds.length >= 1 && value.kinds.length <= 4 && value.kinds.every((kind) => ['error', 'unhandledrejection', 'console.error', 'network'].includes(kind as string))))
    case 'show':
      return optBounded(value.text, L.text) && optBounded(value.selector, L.selector) && optBounded(value.near, L.text) && optBounded(value.label, 120) && (value.all === undefined || typeof value.all === 'boolean') &&
        (value.text !== undefined || value.selector !== undefined)
    case 'check':
      return optBounded(value.text, L.text) && optBounded(value.selector, L.selector) && optBounded(value.near, L.text) && optBounded(value.value, L.text) && optBounded(value.contains, L.text) && optBounded(value.url, L.url) && optBounded(value.title, L.text) &&
        (value.enabled === undefined || typeof value.enabled === 'boolean') && (value.checked === undefined || typeof value.checked === 'boolean') &&
        (value.text !== undefined || value.selector !== undefined || value.url !== undefined || value.title !== undefined) &&
        (value.state === undefined || ['visible', 'hidden', 'present', 'absent'].includes(value.state as string)) &&
        (value.count === undefined || (typeof value.count === 'number' && Number.isInteger(value.count) && value.count >= 0 && value.count <= 100_000))
    case 'wait':
      return isBrowserWaitOptions(value)
    case 'back':
    case 'forward':
      return (value.steps === undefined || (typeof value.steps === 'number' && Number.isInteger(value.steps) && value.steps >= 1 && value.steps <= 20)) &&
        (value.to === undefined || (value.kind === 'back' && bounded(value.to, L.text) && value.to.trim().length > 0))
    case 'edits':
    case 'status':
      return true
    case 'sequence':
      return Array.isArray(value.steps) && value.steps.length >= 1 && value.steps.length <= 10 && (value.continueOnError === undefined || typeof value.continueOnError === 'boolean') &&
        value.steps.every((step) => record(step) && step.kind !== 'open' && step.kind !== 'sequence' && isPreviewAction(step))
    case 'fill':
      return Array.isArray(value.fields) && value.fields.length >= 1 && value.fields.length <= 30 &&
        value.fields.every((item) => record(item) && bounded(item.value, L.text) && optBounded(item.selector, L.selector) && optBounded(item.field, L.text) && optBounded(item.near, L.text) && (item.secret === undefined || typeof item.secret === 'boolean') &&
          (bounded(item.selector, L.selector) && item.selector.length > 0 || bounded(item.field, L.text) && item.field.trim().length > 0)) &&
        (value.submit === undefined || typeof value.submit === 'boolean') && (value.perKey === undefined || typeof value.perKey === 'boolean') && optBounded(value.waitFor, L.text) && (value.confirm === undefined || typeof value.confirm === 'boolean')
    case 'choose':
      return bounded(value.text, L.text) && value.text.trim().length > 0 && optBounded(value.in, L.text) && optBounded(value.near, L.text) && optBounded(value.waitFor, L.text) && (value.confirm === undefined || typeof value.confirm === 'boolean')
    case 'changes':
      return optBounded(value.selector, L.selector)
    case 'dismiss':
      return value.what === undefined || value.what === 'cookies' || value.what === 'dialog' || value.what === 'any'
    case 'search':
      return bounded(value.text, L.text) && value.text.trim().length > 0 && optBounded(value.in, L.selector) && optBounded(value.waitFor, L.text)
    case 'focus':
      return optBounded(value.selector, L.selector) && optBounded(value.field, L.text) && optBounded(value.near, L.text) &&
        (bounded(value.selector, L.selector) && value.selector.length > 0 || bounded(value.field, L.text) && value.field.trim().length > 0)
    /** Чтение фокуса — отдельный вид: `focus` ставит фокус и требует цель, а
     *  «где сейчас курсор» обязано ничего не двигать, иначе обход формы табом
     *  превращается в бесконечный цикл «спросил — сам же и сдвинул». */
    case 'focusState':
      return true
    case 'select':
      return optBounded(value.text, L.text) && optBounded(value.selector, L.selector) && optBounded(value.near, L.text) &&
        (value.text !== undefined || value.selector !== undefined)
    case 'report':
      return true
    case 'bookmark':
      return optBounded(value.label, 120) && optBounded(value.remove, L.url) && !(value.label !== undefined && value.remove !== undefined)
    case 'question':
      return bounded(value.question, 500) && value.question.trim().length > 0 &&
        (value.options === undefined || (Array.isArray(value.options) && value.options.length >= 1 && value.options.length <= 6 && value.options.every((option) => bounded(option, 80) && option.trim().length > 0))) &&
        (value.timeoutMs === undefined || (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) && value.timeoutMs >= 5_000 && value.timeoutMs <= 600_000))
    case 'handover':
      return bounded(value.reason, 300) && value.reason.trim().length > 0 &&
        (value.timeoutMs === undefined || (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) && value.timeoutMs >= 5_000 && value.timeoutMs <= 600_000))
    case 'network':
      return (
        validDiagnosticOptions(value) &&
        (value.state === undefined || ['pending', 'response', 'completed', 'failed'].includes(value.state as string)) &&
        optBounded(value.resourceType, 100) &&
        (value.failedOnly === undefined || typeof value.failedOnly === 'boolean') &&
        optBounded(value.filter, 300) &&
        (value.clear === undefined || typeof value.clear === 'boolean') &&
        (value.since === undefined || (typeof value.since === 'number' && Number.isFinite(value.since) && value.since >= 0)) &&
        logLimit(value.limit)
      )
    case 'console':
      return (
        validDiagnosticOptions(value) &&
        optBounded(value.pattern, 300) &&
        (value.level === undefined || value.level === 'log' || value.level === 'info' || value.level === 'warn' || value.level === 'error') &&
        (value.clear === undefined || typeof value.clear === 'boolean') &&
        logLimit(value.limit)
      )
    case 'evaluate':
      try { normalizeBrowserEvaluateOptions(value as unknown as BrowserEvaluateOptions); return true } catch { return false }
    case 'drag':
      return isDragPoint(value.from) && isDragPoint(value.to)
    case 'set':
      return (
        bounded(value.selector, L.selector) &&
        optBounded(value.value, L.text) &&
        (value.checked === undefined || typeof value.checked === 'boolean') &&
        // Несколько значений — это select multiple: по одному они затирают
        // друг друга, поэтому список считается полноценным «что выбрать».
        (value.values === undefined || (Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 64 && value.values.every((item) => bounded(item, L.text)))) &&
        (value.value !== undefined || value.values !== undefined || value.checked !== undefined)
      )
    case 'upload':
      // Несколько файлов передаются массивом; одиночная форма остаётся ради
      // совместимости с уже написанными ходами модели.
      if (value.files !== undefined) return bounded(value.selector, L.selector) && isUploadFiles(value.files)
      return (
        bounded(value.selector, L.selector) &&
        bounded(value.name, 255) && value.name.length > 0 &&
        optBounded(value.mimeType, 100) &&
        bounded(value.base64, L.uploadBase64)
      )
    case 'viewport':
      return typeof value.width === 'number' && Number.isFinite(value.width) && value.width >= 0 && value.width <= 10_000
    case 'storage':
      return (
        (value.area === undefined || ['local', 'session', 'both'].includes(value.area as string)) &&
        (value.do === undefined || ['read', 'set', 'remove', 'clear'].includes(value.do as string)) &&
        optBounded(value.key, 400) && optBounded(value.value, 100_000) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200)) &&
        // Запись без ключа поменяла бы неизвестно что, а `set` без значения —
        // это `remove`, и лучше сказать об этом, чем угадывать.
        (value.do !== 'set' || (typeof value.key === 'string' && typeof value.value === 'string')) &&
        (value.do !== 'remove' || typeof value.key === 'string')
      )
    case 'source':
      return optBounded(value.selector, L.selector) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0)) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 100 && value.limit <= 20_000))
    case 'csv':
      return bounded(value.selector, L.selector) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isInteger(value.offset) && value.offset >= 0)) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 500))
    case 'expect':
      return Array.isArray(value.checks) && value.checks.length > 0 && value.checks.length <= 20 && value.checks.every((check) => isExpectation(check))
    case 'history':
      return (value.actor === undefined || value.actor === 'user' || value.actor === 'assistant') &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200)) &&
        (value.clear === undefined || typeof value.clear === 'boolean')
    case 'note':
      return bounded(value.text, 500) && value.text.trim().length > 0
    case 'media':
      return optBounded(value.selector, L.selector) &&
        (value.do === undefined || ['play', 'pause', 'mute', 'unmute'].includes(value.do as string)) &&
        (value.seconds === undefined || (typeof value.seconds === 'number' && Number.isFinite(value.seconds) && value.seconds >= 0 && value.seconds <= 86_400))
    case 'environment':
      return (
        (value.colorScheme === undefined || ['light', 'dark', 'no-preference'].includes(value.colorScheme as string)) &&
        (value.reducedMotion === undefined || ['reduce', 'no-preference'].includes(value.reducedMotion as string)) &&
        (value.forcedColors === undefined || ['active', 'none'].includes(value.forcedColors as string)) &&
        (value.offline === undefined || typeof value.offline === 'boolean') &&
        (value.geolocation === undefined || value.geolocation === null || (record(value.geolocation) &&
          typeof value.geolocation.latitude === 'number' && Math.abs(value.geolocation.latitude) <= 90 &&
          typeof value.geolocation.longitude === 'number' && Math.abs(value.geolocation.longitude) <= 180 &&
          (value.geolocation.accuracy === undefined || (typeof value.geolocation.accuracy === 'number' && value.geolocation.accuracy >= 0)))) &&
        (value.permissions === undefined || (Array.isArray(value.permissions) && value.permissions.length <= 16 && value.permissions.every((item) => bounded(item, 64)))) &&
        ['colorScheme', 'reducedMotion', 'forcedColors', 'offline', 'geolocation', 'permissions'].some((key) => value[key] !== undefined)
      )
    case 'highlight':
      return bounded(value.selector, L.selector) &&
        (value.ms === undefined || (typeof value.ms === 'number' && Number.isFinite(value.ms) && value.ms >= 100 && value.ms <= 10_000))
    case 'focusOrder':
      return optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200))
    case 'fillForm':
      return (
        optBounded(value.selector, L.selector) &&
        Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= 50 &&
        value.fields.every((field) => isFormField(field)) &&
        (value.delay === undefined || (typeof value.delay === 'number' && Number.isFinite(value.delay) && value.delay >= 0 && value.delay <= 200))
      )
    case 'formState':
      return optBounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200))
    case 'validity':
    case 'submit':
      return optBounded(value.selector, L.selector)
    case 'options':
      return bounded(value.selector, L.selector) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 500))
    case 'dropFile':
      return bounded(value.selector, L.selector) && isUploadFiles(value.files)
    case 'hotkey':
      return (
        typeof value.key === 'string' && value.key.length >= 1 && value.key.length <= 32 &&
        Array.isArray(value.modifiers) && value.modifiers.length > 0 && value.modifiers.length <= 4 &&
        value.modifiers.every((item) => (PREVIEW_HOTKEY_MODIFIERS as readonly string[]).includes(item as string)) &&
        optBounded(value.selector, L.selector) && keyRepeat(value.repeat)
      )
    case 'selectText':
      return optBounded(value.selector, L.selector)
    case 'clear':
      return bounded(value.selector, L.selector)
    case 'copy':
      return true
    case 'paste':
      return bounded(value.text, L.text) && optBounded(value.selector, L.selector)
    case 'scrollUntil':
      return (
        optBounded(value.selector, L.selector) && optBounded(value.text, L.text) && optBounded(value.container, L.selector) &&
        (value.selector !== undefined || value.text !== undefined) &&
        (value.maxScrolls === undefined || (typeof value.maxScrolls === 'number' && Number.isInteger(value.maxScrolls) && value.maxScrolls >= 1 && value.maxScrolls <= 50)) &&
        (value.step === undefined || (typeof value.step === 'number' && Number.isFinite(value.step) && value.step > 0 && value.step <= 10_000))
      )
    case 'count':
      return optBounded(value.selector, L.selector) && optBounded(value.text, L.text) &&
        (value.selector !== undefined || value.text !== undefined) &&
        (value.visibleOnly === undefined || typeof value.visibleOnly === 'boolean')
    case 'table':
      return bounded(value.selector, L.selector) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isInteger(value.offset) && value.offset >= 0)) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 200)) &&
        (value.columns === undefined || (Array.isArray(value.columns) && value.columns.length > 0 && value.columns.length <= 32 && value.columns.every((item) => bounded(item, 200))))
    case 'list':
      return bounded(value.selector, L.selector) &&
        (value.offset === undefined || (typeof value.offset === 'number' && Number.isInteger(value.offset) && value.offset >= 0)) &&
        (value.limit === undefined || (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 100))
    case 'metrics':
      return true
    case 'measure':
      return bounded(value.selector, L.selector)
    case 'a11y':
      return optBounded(value.selector, L.selector) && (value.limit === undefined || (typeof value.limit === 'number' && Number.isFinite(value.limit)))
    default:
      return false
  }
}

function validDiagnosticOptions(value: Record<string, unknown>): boolean {
  try { normalizeBrowserDiagnosticOptions(value); return true } catch { return false }
}

function isExpectation(value: unknown): boolean {
  if (!record(value)) return false
  const L = PREVIEW_ACTION_LIMITS
  if (value.is === 'text') return bounded(value.value, L.text) && optBounded(value.selector, L.selector) && (value.absent === undefined || typeof value.absent === 'boolean')
  if (value.is === 'visible') return bounded(value.selector, L.selector) && (value.absent === undefined || typeof value.absent === 'boolean')
  if (value.is === 'count') return bounded(value.selector, L.selector) && typeof value.value === 'number' && Number.isInteger(value.value) && value.value >= 0 && value.value <= 100_000
  if (value.is === 'value') return bounded(value.selector, L.selector) && typeof value.value === 'string' && value.value.length <= L.text
  if (value.is === 'url') return bounded(value.value, L.url)
  return false
}

function isFormField(value: unknown): boolean {
  if (!record(value)) return false
  const L = PREVIEW_ACTION_LIMITS
  return bounded(value.selector, L.selector) &&
    optBounded(value.value, L.text) &&
    (value.values === undefined || (Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 64 && value.values.every((item) => bounded(item, L.text)))) &&
    (value.checked === undefined || typeof value.checked === 'boolean') &&
    (value.value !== undefined || value.values !== undefined || value.checked !== undefined)
}

/** Общий бюджет на все файлы тот же, что на один: он упирается в память раннера. */
function isUploadFiles(value: unknown): boolean {
  const L = PREVIEW_ACTION_LIMITS
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return false
  let total = 0
  for (const item of value) {
    if (!record(item)) return false
    if (!bounded(item.name, 255) || item.name.length === 0) return false
    if (!optBounded(item.mimeType, 100)) return false
    if (!bounded(item.base64, L.uploadBase64)) return false
    total += (item.base64 as string).length
  }
  return total <= L.uploadBase64
}

/** Repeat of a keystroke: a person holds a key, but not a thousand times. */
function keyRepeat(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50)
}

function logLimit(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= PREVIEW_ACTION_LIMITS.logMax)
}

function isDragPoint(value: unknown): value is PreviewDragPoint {
  if (!record(value)) return false
  const coords = (value.x === undefined && value.y === undefined) ||
    (typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.x) <= 100_000 && Math.abs(value.y) <= 100_000)
  if (!coords) return false
  if (value.selector !== undefined && !bounded(value.selector, PREVIEW_ACTION_LIMITS.selector)) return false
  return value.selector !== undefined || value.x !== undefined
}

export function isPreviewDomAction(value: unknown): value is PreviewDomAction {
  return isPreviewAction(value) && value.kind !== 'open'
}

/** Относительный адрес от открытой страницы: путь, запрос или hash — без схемы и хоста. */
export function isRelativePreviewPath(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= PREVIEW_ACTION_LIMITS.url && /^(?:\/(?!\/)|\.{1,2}\/|\?|#)/.test(value)
}

/** Разрешить относительный адрес от текущей страницы; абсолютный http(s) остаётся как есть, иначе null. */
/** «example.com/path» без схемы — как вводит человек: дописываем https://. */
export function isBareHostUrl(value: string): boolean {
  return typeof value === 'string' && value.length <= PREVIEW_ACTION_LIMITS.url && /^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d{2,5})?(?:[/?#].*)?$/i.test(value)
}

export function resolvePreviewUrl(value: string, base: string | null): string | null {
  if (isHttpUrl(value)) return value
  if (isBareHostUrl(value)) return 'https://' + value
  if (!isRelativePreviewPath(value) || !base) return null
  try { const url = new URL(value, base); return isHttpUrl(url.toString()) ? url.toString() : null } catch { return null }
}

/** Только HTTP/HTTPS: прочие схемы в превью не открываются (см. previewProxy). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isPreviewActionCommand(value: unknown): value is PreviewActionCommand {
  return (
    record(value) &&
    value.type === PREVIEW_ACTION_COMMAND_TYPE &&
    bounded(value.requestId, 128) &&
    isPreviewDomAction(value.action)
  )
}

/**
 * Валидатор ответа. Структуру result глубоко не проверяем: его собирает наш же
 * скрипт превью, а модель получает сериализованный JSON. Держим только конверт
 * и общий кап размера — от него зависит контекст хода.
 */
export function isPreviewActionResultMessage(value: unknown): value is PreviewActionResultMessage {
  if (!record(value) || value.type !== PREVIEW_ACTION_RESULT_TYPE) return false
  if (!bounded(value.requestId, 128) || typeof value.ok !== 'boolean') return false
  if (!optBounded(value.error, 2_000)) return false
  if (value.result === undefined) return true
  if (!record(value.result)) return false
  try {
    const cap = isScreenshotResult(value.result) ? PREVIEW_ACTION_LIMITS.screenshotJson : PREVIEW_ACTION_LIMITS.resultJson
    return JSON.stringify(value.result).length <= cap
  } catch {
    return false
  }
}

/** Результат снимка: единственный тип, которому разрешён кап больше resultJson. */
export function isScreenshotResult(result: Record<string, unknown>): boolean {
  return typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:image/')
}

/**
 * Сериализация результата для ответа модели: null — результат превысил кап
 * (вызывающий отвечает ошибкой, а не обрезанным невалидным JSON).
 */
export function previewResultJson(result: NonNullable<BrowserActionOutcome['result']>): string | null {
  const json = JSON.stringify(result)
  return json.length <= PREVIEW_ACTION_LIMITS.resultJson ? json : null
}

/**
 * Системный хинт модели про инструменты браузера. Подключается исполнителем
 * CLI вместе с URL MCP-эндпоинта `browser` (см. apps/llm-runner).
 *
 * `chromium` — поверхность браузерной проверки задачи: страницы у пользователя
 * нет, вместо неё изолированный Chromium сервера, и dev-сервер на машине
 * поднимает сама модель. Всё остальное — те же инструменты, поэтому меняется
 * только вступление и хвост про окружение.
 */
export function previewToolHint(surface: 'panel' | 'chromium' = 'panel'): string {
  const opening = surface === 'chromium'
    ? 'Проверять результат в браузере — часть твоей работы над этой задачей. Браузер — изолированный Chromium на сервере, '
      + 'панели у пользователя нет: страница существует только пока ты с ней работаешь инструментами mcp__browser__*, '
      + 'и она сохраняется между вызовами. Инструменты: '
    : 'Рядом с чатом у пользователя открыта панель Web Reader — он видит каждое твоё действие в ней. Работай там как человек: '
      + 'находи элементы по видимому тексту, подписи поля или роли, после шага смотри на результат (read или screenshot) '
      + 'и коротко говори пользователю, что видишь и делаешь. Инструменты mcp__browser__*: '
  return (
    opening +
    'open {url} — открыть сайт в превью (относительный путь вроде /about или #/route разрешается от открытой страницы); read {selector?, limit?, offset?, visible?} — структурированное содержимое страницы ' +
    '(заголовки, ссылки, кнопки, поля ввода); visible: true — только то, что сейчас на экране у пользователя; nextOffset продолжает длинный текст. find {text|selector|role, limit?, visibleOnly?} — найти элементы ' +
    '(role: button, link, textbox, heading…; onScreen у элемента — виден без прокрутки); ' +
    'В Chromium read включает открытый Shadow DOM и слоты; закрытые roots недоступны. ' +
    'Селекторы из read/find передавай в следующее действие целиком, включая >> nth; после изменения DOM повтори поиск. ' +
    'В Chromium selector вместе с text ограничивает click, hover и find текстом внутри селектора. ' +
    'near {текст рядом} различает одинаковые кнопки по соседнему тексту («Удалить» near «Заказ №5»), exact: true требует точного совпадения текста; у найденных элементов context — текст их строки или секции. ' +
    'fill {fields: [{field|selector, value}], submit?} — заполнить форму целиком одним действием и отправить; ответ содержит validation (сообщения полей, как их увидел бы человек). ' +
    'choose {text, in?} — выбрать пункт выпадающего меню или списка: in — текст или селектор триггера, который его открывает. ' +
    'После type ответ может содержать options — подсказки автодополнения; после hover — revealed — показавшиеся пункты меню. Сочетания клавиш в press пишутся как Control+a или Shift+Tab. ' +
    'read {section: «Цены»} читает раздел под заголовком с таким текстом; read отдаёт selection — текст, выделенный пользователем на странице (если он просит «что это?» — начни с него). ' +
    'find {onScreen: true} — только то, что пользователь видит без прокрутки. type {perKey: true} печатает посимвольно с событиями клавиатуры (маски ввода, автодополнение). ' +
    'wait {url: шаблон с *} в панели ждёт, когда адрес страницы станет таким. Ответ click с obscuredBy означает, что цель перекрыта оверлеем — сначала закрой его. ' +
    'check {text|selector, state?: visible|hidden|present|absent, value?, count?} — проверка как у тестировщика: отвечает pass/actual/summary, не бросает ошибку; так проверяй результат фичи и цитируй summary в отчёте. ' +
    'nth: N у find/click/hover берёт N-е совпадение, если одинаковых элементов несколько; scroll {to: element, text} листает к тексту. errors {since} — только новые ошибки после отметки at. ' +
    'show {text|selector, label?} — показать пользователю элемент: панель прокрутит к нему и подсветит с подписью на несколько секунд («вот эта кнопка»). ' +
    'screenshot {marks: true} нумерует на снимке кликабельные элементы и возвращает marks — затем click {selector} по нужному номеру. read {brief: true} — короткое описание страницы словами; ' +
    'если открыто модальное окно, read без selector читает его (поле dialog). wait {idle: true} ждёт затихания сети страницы. status.manual: true — пользователь взял управление, подожди и спроси. ' +
    'open {url, waitFor?} дождётся текста после загрузки одним действием; find без результата возвращает suggestions — похожие тексты страницы; fill заполняет найденные поля и перечисляет missing; ' +
    'role принимает и русские слова (кнопка, ссылка, поле, заголовок); read у select перечисляет options; errors схлопывает повторы с count; status.viewport — размер экрана пользователя. ' +
    'sequence {steps: [...]} — до 10 действий одним вызовом с остановкой на первой ошибке (рутина «нажать → ввести → нажать»); read {parts: [...]} — только нужные части ответа; ' +
    'check {contains} — частичное совпадение текста; scroll {to: nextPage|prevPage} — на экран вниз/вверх; click {x, y} — по точке вьюпорта (карты, canvas); back/forward {steps}; network {since}; status.pending — сколько действий ещё выполняется. ' +
    'check {url: шаблон с *} и check {title: подстрока} проверяют адрес и заголовок страницы; find {href: подстрока} ищет ссылки по адресу; read parts включает tables (заголовки и строки таблиц); ' +
    'hover {waitMs} подождёт анимацию меню перед сбором revealed; errors {kinds: [...]} фильтрует по виду; клавиши в press можно называть по-русски (Ввод, Пробел, Вниз). ' +
    'changes — что появилось и исчезло на странице с прошлого read/changes/действия; ответ click тоже несёт changes. waitFor у click/type/press/choose/fill — дождаться текста после действия одним ходом. ' +
    'read.scroll — насколько человек долистал страницу; status.lastAction — последнее завершённое действие. open принимает адрес без схемы (example.com → https://). ' +
    'read.notices — уведомления и баннеры, видимые сейчас; read.progress — индикаторы загрузки; find/check {enabled, checked} — состояние контрола; click/hover {role} — «нажми кнопку Сохранить», а не ссылку; ' +
    'fill {perKey} печатает посимвольно; sequence {continueOnError: true} проходит все шаги как чек-лист и перечисляет провалы. ' +
    'report — отчёт о сеансе панели (история адресов, проверки с итогами, число действий) для отчёта по задаче; find {reveal: true} — найти и показать пользователю первое совпадение; ' +
    'click и type сами ждут цель до 1,5 с, если её ещё нет (waitedMs в ответе); changes {selector} сравнивает только область. ' +
    'Опасные действия — оплата, удаление, отправка денег, скачивание файла — панель останавливает и отвечает needsConfirmation: спроси пользователя словами и повтори с confirm: true только после его согласия. ' +
    'type {secret: true} не возвращает значение и не пишет его в сценарий; show {all: true} подсвечивает все совпадения; hover.cursor — «рука» над кликабельным; read.frames — встроенные iframe, недоступные панели; open.crossSite — перешли на другой сайт. ' +
    'read {around: фраза} — текст вокруг фразы; read {markdown: true} — текст с заголовками # и списками -; headings в read несут selector для scroll/read section; find {role: heading, level: 2}; ' +
    'scroll {percent: 50} — к доле документа; type {blur: true} снимает фокус после ввода (проверка поля по blur); fill fields[].secret; status.outline — сводка текущей страницы. ' +
    'find/click {below|above|leftOf|rightOf: текст-ориентир} — «кнопка под ценой», «поле справа от подписи»: ближайшее с той стороны идёт первым; find {details: true} — атрибуты, размер и путь элемента по ориентирам; ' +
    'read {parts: [images]} — видимые картинки с alt и адресом; read.overlays — что лежит поверх страницы (баннер cookie, окно, липкая панель); dismiss {what?: cookies|dialog|any} — убрать баннер cookie (предпочитая «отклонить»/«только необходимые») или закрыть всплывающее окно, как человек делает первым делом; ' +
    'click {peek: true} — не нажимать, а узнать, куда ведёт ссылка (href, external, newTab); scroll.percent — насколько долистано. ' +
    'search {text} — искать на самом сайте: панель найдёт его поле поиска, введёт запрос и отправит (первое, что делает человек на большом сайте); focus {field} ставит курсор, ничего не вводя; ' +
    'select {text} выделяет место на странице — пользователь видит, о чём речь. read {main: true} — только основное содержимое без меню и подвала; read.breadcrumbs — путь по сайту; ' +
    'read.pagination — куда вести «дальше» и «назад»; read.published — дата и автор материала; wait {stable: true} — дождаться, пока страница перестанет меняться; back {to: «часть адреса или заголовка»} — вернуться к странице этого сеанса. ' +
    'Длинные страницы и списки: scroll {until: текст} листает ленту с ленивой подгрузкой, пока текст не покажется (maxScreens ограничивает); read {next: true} продолжает чтение с того места, где остановился прошлый read; ' +
    'read {toc: true} — оглавление с селекторами для scroll и read {section}; read {table: подпись, rowOffset} читает одну таблицу постранично; read.lists — однотипные карточки списка с их числом; find {in: заголовок раздела} ищет только в нём. ' +
    'bookmark {label?} кладёт закладку на открытую страницу (bookmark {remove: адрес} убирает): список видят и пользователь в панели, и ты в status.bookmarks и report. ' +
    'Не угадывай за человека: question {question, options?} задаёт ему вопрос прямо в панели и ждёт ответа (до 10 минут, ответ приходит в answer); handover {reason} передаёт шаг ему («войди сам, я подожду») ' +
    'и ждёт, пока он вернёт управление. Пока панель ждёт, это видно в status.waitingFor, а вопросы с ответами попадают в report.questions. Спрашивай, когда выбор за человеком: размер, адрес доставки, какой из похожих пунктов нужен. ' +
    'status — состояние панели без обращения к странице: подключена ли, что открыто (url, title), загружена ли страница; вызывай его первым, если не уверен, что панель открыта. ' +
    'click {selector|text} — клик по элементу; type {selector|field, text, submit?, append?} — ввести текст в поле: field — подпись, ' +
    'placeholder или name поля, как его называет человек; ответ содержит итоговое value. ' +
    'Действия выполняются только на странице, открытой в превью активного чата пользователя. ' +
    'Просьбы «открой сайт …», «нажми …», «что на странице?» выполняй этими инструментами, а не shell-командами. ' +
    'open отвечает url, title и outline (заголовки, число ссылок, кнопок и полей) открытой страницы; read дополнительно перечисляет forms (поля и кнопка отправки) и landmarks. click, type и press сообщают navigated: true, если начался переход, — тогда page ' +
    'описывает уже новую страницу: перечитай её read перед следующим действием. Ответ click также содержит dialogs (появилось окно), focus и newErrors — реагируй на них, как отреагировал бы человек. ' +
    'Если панель отвечает, что клиент не подключён, скажи пользователю открыть раздел Web Reader этого чата в браузере и повтори действие после этого. ' +
    'Дополнительно: hover {selector|text} — навести курсор (выпадающие меню); scroll {to: top|bottom|element | dy, selector?} — ' +
    'прокрутить окно или контейнер (ленивые ленты), to: element показывает selector пользователю; press {key, selector?, repeat?} — нажать клавишу (Escape, Enter, Tab, ArrowDown…), repeat повторяет; ' +
    'screenshot {selector? | rect? | fullPage?, animations?, timeoutMs?} — картинка элемента, области или видимой части страницы. ' +
    'В Chromium fullPage снимает всю страницу, animations: disabled стабилизирует кадр; timeoutMs ограничивает ожидание, по умолчанию 10000 мс. ' +
    'Координаты снимка Chromium и действий — CSS px; rect задаётся в координатах документа; ' +
    'errors {clear?} — накопленные ошибки страницы (JS-исключения, console.error, упавшие запросы) — проверяй их после действий при тестировании; ' +
    'wait {selector|text, state?, timeoutMs?} — дождаться появления элемента; state: hidden или detached ждёт исчезновения (спиннер, модалка); в Chromium selector вместе с text ждёт текст внутри элемента. ' +
    'Дополнительные условия wait в Chromium: state (attached/detached/visible/hidden), enabled, editable, checked, value, count, url (шаблон с *), loadState (domcontentloaded/load), predicate (синхронное JS-условие). ' +
    'Условия делят один timeoutMs до 30000 мс; count включает скрытые узлы, по умолчанию видимость проверяется только без count. Для SPA жди нужное содержимое или predicate, один load не означает готовность приложения. ' +
    'back/forward — по истории страницы; ' +
    'В Chromium frames перечисляет живые iframe: передавай path как frame в read/find/click/type/hover/scroll/wait/set/upload/a11y/evaluate/styles/open/screenshot. ' +
    'frame — селектор iframe или цепочка до восьми уровней, работает и для документов другого origin; без него действие адресуется верхней странице. Селекторы read/find относительны выбранному frame. ' +
    'open с frame меняет только вложенный документ. press с frame требует selector, drag — два селектора. ' +
    'Снимок frame показывает видимую область; selector ограничивает её элементом, clipped сообщает усечение. fullPage и rect используются без frame. ' +
    'styles {selector, properties?, frame?} — вычисленные CSS-свойства. ' +
    'В Playwright Reader и Chromium-проверке также доступны tabs — список вкладок с id; new-tab {url?}; ' +
    'select-tab {tabId}; close-tab {tabId}; reload — перезагрузка; stop-loading — остановка загрузки без закрытия сессии. ' +
    'После открытия popup вызови tabs, найди его по openerTabId и выбери select-tab перед чтением или вводом. ' +
    'edits — правки, сделанные пользователем в режиме «Редактировать» (перенеси их в код, если просят «сделай как я поправил»); ' +
    'network {filter?, clear?} — журнал fetch/XHR-запросов страницы (метод, реальный URL, статус, длительность); ' +
    'console {pattern?, level?, clear?} — журнал console.log/info/warn/error; ' +
    'evaluate {code} — выполнить JS в контексте страницы и получить JSON результата (состояние стора, обход нестандартных контролов); ' +
    'drag {from, to} — перетащить элемент (канбан, сортировка): from/to — {selector} или {x, y}; ' +
    'set {selector, value|checked} — установить select по значению или подписи option, checkbox/radio, date/range; ' +
    'upload {selector, name, base64, mimeType?} — загрузить файл в input type=file; ' +
    'viewport {width} — ширина превью в px (0 — адаптив) для проверки мобильной вёрстки; ' +
    'a11y {selector?} returns a DOM-derived role/name snapshot; it can differ from the browser accessibility tree. ' +
    'accessibility {selector} in Chromium returns the selected node from the native browser accessibility tree: role, name, description, states, name sources and related selectors. It does not interact, return control values or support frame scope. Read limits; a single-node observation is not a screen-reader scenario test. ' +
    'In both Web Reader engines, audit {group?, selector?, rules?, mode?, limit?, offset?} reports bounded QA findings with selectors and evidence. ' +
    'probe {selector} observes one standard CSS target, including hidden controls: visibility, disabled/read-only/inert state, sampled pointer blockers and source selectors. It never clicks, focuses or scrolls. Pointer reachability does not guarantee successful activation; inspect all state and limitations. ' +
    'Use mode:list to discover checks, then mode:run (default); follow nextOffset and read limitations. Default group: markup. ' +
    'Heuristic findings need visual confirmation; no findings never proves the whole application bug-free. ' +
    'Тестовое окружение, запущенное на машине этого разговора (dev-сервер репозитория, feature-preview), открывай ' +
    'Текущее приложение открывай по https://app.internal/ (путь и #/маршрут сохраняются); вход выполняется внутри страницы. Dev-сервер машины — ' +
    'адресом http://machine.internal:<порт>/ — прокси доставит запрос на 127.0.0.1:<порт> машины разговора; ' +
    'типовой цикл: поправь код в репозитории машины, запусти или перезапусти dev-сервер, открой machine.internal и проверь фичу. ' +
    'Тестовые учётные записи проекта для входа в окружение возвращает инструмент test-users — логинься ими через type/click.' +
    (surface === 'chromium'
      ? ' Dev-сервер никто не поднимет за тебя: запусти его на машине в фоне через mcp__remote__bash (nohup … &), ' +
        'дождись порта и только потом открывай http://machine.internal:<порт>/. ' +
        'Убедиться, что фича работает, — обязательная часть шага: открой затронутый экран, пройди по нему, ' +
        'проверь errors и приложи screenshot к отчёту о работе.'
      : '')
  )
}
