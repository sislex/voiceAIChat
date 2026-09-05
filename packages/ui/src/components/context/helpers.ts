// Чистые помощники инспектора контекста: разбор адреса, поиск, подписи, отчёты
// и пороги. Вынесены из компонента — он вырос до полутора тысяч строк за
// двадцать кругов правок. Здесь нет ни состояния, ни JSX, поэтому всё это
// проверяется напрямую, без рендера экрана.
import type { ContextKbPreview, ContextSnapshotItem, ConversationContextSnapshot, UserRole } from '@shared/types'

/**
 * Срез снимка одной группой источников. Экспорт «всего снимка» в задачу или в
 * переписку часто спрашивают про один раздел («что в персонализации», «что за
 * инструкции»), а полный JSON/Markdown из тридцати источников с блоками промпта
 * читать некому — пропадает суть. Здесь снимок сужается: остаются только пункты
 * выбранной группы, блоки промпта с пересечением по `itemIds`, изменения по
 * этим же id и запрещённые инструменты, привязанные к пунктам группы. Поля,
 * которые описывают весь ход (`turnSizes`, `costUsd`, `turnTotal.history*`), в
 * срезе теряют смысл — стоимость и историю нельзя честно поделить между
 * группами, поэтому обнуляются, а не пересчитываются на глаз.
 */
export function filterSnapshotByGroup(snapshot: ConversationContextSnapshot, groupId: string): ConversationContextSnapshot {
  const group = snapshot.groups.find((entry) => entry.id === groupId)
  if (!group) return snapshot
  const itemIds = new Set(group.items.map((item) => item.id))
  const blocks = snapshot.promptPreview.blocks.filter((block) => block.itemIds.some((id) => itemIds.has(id)))
  const text = blocks.map((block) => block.text).join('\n\n')
  const approxTokens = blocks.reduce((sum, block) => sum + block.approxTokens, 0)
  return {
    ...snapshot,
    groups: [group],
    changes: snapshot.changes.filter((event) => itemIds.has(event.itemId)),
    disallowedTools: snapshot.disallowedTools.filter((tool) => itemIds.has(`mcp-remote-${tool}`) || itemIds.has(`mcp-${tool}`)),
    turnSizes: [],
    promptPreview: {
      ...snapshot.promptPreview,
      blocks,
      text,
      chars: text.length,
      approxTokens,
      costUsd: null,
      costByModel: [],
      turnTotal: { ...snapshot.promptPreview.turnTotal, chars: text.length, approxTokens, historyChars: 0, historyApproxTokens: 0 }
    }
  }
}

/**
 * Безопасный кусочек для имени файла экспорта: латиница, цифры, дефис. Русские
 * названия групп сохранять в имя не пробуем — часть браузеров и файловых
 * систем режет юникод в `download` до знака вопроса, и «context-Инструкции.md»
 * приезжает как «context-______.md».
 */
export function slugForFilename(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'group'
}

/** Статус пункта словами пользователя, а не полями снимка. */
export type UserStatus = 'Будет использовано' | 'Доступно при необходимости' | 'Не настроено' | 'Недоступно' | 'Определится после отправки' | 'Выключено вами' | 'Выключено в настройках'

export const dynamicIds = new Set(['current-message', 'knowledge-mode'])

// Основной список источников. Пункт снимка, которого здесь нет и который не
// подходит под маски дополнительных (`skill-*`, `mcp-*`, `instruction-*`), на
// экран не попадёт вовсе — так пропал «Контекст задачи», пока его сюда не
// добавили. Новый пункт сервера — сразу в этот набор или в маску.
export const primaryIds = new Set(['platform-instructions', 'application-instructions', 'personalization', 'project-binding', 'task-context', 'make-context', 'assistant-autonomy', 'knowledge-mode', 'conversation-history', 'current-message'])

export function userStatus(item: ContextSnapshotItem): UserStatus {
  if (item.toggleable && !item.enabled) return 'Выключено вами'
  // Инструкция, выключенная в общих настройках, раньше выглядела как «Не
  // настроено» — а это разные вещи: она есть, но отключена во всех чатах.
  if (item.id.startsWith('instruction-') && !item.configured) return 'Выключено в настройках'
  if (dynamicIds.has(item.id) || item.id.startsWith('skill-')) return 'Определится после отправки'
  if (item.includedInNextTurn) return 'Будет использовано'
  if (!item.configured) return 'Не настроено'
  if (!item.available) return 'Недоступно'
  return 'Доступно при необходимости'
}

export function sourceLabel(source: string): string {
  if (source === 'Разговор' || source === 'Настройки разговора') return 'Переопределение чата'
  if (source === 'Проект') return 'Настройки проекта'
  if (source === 'Настройки пользователя') return 'Общие настройки'
  if (source === 'Эффективная политика сервера' || source === 'Резолвер сервера') return 'Автоматически'
  return source
}

export function reasonFor(item: ContextSnapshotItem): string {
  if (item.toggleable && !item.enabled) return 'Вы выключили источник для этого разговора — в промпт он не попадёт.'
  if (item.id === 'current-message') return 'Текст станет известен после отправки сообщения.'
  if (item.id === 'knowledge-mode' && item.configured) return 'Подходящие документы выбираются по тексту отправляемого сообщения.'
  if (item.id.startsWith('skill-')) return item.configured ? 'Навык выбран, но активируется только при подходящем сообщении.' : 'Навык доступен и может быть выбран для разговора.'
  return item.explanation || (item.includedInNextTurn ? 'Сервер включил источник в следующий ход.' : !item.configured ? 'Источник не настроен.' : !item.available ? 'Источник сейчас недоступен.' : 'Источник доступен модели по необходимости.')
}

/** «≈120 токенов · 480 символов» — вклад пункта в промпт; null — вклада нет. */
/**
 * С какой доли постоянной части пункт называется тяжёлым. Пятая часть — та
 * граница, за которой выключение одного источника заметно меняет и объём, и
 * счёт; ниже это шум на фоне остальных десяти пунктов.
 */
export const HEAVY_ITEM_SHARE = 0.2

/** Разделы, которыми управляет «раскрыть/свернуть все» и память раскрытия. */
export const SECTION_IDS = ['instructions', 'excluded', 'extra', 'presets', 'changes', 'technical'] as const

/** Ключ раскрытых разделов инспектора в localStorage. */
export const OPEN_SECTIONS_KEY = 'vc.context.sections'

export function sizeLabel(item: ContextSnapshotItem): string | null {
  if (!item.size || item.size.chars === 0) return null
  return `≈${item.size.approxTokens} токенов · ${item.size.chars} символов`
}

/**
 * id источника из адреса вкладки. Хеш передаётся аргументом (по умолчанию —
 * текущий): так функция остаётся чистой и проверяется без окна браузера.
 */
export function detailIdFromHash(conversationId: string, hash = typeof window === 'undefined' ? '' : window.location.hash): string | null {
  const prefix = `#/chat/${encodeURIComponent(conversationId)}/context/`
  return hash.startsWith(prefix) ? decodeURIComponent(hash.slice(prefix.length).split(/[/?]/)[0] ?? '') : null
}

/**
 * Совпадение пункта с поисковой строкой: заголовок, описание, id, тип — и текст
 * блока, который этот пункт добавляет в промпт. Последнее важнее остального:
 * вопрос звучит как «почему модель знает про отпуск», а слово «отпуск» стоит
 * не в названии источника, а внутри персонализации или инструкции.
 */
export function matchesQuery(item: ContextSnapshotItem, query: string, blockText = ''): boolean {
  if (!query.trim()) return true
  const needle = query.trim().toLowerCase()
  return [item.title, item.description, item.id, item.type, item.explanation, blockText].some((field) => field.toLowerCase().includes(needle))
}

/**
 * Разбивает текст на куски вокруг совпадений, чтобы подсветить найденное.
 * Возвращает пары «текст, совпадение ли» — рисование остаётся за компонентом.
 *
 * Число подсветок ограничено: на короткой подстроке вроде «ии» в семитысячном
 * тексте инструкции их выходит две с лишним тысячи (проверено в браузере), и
 * это столько же узлов DOM на каждый ввод символа. Дальше лимита текст идёт
 * целым куском — сама выдача остаётся полной, подсвечено только начало.
 */
export const HIGHLIGHT_LIMIT = 200

export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  const lower = text.toLowerCase()
  let from = 0
  let hits = 0
  while (hits < HIGHLIGHT_LIMIT) {
    const at = lower.indexOf(needle, from)
    if (at === -1) break
    if (at > from) parts.push({ text: text.slice(from, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
    hits += 1
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false })
  return parts
}

/**
 * Почему автоконтекста не будет. Причину считает подборщик (`emptyReason`), и
 * они разные по смыслу: «ничего не нашлось» и «нашлось, но уверенность низкая» —
 * это разные ответы на вопрос «а почему модель не получит документы».
 */
export function kbEmptyText(preview: ContextKbPreview): string {
  if (preview.mode !== 'auto') return 'Режим базы знаний — не «Авто»: автоматический контекст не добавляется, но модель может искать сама инструментами.'
  switch (preview.emptyReason) {
    case 'kb-unavailable': return 'База знаний сейчас недоступна — автоматический контекст не добавится.'
    case 'empty-query': return 'Введите черновик сообщения: подбор считается по его тексту.'
    case 'low-confidence': return 'Подходящие разделы нашлись, но уверенность подбора низкая — автоматически они не добавятся. Модель сможет запросить их инструментами базы знаний.'
    case 'budget': return 'Найденные разделы не поместились в бюджет автоконтекста — они не добавятся.'
    default: return 'Для такого сообщения подходящих разделов не нашлось — автоматический контекст не добавится.'
  }
}

/**
 * Текст файла. `Blob.text()` есть в браузерах, но не в jsdom (тесты пакета
 * идут на нём), поэтому при его отсутствии читаем `FileReader` — он есть везде.
 */
export function readTextFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'))
    reader.readAsText(file)
  })
}

/** Одна строка о контексте: движок, размер, стоимость и что выключено. */
export function summaryLine(value: ConversationContextSnapshot): string {
  const disabled = value.groups.flatMap((group) => group.items).filter((item) => item.toggleable && !item.enabled)
  const cost = value.promptPreview.costUsd === null ? '' : `, ≈$${value.promptPreview.costUsd.toFixed(4)} за ход`
  return [
    `Контекст ${value.conversationId}: ${value.summary.provider} · ${value.summary.model || 'модель из конфигурации CLI'}`,
    `постоянная часть ≈${value.promptPreview.approxTokens} токенов в ${value.promptPreview.blocks.length} блок(ах)${cost}`,
    // Итог хода — та цифра, ради которой сводку и копируют в задачу: без неё
    // «постоянная часть ≈600» выглядит маленькой в чате, где история весит втрое больше.
    value.promptPreview.turnTotal.resumed
      ? `ход продолжает сессию движка, история заново не передаётся`
      : `всего в ход ≈${value.promptPreview.turnTotal.approxTokens} токенов, история ≈${value.promptPreview.turnTotal.historyApproxTokens}`,
    `режим доступа: ${value.summary.permissionMode.displayName}; база знаний: ${value.summary.kbMode.displayName}`,
    disabled.length ? `выключено: ${disabled.map((item) => item.title).join(', ')}` : 'выключенных источников нет'
  ].join('; ')
}

export function roleHint(role: UserRole): string {
  return role === 'admin'
    ? 'Вы администратор: видны все сведения снимка и доступны любые настройки разговора.'
    : 'Доступны просмотр всего контекста и правка того, что не связано с безопасностью и другими людьми.'
}
