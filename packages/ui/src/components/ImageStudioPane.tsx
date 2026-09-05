// Студия картинок: правая панель чата вида images — галерея разговора.
// Ассистент рисует в чате (его картинки сервер сам складывает сюда), панель
// добавляет прямые действия: загрузить свои (кнопкой или перетаскиванием),
// сгенерировать по промпту, поправить выбранную по промпту, переименовать,
// удалить, скачать, скопировать в буфер и рассмотреть в полный размер.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { ImageStudioFile } from '@shared/imageStudio'
import { IMAGE_STUDIO_LIMITS, imageStudioMime, isImageStudioPath } from '@shared/imageStudio'
import { Button, Dialog, EmptyState, ErrorState, IconButton, Skeleton, useConfirm, useToast } from '@voicechat/ui-kit'
import { usePolling } from '../lib/usePolling'
import { MOBILE_QUERY, useMediaQuery } from '../lib/mediaQuery'
import { useCommandSource } from '../lib/useCommands'
import { useHashRoute } from '../lib/useHashRoute'
import { copyImage } from '../lib/clipboard'
import { buildZip } from '../lib/zipStore'
import { applyImageTransform, captionImage, cropImage, IMAGE_TRANSFORMS, transformName, type ImageTransformKind } from '../lib/imageTransform'
import { annotateImage } from '../lib/imageAnnotate'
import { extractPalette } from '../lib/imagePalette'
import { channelHistogramsOf, histogramOf } from '../lib/imageTone'
import { buildCollage } from '../lib/imageCollage'
import { decodeStudioView, encodeStudioView, isEmptyView, pixelsOf, shapeOf, viewSummary, type StudioView } from '../lib/imageViews'
import { getCachedPreview, putCachedPreview } from '../lib/previewCache'
import { playStopCue } from '../lib/cues'
import { ImageStudioViewer } from './ImageStudioViewer'
import { ImageStudioToolsRow } from './ImageStudioToolsRow'
import { ImageStudioBatchBar, type BatchActions } from './ImageStudioBatchBar'
import { ImageStudioShareBar } from './ImageStudioShareBar'
import { ImageStudioFilters } from './ImageStudioFilters'
import { ImageStudioActions } from './ImageStudioActions'
import { ImageStudioDialogs } from './ImageStudioDialogs'
import { gridWindow, groupDuplicates, inventoryMarkdown, mapWithLimit } from '../lib/imageInventory'
import { versionFamily } from '../lib/imageVersions'
import { averageColor, BIG_FILE_BYTES, colorDistance, colorHue, DOWNSCALE_SIDE, DOWNSCALE_TARGET, promptTemplateFill, promptTemplateVars, rangeBetween, safeUploadName, shouldDownscale } from '../lib/imageIntake'
import { approxColorCount, extensionMismatch, hasAlphaPixels, notesMarkdown, sniffImageType, versionTree } from '../lib/imageFacts'
import { IMAGE_STUDIO_COMPOSER_KEY, IMAGE_STUDIO_PAGE_KEY, IMAGE_STUDIO_DENSE_KEY, IMAGE_STUDIO_FILTERS_KEY, IMAGE_STUDIO_FIT_KEY, IMAGE_STUDIO_GRID_BG_KEY, IMAGE_STUDIO_NEGATIVE_KEY, IMAGE_STUDIO_NEGATIVE_OPEN_KEY, IMAGE_STUDIO_NO_TEXT_KEY, IMAGE_STUDIO_ORDER_KEY, IMAGE_STUDIO_SIZE_KEY, IMAGE_STUDIO_STYLE_KEY, imageStudioDraftKey, imageStudioNegativeKey, imageStudioNotesKey, imageStudioPinnedKey, imageStudioPromptsKey, imageStudioScrollKey, imageStudioSeenKey, imageStudioSetsKey, imageStudioSizeKey, imageStudioStarsKey, imageStudioFoldedKey, imageStudioRecipesKey, imageStudioStatusKey, imageStudioTemplatesKey, imageStudioStyleKey, imageStudioViewsKey } from '../store/contracts'

type StudioApi = Pick<RendererApi,
  'imgstudio:list' | 'imgstudio:read' | 'imgstudio:upload' | 'imgstudio:delete' |
  'imgstudio:rename' | 'imgstudio:generate' | 'imgstudio:edit' | 'imgstudio:cancel' |
  'imgstudio:publish' | 'imgstudio:publication' | 'imgstudio:unpublish' | 'imgstudio:run' | 'imgstudio:transfer' |
  'imgstudio:trash' | 'imgstudio:restore' | 'imgstudio:purge'> &
  Partial<Pick<RendererApi, 'prompt:suggest'>>

interface Props {
  conversationId: string
  api: StudioApi
  /** Ход ассистента идёт — после него в галерее могут появиться картинки. */
  turnActive?: boolean
  /** Прикрепить файл к следующему сообщению чата слева (композер). */
  onAttachToChat?: (file: File) => void
  /** Другие студийные чаты пользователя — цели переноса/копии картинок. */
  otherChats?: Array<{ id: string; title: string }>
}

/** Пресеты стиля: пустой — модель решает сама. */
const STYLE_PRESETS = ['', 'акварель', 'флэт-иллюстрация', 'пиксель-арт', 'скетч карандашом', 'фотореализм'] as const

/** Пресеты размера: пустой — модель решает сама. */
const SIZE_PRESETS = ['', '512×512', '1024×1024', '1920×1080', '1200×630', '1080×1080', '1280×720', '1080×1350', '1500×500'] as const
/** Сколько последних промптов помним на разговор. */
const RECENT_LIMIT = 4
/** Фильтр по имени появляется, когда глазами искать уже неудобно. */
const FILTER_THRESHOLD = 7
/** Сколько карточек рендерим сразу; дальше — «Показать ещё». */
const PAGE_SIZE = 60
/** Одновременных чтений превью: больше — браузер ставит запросы в очередь сам. */
const PREVIEW_CONCURRENCY = 6
/**
 * От этого числа карточек сетка рисует только видимое окно. Ниже порога
 * виртуализация лишняя: DOM и так небольшой, а лишние измерения только
 * усложняют поведение.
 */
const VIRTUAL_THRESHOLD = 80
/** Частое «чего не должно быть»: печатать это каждый раз — лишняя работа. */
const NEGATIVE_PRESETS = ['текст и надписи', 'люди', 'водяные знаки', 'рамка и поля'] as const

/** Примеры для пустой галереи: первый промпт проще подсмотреть, чем придумать. */
const PROMPT_EXAMPLES = [
  'Логотип-щит с молнией, плоский стиль, два цвета',
  'Акварельный пейзаж: горы на рассвете',
  'Иконка папки с фотографиями, минимализм'
] as const

/**
 * Короткая метка пропорций: «1:1», «16:9», «OG». По ней видно, годится ли
 * картинка для поста или превью ссылки, не считая делением в голове.
 */
/**
 * Сколько обычно занимает рисование в этом чате — медиана прошлых замеров
 * (`tookMs` пишет сервер). Медиана, а не среднее: одна зависшая генерация на
 * две минуты сдвинула бы среднее так, что оценка перестала бы помогать.
 * null — замеров ещё нет, обещать нечего.
 */
export function usualSeconds(files: Array<{ tookMs?: number }>): number | null {
  const times = files.map((file) => file.tookMs).filter((value): value is number => typeof value === 'number' && value > 0).sort((a, b) => a - b)
  if (!times.length) return null
  const middle = Math.floor(times.length / 2)
  const median = times.length % 2 ? times[middle]! : (times[middle - 1]! + times[middle]!) / 2
  return Math.max(1, Math.round(median / 1000))
}

/**
 * «Сколько прошло» человеческими словами. Абсолютную дату видно в тултипе, но
 * ответ на вопрос «это свежее или прошлогоднее» из неё приходится вычислять
 * в голове.
 */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'только что'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} дн назад`
  const months = Math.round(days / 30)
  return months < 12 ? `${months} мес назад` : `${Math.round(months / 12)} г назад`
}

export function aspectLabel(dimensions: string): string {
  const [width, height] = dimensions.split('×').map((part) => Number.parseInt(part, 10))
  if (!width || !height) return ''
  if (width === 1200 && height === 630) return 'OG'
  const ratio = width / height
  const near = (target: number): boolean => Math.abs(ratio - target) < 0.02
  if (near(1)) return '1:1'
  if (near(16 / 9)) return '16:9'
  if (near(4 / 3)) return '4:3'
  if (near(9 / 16)) return '9:16'
  if (near(1200 / 630)) return 'OG'
  return ''
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',').replace(',0', '')} МБ`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${bytes} Б`
}

function loadRecent(conversationId: string): string[] {
  try {
    const raw = localStorage.getItem(imageStudioPromptsKey(conversationId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Автоимя из промпта: первые три слова, безопасные для имени файла. */
function nameFromPrompt(prompt: string): string {
  const words = prompt.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').split(/\s+/).filter(Boolean).slice(0, 3)
  return words.length ? `${words.join('-').slice(0, 48)}.png` : ''
}

/** Свободное имя копии: «кот.png» → «кот-копия.png», дальше с номером. */
function copyName(path: string, taken: Set<string>): string {
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  let candidate = `${stem}-копия${ext}`
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${stem}-копия-${index}${ext}`
  return candidate
}

/**
 * Что не так с новым именем файла. Сервер те же правила проверяет сам, но
 * узнавать об ошибке после запроса — значит терять набранное: поле закрывается,
 * и имя приходится вводить заново.
 */
export function renameError(name: string, taken: Set<string>): string | null {
  const value = name.trim()
  if (!value) return 'Имя не может быть пустым'
  if (value.startsWith('.')) return 'Имя не может начинаться с точки'
  if (/[/\\\0]/.test(value)) return 'В имени нельзя использовать / \\ и служебные символы'
  if (value.length > 120) return `Слишком длинное имя: ${value.length} символов из 120`
  if (taken.has(value)) return `«${value}» уже есть в галерее`
  return null
}

/**
 * Группы «Сегодня / Вчера / Раньше» по дате обновления. Нужны, когда за день
 * набегает несколько десятков картинок и глазами уже не видно, где кончается
 * сегодняшняя работа.
 */
export function groupByDay(files: ImageStudioFile[], now = Date.now()): Array<{ title: string; files: ImageStudioFile[] }> {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const today = startOfDay.getTime()
  const yesterday = today - 24 * 3600 * 1000
  const buckets: Array<{ title: string; files: ImageStudioFile[] }> = [
    { title: 'Сегодня', files: [] },
    { title: 'Вчера', files: [] },
    { title: 'Раньше', files: [] }
  ]
  for (const file of files) {
    const bucket = file.updatedAt >= today ? buckets[0]! : file.updatedAt >= yesterday ? buckets[1]! : buckets[2]!
    bucket.files.push(file)
  }
  return buckets.filter((bucket) => bucket.files.length > 0)
}

/**
 * Совпадение запроса с текстами файла: **все слова запроса** должны найтись
 * хоть где-то (имя, промпт, заметка). Подстрока целиком не годилась — «кит
 * закат» не находило картинку, у которой эти слова стоят в промпте порознь.
 */
export function matchesQuery(query: string, haystacks: Array<string | undefined>): boolean {
  const terms = queryTerms(query)
  if (!terms.length) return true
  const text = haystacks.filter(Boolean).join(' ').toLowerCase()
  return terms.every((term) => text.includes(term.text) !== term.negated)
}

/**
 * Разбор запроса: слова через И, «в кавычках» — точная фраза, «-слово» —
 * исключение. Без кавычек «кот в шляпе» ищет три слова где угодно, и файл с
 * «кот» и «шляпа» в разных концах промпта считался найденным; без минуса
 * отсеять «-копия» из выдачи было нечем.
 */
export function queryTerms(query: string): Array<{ text: string; negated: boolean }> {
  const terms: Array<{ text: string; negated: boolean }> = []
  // Кусок — либо «фраза в кавычках», либо слово без пробелов; минус перед ним
  // означает исключение.
  for (const match of query.toLowerCase().matchAll(/(-?)(?:"([^"]*)"|(\S+))/g)) {
    const text = (match[2] ?? match[3] ?? '').trim()
    if (text) terms.push({ text, negated: match[1] === '-' })
  }
  return terms
}

/**
 * Разбивает строку на куски с отметкой совпадения — по ним имя подсвечивается
 * в карточке. Без подсветки при поиске по промпту непонятно, почему файл нашёлся.
 */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  // Подсвечиваем только то, что искали: исключения («-копия») в имени
  // отмечать нечего, они наоборот означают «этого тут нет».
  const words = [...new Set(queryTerms(query).filter((term) => !term.negated).map((term) => term.text))]
  if (!words.length) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  // Отмечаем занятые позиции, затем склеиваем соседние в куски: так пересечения
  // слов («кот» и «коте») не рвут строку на отдельные буквы.
  const marks = new Array<boolean>(text.length).fill(false)
  for (const word of words) {
    let from = lower.indexOf(word)
    while (from >= 0) {
      for (let index = from; index < from + word.length; index += 1) marks[index] = true
      from = lower.indexOf(word, from + word.length)
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = []
  for (let index = 0; index < text.length; index += 1) {
    const hit = marks[index]!
    const last = parts[parts.length - 1]
    if (last && last.hit === hit) last.text += text[index]!
    else parts.push({ text: text[index]!, hit })
  }
  return parts
}

/** Свободное имя вида «коллаж.png» → «коллаж-2.png»: занято — со номером. */
function freeName(base: string, ext: string, taken: Set<string>): string {
  let candidate = `${base}.${ext}`
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${base}-${index}.${ext}`
  return candidate
}

/**
 * План пакетного переименования: `{n}` в шаблоне — номер по порядку; шаблон без
 * него получает `-{n}` в конце, иначе все файлы получили бы одно имя.
 * Расширение берётся у исходника — шаблон описывает имя, а не формат.
 */
export function renamePlan(template: string, paths: string[]): Array<{ from: string; to: string }> {
  const pattern = template.includes('{n}') ? template : `${template}-{n}`
  return paths.map((path, index) => {
    const dot = path.lastIndexOf('.')
    const ext = dot > 0 ? path.slice(dot) : ''
    return { from: path, to: `${pattern.replace(/\{n\}/g, String(index + 1))}${ext}` }
  })
}

export function ImageStudioPane({ conversationId, api, turnActive, onAttachToChat, otherChats }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  /**
   * На телефоне восемь иконок в строке карточки не влезают и жмутся в
   * нечитаемую ленту, поэтому там их заменяет одна кнопка «⋯» с тем же
   * контекстным меню. Это разная разметка, а не разные стили, — значит
   * `useMediaQuery`, а не CSS.
   */
  const phone = useMediaQuery(MOBILE_QUERY)
  // Адрес открытой картинки: «#/images/<чат>/<файл>». Третий сегмент App не
  // разбирает (чат он берёт вторым), поэтому лайтбокс может жить в ссылке —
  // «посмотри вот эту» перестало требовать пересылки файла.
  const { path: routePath, segments, navigate } = useHashRoute()
  const inThisStudio = segments[0] === 'images' && segments[1] === conversationId
  /**
   * Ссылка на отбор: «#/images/<чат>/view/<условия>». Отдельный сегмент
   * `view` вместо строки запроса — hash-роутер режет путь по «/», и «?…»
   * прилип бы к идентификатору чата.
   */
  const routeView = inThisStudio && segments[2] === 'view' ? decodeURIComponent(segments[3] ?? '') : null
  const routeFile = inThisStudio && segments[2] && segments[2] !== 'view'
    ? decodeURIComponent(segments[2])
    : null
  const [files, setFiles] = useState<ImageStudioFile[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(() => {
    try { return localStorage.getItem(imageStudioDraftKey(conversationId)) ?? '' } catch { return '' }
  })
  /** «Без текста на картинке»: модели любят вписывать надписи — глушим явно. */
  const [noText, setNoText] = useState<boolean>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_NO_TEXT_KEY) === '1' } catch { return false }
  })
  const [size, setSize] = useState<string>(() => {
    try {
      // Сначала пресет этого разговора, затем последний выбранный глобально:
      // новый чат наследует привычку, старый — свою настройку.
      const saved = localStorage.getItem(imageStudioSizeKey(conversationId)) ?? localStorage.getItem(IMAGE_STUDIO_SIZE_KEY) ?? ''
      return (SIZE_PRESETS as readonly string[]).includes(saved) ? saved : ''
    } catch { return '' }
  })
  const [busy, setBusy] = useState(false)
  /** Пока модель рисует/правит — что именно и сколько секунд уже идёт. */
  const [progress, setProgress] = useState<{ label: string; seconds: number } | null>(null)
  /** Последняя ошибка операции — баннером в панели, тост живёт только момент. */
  const [lastError, setLastError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  /**
   * Журнал операций панели: что делали, когда и что можно вернуть. Тосты с
   * «Вернуть» живут секунды, и через минуту вопрос «а что я вообще нажал»
   * оставался без ответа. Держим двадцать последних — дальше это уже история,
   * а не «только что».
   */
  const [journal, setJournal] = useState<Array<{ id: number; at: number; text: string; undo?: () => void }>>([])
  const [journalOpen, setJournalOpen] = useState(false)
  /** Панель рисования раскрыта: свернув её, галерею разбирают на целом экране. */
  const [composerOpen, setComposerOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_COMPOSER_KEY) !== '0' } catch { return true }
  })
  /** Последняя пакетная обработка: её повторяет кнопка «Ещё раз». */
  const [lastTransform, setLastTransform] = useState<ImageTransformKind | null>(null)
  /** Только за последние сутки: «что мы сегодня наделали» без групп по датам. */
  const [dayOnly, setDayOnly] = useState(false)
  /** Карточка, которую сейчас подсвечиваем (после автопрокрутки к ней). */
  const [flash, setFlash] = useState<string | null>(null)
  /** Режим печати: на время печати прячем всё, кроме сетки. */
  const [printMode, setPrintMode] = useState(false)
  const journalId = useRef(0)
  const remember = (text: string, undo?: () => void): void => {
    journalId.current += 1
    const entry = { id: journalId.current, at: Date.now(), text, ...(undo ? { undo } : {}) }
    setJournal((prev) => [entry, ...prev].slice(0, 20))
  }
  /** Переименование набора: имя из чипа правится на месте. */
  const [setRename, setSetRename] = useState<{ from: string; to: string } | null>(null)
  /** Подпись «на всех» из строки пакетных действий. */
  const [batchCaption, setBatchCaption] = useState('')
  /** Карточка с раскрытой строкой инструментов обработки (canvas, без модели). */
  const [toolsFor, setToolsFor] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  /** Корзина: содержимое подгружается при раскрытии. */
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<Array<{ name: string; deletedAt: number; size?: number }>>([])
  /** Сколько лежит в корзине — видно до раскрытия, иначе о ней забывают. */
  const [trashCount, setTrashCount] = useState<number | null>(null)
  /** Пресет стиля — добавка к промпту, как размер. */
  const [style, setStyle] = useState<string>(() => {
    try { return localStorage.getItem(imageStudioStyleKey(conversationId)) ?? localStorage.getItem(IMAGE_STUDIO_STYLE_KEY) ?? '' } catch { return '' }
  })
  /** Режим множественного выбора: чекбоксы вместо выбора-для-правки. */
  const [multi, setMulti] = useState<Set<string> | null>(null)
  const [compare, setCompare] = useState(false)
  /** Пара «сравнить выбранные» из мультирежима (второй файл шторки). */
  const [compareWith, setCompareWith] = useState<string | null>(null)
  /** Набор для сравнения сеткой (три и более выбранных). */
  const [compareGrid, setCompareGrid] = useState<string[] | null>(null)
  /**
   * Размер страницы сетки. Шестьдесят подходит большинству, но у кого-то
   * галерея на четыреста кадров и мощная машина — им проще один раз выбрать
   * «300», чем жать «Показать ещё» семь раз.
   */
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(IMAGE_STUDIO_PAGE_KEY) ?? '')
      return saved === 60 || saved === 120 || saved === 300 ? saved : PAGE_SIZE
    } catch { return PAGE_SIZE }
  })
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  /** Последний неудавшийся запуск — для кнопки «Повторить» в баннере. */
  const [lastAttempt, setLastAttempt] = useState<(() => void) | null>(null)
  /** Только что созданный файл: баннер с отменой (файл уедет в корзину). */
  const [lastCreated, setLastCreated] = useState<string | null>(null)
  /** Публичная ссылка галереи (null — не опубликована, undefined — грузится). */
  const [shareUrl, setShareUrl] = useState<string | null | undefined>(undefined)
  const [shareViews, setShareViews] = useState<number | null>(null)
  const [shareViews7, setShareViews7] = useState<number | null>(null)
  const [shareProtected, setShareProtected] = useState(false)
  /** Открыт диалог пароля публикации; поле — новый пароль зрителей (не логин). */
  const [passwordDialog, setPasswordDialog] = useState(false)
  /** Шпаргалка клавиш панели: клавиш стало много, и о них надо где-то сказать. */
  const [keysOpen, setKeysOpen] = useState(false)
  /**
   * Сохранённые виды: имя → снимок условий отбора и порядка. Семь фильтров и
   * пять сортировок дают слишком много комбинаций, чтобы набирать нужную
   * заново каждый раз («только готовые из набора «обложки», по размеру»).
   */
  const [views, setViews] = useState<Record<string, StudioView>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioViewsKey(conversationId)) ?? '{}')
      return parsed && typeof parsed === 'object' ? parsed as Record<string, StudioView> : {}
    } catch { return {} }
  })
  const [viewsOpen, setViewsOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  /**
   * Показать карточку по клавише. Узла может не быть в DOM: при включённом
   * окне виртуализации нарисованы только видимые строки, и `scrollIntoView`
   * прокручивать нечему — выбор уезжал за экран, а сетка стояла на месте
   * (поймано в браузере на галерее из 120 файлов). Тогда считаем позицию
   * строки сами и повторяем попытку в следующем кадре, когда окно перерисуется.
   */
  const revealCard = (path: string, index: number): void => {
    // Мигание сообщает «вот она»: на экране десяток похожих превью, и одной
    // прокрутки мало, чтобы понять, куда именно привели.
    setFlash(path)
    setTimeout(() => setFlash((prev) => prev === path ? null : prev), 2500)
    // Карточка может лежать за «Показать ещё» — доращиваем страницу, иначе её
    // нет ни в DOM, ни в расчёте окна (так новый файл при сортировке «по
    // имени» оставался за пределами страницы, и прокрутка вела в её конец).
    setVisibleCount((prev) => index >= prev ? index + PAGE_SIZE : prev)
    const focusCard = (): boolean => {
      const card = document.querySelector(`[data-path="${CSS.escape(path)}"]`)
      if (!card) return false
      card.scrollIntoView?.({ block: 'nearest' })
      ;(card.querySelector('.image-studio-thumb') as HTMLElement | null)?.focus?.()
      return true
    }
    setTimeout(() => {
      if (focusCard()) return
      const pane = paneRef.current
      if (!pane || metrics.rowHeight <= 0) return
      const row = Math.floor(index / Math.max(1, metrics.columns))
      const base = gridRef.current?.offsetTop ?? 0
      pane.scrollTop = Math.max(0, base + row * metrics.rowHeight - pane.clientHeight / 2)
      // Своей прокрутке событие `scroll` доверять нельзя (в неактивной вкладке
      // его не присылают вовсе), поэтому окно пересчитываем сразу сами.
      syncViewport()
      setTimeout(focusCard, 32)
    }, 0)
  }
  /**
   * Свёрнутые группы «по датам»: у длинной истории нужен только верх. Живут в
   * sessionStorage — между запусками браузера состояние сворачивания не нужно,
   * а внутри сеанса переключение чатов не должно его терять.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw: unknown = JSON.parse(sessionStorage.getItem(imageStudioFoldedKey(conversationId)) ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [])
    } catch { return new Set() }
  })
  const foldGroups = (next: Set<string>): void => {
    setCollapsedGroups(next)
    try { sessionStorage.setItem(imageStudioFoldedKey(conversationId), JSON.stringify([...next])) } catch { /* приватный режим */ }
  }
  /** Правка заметки одного файла: путь и черновик текста. */
  const [noteFor, setNoteFor] = useState<{ path: string; text: string } | null>(null)
  /** Диалог переноса пометок между браузерами (звёзды и заметки текстом). */
  const [marksOpen, setMarksOpen] = useState(false)
  const [marksDraft, setMarksDraft] = useState('')
  const [viewerPassword, setViewerPassword] = useState('')
  const [filter, setFilter] = useState('')
  /** Фильтр по расширению: пустой — все типы. */
  const [kindFilter, setKindFilter] = useState('')
  /** Фильтр по происхождению: модель, свои файлы или производные обработки. */
  const [originFilter, setOriginFilter] = useState<'' | 'ai' | 'own' | 'derived'>('')
  /** Фильтр по пометкам: с заметкой, черновики, готовые. */
  const [markFilter, setMarkFilter] = useState<'' | 'noted' | 'draft' | 'ready' | 'none'>('')
  /**
   * Ориентация: считается по подписи размеров, а та известна только для
   * загруженных превью. Поэтому файлы с неизвестным размером фильтр **не
   * скрывает** — иначе сетка пустела бы на каждой прокрутке, пока грузятся
   * картинки, и это читалось бы как «ничего не нашлось».
   */
  const [shapeFilter, setShapeFilter] = useState<'' | 'square' | 'portrait' | 'landscape'>('')
  /**
   * Пресеты запроса: имя → стиль, размер, негатив, «без текста». Настроить
   * четыре поля под «пост в соцсети» и потом под «обложку статьи» — это восемь
   * переключений на каждую смену задачи.
   */
  const [recipes, setRecipes] = useState<Record<string, { style: string; size: string; negative: string; noText: boolean }>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioRecipesKey(conversationId)) ?? '{}')
      return parsed && typeof parsed === 'object' ? parsed as Record<string, { style: string; size: string; negative: string; noText: boolean }> : {}
    } catch { return {} }
  })
  const [recipeName, setRecipeName] = useState('')
  /** Строка фильтров раскрыта (только телефон: на десктопе она видна всегда). */
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_FILTERS_KEY) === '1' } catch { return false }
  })
  /** Сетка сужена до выбранных: перед пакетным действием пачку проверяют глазами. */
  const [pickedOnly, setPickedOnly] = useState(false)
  /** Отбор по весу: «больше 1 МБ» и «больше 5 МБ» — с чего начинать чистку. */
  const [heavyFilter, setHeavyFilter] = useState<'' | '1' | '5'>('')
  /**
   * «Все версии этого файла»: путь-корень родни. Правки плодят параллельные
   * ветви, и найти их поиском по имени нельзя — имена расходятся уже на
   * втором шаге («кот-2», «кот-2-crop», «кот-3»).
   */
  const [familyOf, setFamilyOf] = useState<string | null>(null)
  /** Фильтр по набору: показывать только файлы выбранной подборки. */
  const [activeSet, setActiveSet] = useState('')
  /** Показывать только то, что появилось в этой сессии (бейдж «новое»). */
  const [freshOnly, setFreshOnly] = useState(false)
  /** Метка прошлого визита: всё, что новее, — «пропущенное». */
  const [seenAt] = useState<number>(() => {
    try { return Number(localStorage.getItem(imageStudioSeenKey(conversationId)) ?? '0') || 0 } catch { return 0 }
  })
  const [sinceVisitOnly, setSinceVisitOnly] = useState(false)
  /** Группировать сетку по дням («Сегодня», «Вчера», «Раньше»). */
  const [grouped, setGrouped] = useState(false)
  /**
   * Наборы: подборка файлов под именем. Нужны, когда над одной задачей идёт
   * работа несколько дней — выбор из двадцати картинок иначе собирают заново.
   */
  /**
   * Готовность картинки: черновик или готово. Отбор «что уже можно отдавать»
   * раньше держали в голове или в заметках — теперь это отдельная пометка.
   */
  const [statuses, setStatuses] = useState<Record<string, 'draft' | 'ready'>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioStatusKey(conversationId)) ?? '{}')
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, 'draft' | 'ready'> = {}
      for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === 'draft' || value === 'ready') out[name] = value
      }
      return out
    } catch { return {} }
  })
  const [sets, setSets] = useState<Record<string, string[]>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioSetsKey(conversationId)) ?? '{}')
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, string[]> = {}
      for (const [name, list] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(list)) out[name] = list.filter((item): item is string => typeof item === 'string')
      }
      return out
    } catch { return {} }
  })
  /** Шаблон пакетного переименования выбранных («кадр-{n}»). */
  const [renameTemplate, setRenameTemplate] = useState('')
  /** Последнее пакетное переименование — чтобы вернуть имена одним нажатием. */
  const [lastRename, setLastRename] = useState<Array<{ from: string; to: string }> | null>(null)
  /** Черновик заметки, которую ставим всем выбранным сразу. */
  const [batchNote, setBatchNote] = useState('')
  /** Имя, под которым сохраняем текущий выбор как набор. */
  const [setName, setSetName] = useState('')
  /** Что удалили пачкой — предложение вернуть из корзины одним нажатием. */
  const [lastDeleted, setLastDeleted] = useState<string[] | null>(null)
  /** Что создала последняя пакетная обработка — чтобы убрать результаты. */
  const [lastBatchCreated, setLastBatchCreated] = useState<string[] | null>(null)
  /** Сколько файлов в текущей пакетной операции; null — пакета нет. */
  const [batchTotal, setBatchTotal] = useState<number | null>(null)
  /** Сколько файлов пакета уже сделано — для полоски прогресса. */
  const [batchDone, setBatchDone] = useState<number | null>(null)
  /** Просьба прервать пакет: циклы смотрят на неё между файлами. */
  const abortBatch = useRef(false)
  /** Последний отмеченный чекбокс — начало диапазона для Shift+клика. */
  const lastPicked = useRef<string | null>(null)
  /** Избранные файлы (локально, на разговор) и режим «только избранные». */
  const [stars, setStars] = useState<Set<string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioStarsKey(conversationId)) ?? '[]')
      return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
    } catch { return new Set() }
  })
  const [starsOnly, setStarsOnly] = useState(false)
  /** Заметки к картинкам: зачем она нужна, помнит человек, а не имя файла. */
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioNotesKey(conversationId)) ?? '{}')
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
    } catch { return {} }
  })
  /** Обратный порядок: тот же критерий, но снизу вверх (Shift+клик по кнопке). */
  const [reversed, setReversed] = useState(false)
  const [order, setOrder] = useState<'new' | 'name' | 'size' | 'stars' | 'ready' | 'pixels' | 'noted' | 'tint'>(() => {
    try {
      const saved = localStorage.getItem(IMAGE_STUDIO_ORDER_KEY)
      return saved === 'name' || saved === 'size' || saved === 'stars' || saved === 'ready' || saved === 'pixels' || saved === 'noted' || saved === 'tint' ? saved : 'new'
    } catch { return 'new' }
  })
  /** Негативный промпт: перечисление того, чего на картинке быть не должно. */
  const [negative, setNegative] = useState<string>(() => {
    try { return localStorage.getItem(imageStudioNegativeKey(conversationId)) ?? localStorage.getItem(IMAGE_STUDIO_NEGATIVE_KEY) ?? '' } catch { return '' }
  })
  /** Контекстное меню карточки: путь файла и точка, где его открыли. */
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  /** Фон сетки: у прозрачных PNG края видно только на контрасте. */
  const [gridBg, setGridBg] = useState<'checker' | 'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(IMAGE_STUDIO_GRID_BG_KEY)
      return saved === 'light' || saved === 'dark' ? saved : 'checker'
    } catch { return 'checker' }
  })
  const [recent, setRecent] = useState<string[]>(() => loadRecent(conversationId))
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioPinnedKey(conversationId)) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch { return [] }
  })
  /** Имя нового файла (опционально) — иначе сервер назовёт «изображение.png». */
  const [fileName, setFileName] = useState('')
  /** Плотность сетки: крупные карточки для рассматривания, мелкие для обзора. */
  const [dense, setDense] = useState<boolean>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_DENSE_KEY) === '1' } catch { return false }
  })
  /**
   * Миниатюры по умолчанию обрезаны по квадрату: так сетка ровная. Но баннер
   * 1200×300 и портрет в такой карточке теряют половину кадра — переключатель
   * показывает картинку целиком, и выбор запоминается.
   */
  const [negativeOpen, setNegativeOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_NEGATIVE_OPEN_KEY) === '1' } catch { return false }
  })
  const [fit, setFit] = useState<boolean>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_FIT_KEY) === '1' } catch { return false }
  })
  const toggleFit = (): void => setFit((current) => {
    const next = !current
    try { localStorage.setItem(IMAGE_STUDIO_FIT_KEY, next ? '1' : '0') } catch { /* приватный режим */ }
    return next
  })
  /**
   * Палитра и гистограмма считаются по пикселям, поэтому листание туда-обратно
   * пересчитывало одно и то же. Кэш живёт в ref: он не влияет на разметку и
   * не должен вызывать перерисовку.
   */
  const toneCache = useRef<Map<string, { palette?: string[]; histogram?: number[] }>>(new Map())
  /** Пути файлов, появившихся без действий панели (ход ассистента), — бейдж «новое». */
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  /** Превью, которые не удалось прочитать: плитка с ретраем вместо вечного «…». */
  const [broken, setBroken] = useState<Set<string>>(new Set())
  /** Объявление для скринридера о завершении операции. */
  const [announce, setAnnounce] = useState('')
  const knownPaths = useRef<Set<string> | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  /** Сетка карточек: по ней считаем число колонок для навигации ↑/↓. */
  const gridRef = useRef<HTMLDivElement | null>(null)
  /** Поле поиска: на него уводит «/» — как в почте и в трекерах. */
  const filterRef = useRef<HTMLInputElement | null>(null)
  /** Корень панели: по нему запоминаем и возвращаем позицию прокрутки. */
  const paneRef = useRef<HTMLDivElement | null>(null)
  /** Позиция прокрутки уже восстановлена — второй раз не прыгаем. */
  const scrollRestored = useRef(false)
  /** Живые измерения прокрутки: по ним считается окно видимых карточек. */
  const [viewport, setViewport] = useState<{ top: number; height: number }>({ top: 0, height: 0 })
  /**
   * Синхронизация окна с живой прокруткой. Позицию читаем в кадре анимации, а
   * не прямо в событии: при быстрой прокрутке «броском» последнее событие до
   * состояния не доезжало, окно оставалось на прежних строках, и сетка
   * выглядела пустой до следующего щелчка колеса. В кадре `scrollTop` — тот,
   * что уже на экране.
   */
  const viewportFrame = useRef(0)
  const syncViewport = useCallback((): void => {
    const pane = paneRef.current
    if (!pane) return
    const top = pane.scrollTop
    const height = pane.clientHeight
    setViewport((prev) => Math.abs(prev.top - top) < 8 && prev.height === height ? prev : { top, height })
  }, [])
  const scheduleViewport = useCallback((): void => {
    if (typeof requestAnimationFrame !== 'function') { syncViewport(); return }
    if (viewportFrame.current) return
    viewportFrame.current = requestAnimationFrame(() => { viewportFrame.current = 0; syncViewport() })
  }, [syncViewport])
  useEffect(() => () => { if (viewportFrame.current) cancelAnimationFrame(viewportFrame.current) }, [])
  /** Геометрия сетки: колонок и высота строки — из самой сетки, не из констант. */
  const [metrics, setMetrics] = useState<{ columns: number; rowHeight: number }>({ columns: 1, rowHeight: 0 })
  // Сверка после перерисовки: если событие прокрутки потерялось или страница
  // выросла (доехали до «Показать ещё», сменилась геометрия), окно осталось бы
  // на прежних строках, а экран — пустым. Сверка идемпотентна: при совпадении
  // позиции состояние не меняется, поэтому цикла нет. Стоит выше ранних
  // возвратов рендера — иначе на первом кадре хук не вызывался бы вовсе.
  useEffect(() => { syncViewport() }, [visibleCount, metrics.columns, metrics.rowHeight, viewport.top, syncViewport])
  /**
   * Объявление о размере выбора. Строка «Выбрано N из M» — `role="status"`,
   * но она перерисовывается на каждый клик, и читалка её проглатывает;
   * отдельное объявление приходит с задержкой, когда выбор устоялся.
   */
  const multiSize = multi?.size ?? null
  useEffect(() => {
    if (multiSize === null) return
    const timer = setTimeout(() => setAnnounce(multiSize ? `Выбрано файлов: ${multiSize}` : 'Выбор пуст'), 400)
    return () => clearTimeout(timer)
  }, [multiSize])
  /**
   * Средние цвета файлов: по ним работают «похожие по цвету» и порядок «по
   * цвету». Считаются лениво — по кнопке или при включении сортировки, и
   * только по уменьшенной копии превью.
   */
  const [tints, setTints] = useState<Record<string, { r: number; g: number; b: number }>>({})
  /** Сколько кадров осталось посчитать для порядка «По цвету»; 0 — не считаем. */
  const [tintProgress, setTintProgress] = useState(0)
  /** Кадры, у которых средний цвет не посчитался: второй раз не пробуем. */
  const tintFailed = useRef<Set<string>>(new Set())
  const tintQueue = useRef(false)
  /**
   * Шаблоны промптов: имя → текст с `{переменными}`. Один и тот же каркас
   * («{объект} в стиле акварели, белый фон») переписывают руками десятки раз,
   * а меняется в нём одно слово.
   */
  const [templates, setTemplates] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(imageStudioTemplatesKey(conversationId)) ?? '{}')
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (typeof value === 'string') out[key] = value
      return out
    } catch { return {} }
  })
  const [templateOpen, setTemplateOpen] = useState(false)
  /** Свойства запрошены клавишей `i`: лайтбокс откроет их сам. */
  const [propsRequested, setPropsRequested] = useState(false)
  /** Показ запрошен из панели: лайтбокс включит слайдшоу сразу при открытии. */
  const [slideshowRequested, setSlideshowRequested] = useState(false)
  /** Поиск по истории промптов: чипов бывает пятьдесят. */
  const [promptSearch, setPromptSearch] = useState('')
  const [templateName, setTemplateName] = useState('')
  /** Заполнение переменных выбранного шаблона: имя переменной → значение. */
  const [templateFill, setTemplateFill] = useState<{ name: string; values: Record<string, string> } | null>(null)
  /** Образец для «похожих по цвету»; null — фильтр выключен. */
  const [tintOf, setTintOf] = useState<string | null>(null)
  /** Кэш фактов о файлах: чтение байтов и пикселей на каждое открытие лишнее. */
  const factsCache = useRef(new Map<string, { type: string | null; mismatch: string | null; alpha: boolean; colors: number }>())
  /** Кэш гистограмм по каналам: пересчёт на каждое раскрытие свойств не нужен. */
  const channelCache = useRef(new Map<string, { r: number[]; g: number[]; b: number[] }>())
  /** Отфильтрованный список для эффектов (см. присваивание после расчёта). */
  const shownRef = useRef<ImageStudioFile[]>([])
  /** Маркер конца страницы: доехали до него — подгружаем следующую порцию. */
  const moreRef = useRef<HTMLDivElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
  /** blob-URL превью по имени файла; пересоздаются при смене updatedAt. */
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewsRef = useRef<Record<string, string>>({})
  /** Пиксельные размеры превью — узнаём при загрузке картинки в <img>. */
  const [dimensions, setDimensions] = useState<Record<string, string>>({})
  const previewKeys = useRef<Record<string, number>>({})
  /** Файлы, уже получившие один автоповтор чтения превью. */
  const retriedOnce = useRef<Set<string>>(new Set())

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await api['imgstudio:list']({ conversationId })
      setFiles(list)
      setFailed(false)
      // Новое, что появилось не из наших действий (ход ассистента в чате),
      // подсвечиваем бейджем — иначе пополнение галереи легко проглядеть.
      if (knownPaths.current) {
        const appeared = list.filter((file) => !knownPaths.current!.has(file.path)).map((file) => file.path)
        if (appeared.length) {
          setFresh((prev) => new Set([...prev, ...appeared]))
          setTimeout(() => setFresh((prev) => { const next = new Set(prev); for (const path of appeared) next.delete(path); return next }), 15000)
        }
      }
      knownPaths.current = new Set(list.map((file) => file.path))
      // Пропавшие файлы (удалили, переименовали) уносят с собой blob-URL:
      // без revoke они держат память вкладки до перезагрузки, а на сотне
      // обработок это десятки мегабайт.
      setPreviews((prev) => {
        const alive = new Set(list.map((file) => file.path))
        const stale = Object.keys(prev).filter((path) => !alive.has(path))
        if (!stale.length) return prev
        const next = { ...prev }
        for (const path of stale) {
          URL.revokeObjectURL(next[path]!)
          delete next[path]
          delete previewKeys.current[path]
        }
        previewsRef.current = next
        return next
      })
      // Превью тянем только для новых или изменившихся файлов: base64 каждой
      // картинки на каждый поллинг разорил бы вкладку.
      const pending = list.filter((file) => previewKeys.current[file.path] !== file.updatedAt)
      for (const file of pending) previewKeys.current[file.path] = file.updatedAt
      const loadPreview = async (file: ImageStudioFile): Promise<void> => {
        const applyBlob = (blob: Blob): void => {
          const url = URL.createObjectURL(blob)
          setPreviews((prev) => {
            if (prev[file.path]) URL.revokeObjectURL(prev[file.path]!)
            const next = { ...prev, [file.path]: url }
            previewsRef.current = next
            return next
          })
          setBroken((prev) => { if (!prev.has(file.path)) return prev; const next = new Set(prev); next.delete(file.path); return next })
        }
        try {
          // Сначала IndexedDB-кэш (мгновенно и без трафика), затем сеть.
          const cached = await getCachedPreview(conversationId, file.path, file.updatedAt)
          if (cached) { applyBlob(cached); return }
          const { dataBase64 } = await api['imgstudio:read']({ conversationId, path: file.path })
          const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
          const blob = new Blob([bytes], { type: imageStudioMime(file.path) })
          applyBlob(blob)
          void putCachedPreview(conversationId, file.path, file.updatedAt, blob)
        } catch {
          delete previewKeys.current[file.path]
          // Один автоповтор через 2 с: сетевые обрывы чаще всего мгновенные.
          if (!retriedOnce.current.has(file.path)) {
            retriedOnce.current.add(file.path)
            setTimeout(() => void reload(), 2000)
            return
          }
          setBroken((prev) => new Set(prev).add(file.path))
        }
      }
      // Не ждём превью (список важнее) и не запускаем их все разом: на сотне
      // картинок сотня одновременных запросов душила и вкладку, и сервер, а
      // первые плитки появлялись не раньше последних.
      void mapWithLimit(pending, PREVIEW_CONCURRENCY, loadPreview)
    } catch {
      setFailed(true)
    }
  }, [api, conversationId])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    let alive = true
    void api['imgstudio:publication']({ conversationId }).then((info) => { if (alive) { setShareUrl(info.url); setShareViews(info.views ?? null); setShareViews7(info.views7 ?? null); setShareProtected(Boolean(info.passwordProtected)) } }).catch(() => { if (alive) setShareUrl(null) })
    return () => { alive = false }
  }, [api, conversationId])
  // Перезагрузили страницу во время генерации — ран живёт на сервере; панель
  // обязана это показать, иначе результат «появится когда-нибудь молча».
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async (): Promise<void> => {
      try {
        const { active } = await api['imgstudio:run']({ conversationId })
        if (!alive) return
        if (active) {
          setBusy(true)
          setProgress((prev) => prev ?? { label: 'Модель рисует (ран продолжается после перезагрузки)', seconds: 0 })
          timer = setTimeout(() => void poll(), 3000)
        } else {
          // Ран кончился (или его не было): вернуть панель и добрать галерею.
          setBusy((was) => {
            if (was) void reload()
            return false
          })
          setProgress((prev) => prev && prev.label.includes('после перезагрузки') ? null : prev)
        }
      } catch { /* сервер недоступен — обычные пути покажут ошибку */ }
    }
    void poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [api, conversationId, reload])
  // Уходя, запоминаем самый свежий updatedAt: в следующий визит по нему видно,
  // что появилось без нас (ход ассистента, работа коллеги в том же чате).
  const seenRef = useRef(0)
  useEffect(() => {
    if (files?.length) seenRef.current = Math.max(seenRef.current, ...files.map((file) => file.updatedAt))
  }, [files])
  useEffect(() => () => {
    try { if (seenRef.current) localStorage.setItem(imageStudioSeenKey(conversationId), String(seenRef.current)) } catch { /* приватный режим */ }
  }, [conversationId])
  // Панель закрыли или сменили разговор — blob-URL превью иначе живут до
  // конца вкладки (насосать их можно на сотни мегабайт).
  useEffect(() => () => {
    for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url)
  }, [])
  // Во время хода ассистента картинки появляются без действий панели.
  usePolling(() => void reload(), { enabled: Boolean(turnActive), intervalMs: 4000 })
  /**
   * Возврат во вкладку — обновление списка. Пока ассистент не ведёт ход,
   * галерея не поллится вовсе, и картинки, добавленные из другого места (второй
   * вкладки, телефона, соседа по разговору), не появлялись до нажатия «r».
   * Чаще раза в 10 с не ходим: переключение вкладок туда-сюда — обычное дело.
   */
  const lastVisibleReload = useRef(Date.now())
  useEffect(() => {
    const onVisible = (): void => {
      if (document.hidden || turnActive) return
      if (Date.now() - lastVisibleReload.current < 10_000) return
      lastVisibleReload.current = Date.now()
      void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload, turnActive])
  // Хвост хода: captureStudioImages дописывает галерею уже после done, и
  // последний поллинг его не застаёт — добираем одним отложенным reload.
  const wasTurnActive = useRef(false)
  useEffect(() => {
    if (wasTurnActive.current && !turnActive) {
      const timer = setTimeout(() => void reload(), 1500)
      return () => clearTimeout(timer)
    }
    wasTurnActive.current = Boolean(turnActive)
    return undefined
  }, [turnActive, reload])
  // Геометрия сетки: число колонок и высота строки берутся у живого узла —
  // `auto-fill` и плотный режим меняют их, а константа разъехалась бы с видом.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = (): void => {
      const template = getComputedStyle(grid).gridTemplateColumns
      const columns = Math.max(1, template.split(' ').filter(Boolean).length)
      const card = grid.querySelector<HTMLElement>('.image-studio-card')
      const gap = Number.parseFloat(getComputedStyle(grid).rowGap || '0') || 0
      const rowHeight = card ? card.getBoundingClientRect().height + gap : 0
      setMetrics((prev) => prev.columns === columns && Math.abs(prev.rowHeight - rowHeight) < 1 ? prev : { columns, rowHeight })
    }
    measure()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [dense, grouped, files?.length])
  // Докрутили до конца — следующая порция приезжает сама. Кнопка остаётся:
  // IntersectionObserver есть не везде (и не в jsdom), а список должен
  // дорастать в любом браузере.
  useEffect(() => {
    const node = moreRef.current
    if (!node || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((prev) => prev + pageSize)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visibleCount, files?.length])
  // Адрес ведёт лайтбокс: открыли ссылку — картинка раскрылась сама. Файла
  // может не быть (переименовали, удалили) — тогда просто чистим адрес.
  useEffect(() => {
    if (!routeFile || !files) return
    if (files.some((file) => file.path === routeFile)) setViewing((prev) => prev ?? routeFile)
    else navigate(`/images/${conversationId}`, { replace: true })
  }, [routeFile, files, conversationId, navigate])
  // Отбор из ссылки применяется один раз, после чего адрес чистится: иначе
  // любое изменение фильтров конфликтовало бы с адресом, а «Назад» возвращало
  // бы чужой отбор поверх своего.
  const appliedRouteView = useRef<string | null>(null)
  useEffect(() => {
    if (!routeView || appliedRouteView.current === routeView) return
    appliedRouteView.current = routeView
    const view = decodeStudioView(routeView)
    navigate(`/images/${conversationId}`, { replace: true })
    if (isEmptyView(view)) return
    applyView(view)
    toast.info(`Отбор из ссылки: ${viewSummary(view)}`)
  }, [routeView, conversationId, navigate])
  // …и обратно: открыли или закрыли лайтбокс — адрес это отражает. Пишем
  // через replace, иначе «Назад» пришлось бы жать столько раз, сколько
  // картинок посмотрели.
  useEffect(() => {
    if (segments[0] !== 'images' || segments[1] !== conversationId) return
    // Пока список не пришёл, адрес не трогаем: иначе ссылка на кадр стиралась
    // бы раньше, чем панель успевала её применить.
    if (!files) return
    const target = viewing ? `/images/${conversationId}/${encodeURIComponent(viewing)}` : `/images/${conversationId}`
    if (routePath !== target) navigate(target, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, conversationId, routePath, Boolean(files)])
  // Уход со страницы во время пакета прервал бы его на середине: браузер
  // спросит подтверждение. Вешаем обработчик только на время операции.
  useEffect(() => {
    if (batchTotal === null) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [batchTotal])
  // Контекстное меню закрывается как любое меню: клик мимо, Esc, прокрутка.
  useEffect(() => {
    if (!menu) return
    const opener = menu.path
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      // Фокус возвращаем на превью карточки — так же, как это делает Dialog.
      const thumb = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(opener)}"] .image-studio-thumb`)
      if (thumb && document.activeElement === document.body) thumb.focus()
    }
  }, [menu])
  /**
   * Позиция прокрутки галереи на разговор: переключение чата и возврат
   * обратно раньше кидали в начало списка, а искать взглядом ту же картинку
   * среди сотни — работа.
   */
  useEffect(() => {
    if (!files || scrollRestored.current) return
    scrollRestored.current = true
    try {
      const saved = Number(sessionStorage.getItem(imageStudioScrollKey(conversationId)) ?? '')
      // Через таймер, а не requestAnimationFrame: в фоновой вкладке кадры не
      // тикают, и восстановление молча не срабатывало бы.
      if (Number.isFinite(saved) && saved > 0) setTimeout(() => { if (paneRef.current) paneRef.current.scrollTop = saved }, 0)
    } catch { /* приватный режим */ }
  }, [files, conversationId])
  // Промпт — главное действие панели: открыли студию → сразу можно печатать.
  useEffect(() => { promptRef.current?.focus() }, [conversationId])
  // Поле переименования открывается кнопкой ✎ — фокус руками, autoFocus в
  // React 18 с порталами срабатывает не всегда (видели живьём в браузере).
  useEffect(() => { if (renaming) renameRef.current?.focus() }, [renaming?.from])
  /**
   * Системное уведомление о готовности: генерация идёт минуту-две, и всё это
   * время люди уходят в другую вкладку. Звук слышно не всегда, а заголовок
   * вкладки надо ещё увидеть. Разрешение спрашиваем только по кнопке.
   */
  const notifyDone = (text: string): void => {
    if (typeof Notification !== 'function' || Notification.permission !== 'granted' || !document.hidden) return
    try { new Notification('Студия картинок', { body: text, tag: `imgstudio-${conversationId}` }) } catch { /* браузер отказал */ }
  }
  // Фоновая вкладка: заголовок показывает, что модель рисует, а завершение
  // отбивается коротким сигналом — не сидеть же и смотреть на секундомер.
  useEffect(() => {
    if (!progress) return
    const original = document.title
    document.title = `⏳ ${progress.label}…`
    return () => {
      document.title = original
      if (document.hidden) playStopCue()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(progress)])
  // Баннер «Отменить» живёт недолго: дальше файл проще удалить руками.
  useEffect(() => {
    if (!lastCreated) return
    const timer = setTimeout(() => setLastCreated(null), 12000)
    return () => clearTimeout(timer)
  }, [lastCreated])
  /**
   * Новый файл подводим к экрану. При сортировке «сначала новые» он и так
   * сверху, но при «по имени» или «сначала готовые» появляется где угодно — и
   * пользователь решает, что рисование ничего не сделало. Ждём кадра: карточки
   * ещё нет в DOM в тот момент, когда прилетел список.
   */
  useEffect(() => {
    if (!lastCreated) return
    const timer = setTimeout(() => {
      const index = shownRef.current.findIndex((file) => file.path === lastCreated)
      if (index >= 0) revealCard(lastCreated, index)
    }, 80)
    return () => clearTimeout(timer)
  }, [lastCreated])
  // Откат имён — тоже предложение на минуту, а не история переименований.
  useEffect(() => {
    if (!lastRename) return
    const timer = setTimeout(() => setLastRename(null), 20000)
    return () => clearTimeout(timer)
  }, [lastRename])
  useEffect(() => {
    if (!lastDeleted) return
    const timer = setTimeout(() => setLastDeleted(null), 20000)
    return () => clearTimeout(timer)
  }, [lastDeleted])
  useEffect(() => {
    if (!lastBatchCreated) return
    const timer = setTimeout(() => setLastBatchCreated(null), 20000)
    return () => clearTimeout(timer)
  }, [lastBatchCreated])
  // Секундомер генерации: немой спиннер на минуту читается как «зависло».
  useEffect(() => {
    if (!progress) return
    const timer = setInterval(() => setProgress((prev) => prev && { ...prev, seconds: prev.seconds + 1 }), 1000)
    return () => clearInterval(timer)
  }, [progress?.label])

  /** Корзина спрашивается точечно (операции панели), а не на каждый поллинг. */
  const refreshTrash = useCallback(async (): Promise<void> => {
    try {
      const { items } = await api['imgstudio:trash']({ conversationId })
      setTrash(items)
      setTrashCount(items.length)
    } catch { setTrashCount(null) }
  }, [api, conversationId])
  // Счётчик нужен до раскрытия: иначе про восстановление никто не вспомнит.
  useEffect(() => { void refreshTrash() }, [refreshTrash])

  // Действия галереи в общем реестре: за десятки итераций панель обросла
  // кнопками, которых нет ни в палитре ⌘K, ни в шпаргалке. Источник — функция,
  // поэтому команды видят свежее состояние (есть ли файлы, идёт ли операция).
  useCommandSource(() => [
    {
      id: 'imgstudio.prompt',
      title: 'Студия: написать промпт',
      section: 'action',
      keywords: ['картинки', 'нарисовать', 'image'],
      run: () => promptRef.current?.focus()
    },
    {
      id: 'imgstudio.upload',
      title: 'Студия: загрузить картинки',
      section: 'action',
      hotkey: 'u',
      hotkeyNote: 'когда фокус в галерее',
      keywords: ['картинки', 'файл', 'upload'],
      run: () => uploadRef.current?.click()
    },
    {
      id: 'imgstudio.keys',
      title: 'Студия: клавиши галереи',
      section: 'action',
      // Комбинации у команды нет: «?» уже открывает общую шпаргалку
      // приложения, и вторая на ту же клавишу давала два окна разом.
      keywords: ['картинки', 'шпаргалка', 'hotkeys'],
      run: () => setKeysOpen(true)
    },
    {
      id: 'imgstudio.trash',
      title: 'Студия: открыть корзину',
      section: 'action',
      keywords: ['картинки', 'удалённые', 'trash'],
      run: () => { setTrashOpen(true); void refreshTrash() }
    },
    {
      id: 'imgstudio.multi',
      title: 'Студия: выбрать несколько картинок',
      section: 'action',
      keywords: ['картинки', 'мультивыбор', 'select'],
      enabled: () => Boolean(files?.length),
      run: () => setMulti((prev) => prev ?? new Set())
    },
    {
      id: 'imgstudio.marks',
      title: 'Студия: звёзды и заметки',
      section: 'action',
      keywords: ['картинки', 'пометки', 'notes'],
      run: () => { setMarksDraft(JSON.stringify({ stars: [...stars], notes, statuses }, null, 2)); setMarksOpen(true) }
    }
  ])

  /** Отдаёт `true`, если операция прошла: по нему решают, показывать ли отмену. */
  const run = async (action: () => Promise<unknown>, success?: string, progressLabel?: string): Promise<boolean> => {
    setBusy(true)
    setLastError(null)
    if (progressLabel) setProgress({ label: progressLabel, seconds: 0 })
    try {
      await action()
      await reload()
      // Любая операция панели может пополнить корзину (удаление, замена).
      void refreshTrash()
      if (success) { toast.success(success); setAnnounce(success); notifyDone(success) }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      toast.error(message)
      return false
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /**
   * Удаление одного файла с отменой прямо в тосте. Вернуть случайно удалённое
   * можно было только через панель корзины — её ещё надо развернуть, а «Вернуть»
   * нужно ровно в ту секунду, когда ошибка замечена. Имя после восстановления
   * может отличаться (если место уже занято новым файлом), поэтому в тосте
   * показываем то, что вернул сервер.
   */
  const deleteOne = async (path: string): Promise<void> => {
    // Соседа запоминаем до удаления: после перезагрузки списка индекс уже
    // другой, а фокус после удаления улетал в body — с клавиатуры дальше
    // работать было нельзя.
    const gone = shownRef.current.findIndex((file) => file.path === path)
    const neighbour = shownRef.current[gone + 1]?.path ?? shownRef.current[gone - 1]?.path ?? null
    if (!(await run(() => api['imgstudio:delete']({ conversationId, path })))) return
    if (neighbour) {
      setSelected(neighbour)
      setTimeout(() => {
        const card = document.querySelector(`[data-path="${CSS.escape(neighbour)}"] .image-studio-thumb`)
        ;(card as HTMLElement | null)?.focus?.()
      }, 0)
    }
    setAnnounce(`«${path}» в корзине`)
    const restore = (): void => void (async () => {
      let restored = path
      if (await run(async () => { restored = (await api['imgstudio:restore']({ conversationId, name: path })).name })) {
        toast.success(restored === path ? `«${path}» возвращён` : `Возвращён как «${restored}»`)
      }
    })()
    remember(`Удалено «${path}»`, restore)
    // Тост и журнал зовут одну и ту же отмену: два пути к одному действию.
    toast.success(`«${path}» в корзине`, { action: { label: 'Вернуть', onClick: restore } })
  }

  /**
   * Обёртка пакетной операции: сбрасывает просьбу прервать, ведёт счётчик и
   * отдаёт функцию-вопрос «пора остановиться?». Без неё каждый цикл заводил
   * бы свой флаг, и «Прервать» работало бы через раз.
   */
  const beginBatch = (total: number): { stop: () => boolean; step: (done: number) => void } => {
    abortBatch.current = false
    setBatchTotal(total)
    setBatchDone(0)
    return { stop: () => abortBatch.current, step: (done) => setBatchDone(done) }
  }
  const endBatch = (): void => {
    // Пакет на двадцати файлах идёт минуту: коротким сигналом отбиваем конец,
    // как и генерацию, — иначе за ним приходится следить глазами.
    if (batchTotal !== null && batchTotal > 3) playStopCue()
    setBatchTotal(null)
    setBatchDone(null)
    abortBatch.current = false
  }

  /**
   * Хватит ли места. Пакетная обработка на двадцати файлах может упереться в
   * квоту на середине — тогда половина результатов уже записана, а операция
   * выглядит упавшей.
   */
  const quotaShort = (extraBytes: number): string | null => {
    const occupied = (files ?? []).reduce((sum, item) => sum + item.size, 0)
    if (occupied + extraBytes <= IMAGE_STUDIO_LIMITS.maxConversationBytes) return null
    const free = Math.max(0, IMAGE_STUDIO_LIMITS.maxConversationBytes - occupied)
    return `Не хватит места: результату нужно около ${formatBytes(extraBytes)}, свободно ${formatBytes(free)}. Удалите ненужное или очистите корзину.`
  }

  /**
   * Открыть меню у выбранной карточки: точку берём из её геометрии, чтобы
   * меню появилось там же, где и по правому клику.
   */
  const openMenuForSelected = (): void => {
    if (!selected) return
    const card = document.querySelector(`[data-path="${CSS.escape(selected)}"]`)
    const box = card?.getBoundingClientRect()
    setMenu({ path: selected, x: Math.round(box ? box.left + 24 : 24), y: Math.round(box ? box.top + 24 : 24) })
  }

  const toggleStar = (path: string): void => {
    setStars((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      try { localStorage.setItem(imageStudioStarsKey(conversationId), JSON.stringify([...next])) } catch { /* приватный режим */ }
      return next
    })
  }

  /**
   * Пометки (звезда и заметка) привязаны к имени файла, поэтому при
   * переименовании их надо переносить руками: иначе звезда оставалась на
   * несуществующем имени, а заметка «терялась» — со стороны это выглядело как
   * сброс настроек.
   */
  const moveMarks = (from: string, to: string): void => {
    setStars((prev) => {
      if (!prev.has(from)) return prev
      const next = new Set(prev)
      next.delete(from)
      next.add(to)
      try { localStorage.setItem(imageStudioStarsKey(conversationId), JSON.stringify([...next])) } catch { /* приватный режим */ }
      return next
    })
    setNotes((prev) => {
      if (prev[from] === undefined) return prev
      const next = { ...prev }
      next[to] = next[from]!
      delete next[from]
      try { localStorage.setItem(imageStudioNotesKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  /** Пометки удалённого навсегда файла хранить незачем. */
  const dropMarks = (paths: string[]): void => {
    setStars((prev) => {
      if (!paths.some((path) => prev.has(path))) return prev
      const next = new Set(prev)
      for (const path of paths) next.delete(path)
      try { localStorage.setItem(imageStudioStarsKey(conversationId), JSON.stringify([...next])) } catch { /* приватный режим */ }
      return next
    })
    setNotes((prev) => {
      if (!paths.some((path) => prev[path] !== undefined)) return prev
      const next = { ...prev }
      for (const path of paths) delete next[path]
      try { localStorage.setItem(imageStudioNotesKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  /**
   * Перенос пометок в другой разговор: они лежат в его ключах, а не в общих,
   * поэтому пишем напрямую — стора соседнего чата у панели нет.
   */
  const copyMarksTo = (target: string, path: string, newName: string, move: boolean): void => {
    try {
      if (stars.has(path)) {
        const raw: unknown = JSON.parse(localStorage.getItem(imageStudioStarsKey(target)) ?? '[]')
        const list = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
        localStorage.setItem(imageStudioStarsKey(target), JSON.stringify([...new Set([...list, newName])]))
      }
      if (notes[path] !== undefined) {
        const raw: unknown = JSON.parse(localStorage.getItem(imageStudioNotesKey(target)) ?? '{}')
        const map = raw && typeof raw === 'object' ? raw as Record<string, string> : {}
        localStorage.setItem(imageStudioNotesKey(target), JSON.stringify({ ...map, [newName]: notes[path]! }))
      }
    } catch { /* приватный режим */ }
    if (move) dropMarks([path])
  }

  /** Цикл готовности: нет пометки → черновик → готово → нет пометки. */
  const cycleStatus = (path: string): void => {
    setStatuses((prev) => {
      const next = { ...prev }
      if (!next[path]) next[path] = 'draft'
      else if (next[path] === 'draft') next[path] = 'ready'
      else delete next[path]
      try { localStorage.setItem(imageStudioStatusKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  const saveSets = (next: Record<string, string[]>): void => {
    setSets(next)
    try { localStorage.setItem(imageStudioSetsKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
  }

  const saveViews = (next: Record<string, StudioView>): void => {
    setViews(next)
    try { localStorage.setItem(imageStudioViewsKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
  }

  /** Нынешние условия отбора одним снимком: для ссылки и для «запомнить вид». */
  const currentView = (): StudioView => ({
    ...(filter.trim() ? { query: filter.trim() } : {}),
    ...(originFilter ? { origin: originFilter } : {}),
    ...(markFilter ? { mark: markFilter } : {}),
    ...(activeSet ? { set: activeSet } : {}),
    ...(kindFilter ? { kind: kindFilter } : {}),
    ...(shapeFilter ? { shape: shapeFilter } : {}),
    ...(order !== 'new' ? { order } : {}),
    ...(grouped ? { grouped: true } : {}),
    ...(starsOnly ? { starsOnly: true } : {})
  })

  const saveTemplates = (next: Record<string, string>): void => {
    setTemplates(next)
    try { localStorage.setItem(imageStudioTemplatesKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
  }

  const saveRecipes = (next: Record<string, { style: string; size: string; negative: string; noText: boolean }>): void => {
    setRecipes(next)
    try { localStorage.setItem(imageStudioRecipesKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
  }

  /**
   * Переименование набора. Порядок ключей сохраняем: набор — это ещё и позиция
   * чипа, и после правки имени он не должен прыгать в конец строки.
   */
  const renameSet = (): void => {
    if (!setRename) return
    const target = setRename.to.trim()
    if (!target || !sets[setRename.from]) { setSetRename(null); return }
    if (target !== setRename.from && sets[target]) { toast.error(`Набор «${target}» уже есть`); return }
    const next: Record<string, string[]> = {}
    for (const [name, list] of Object.entries(sets)) next[name === setRename.from ? target : name] = list
    saveSets(next)
    if (activeSet === setRename.from) setActiveSet(target)
    setSetRename(null)
    toast.success(`Набор переименован в «${target}»`)
  }

  /** Применить пресет запроса: он пишется в те же ключи, что и руками. */
  const applyRecipe = (recipe: { style: string; size: string; negative: string; noText: boolean }): void => {
    setStyle(recipe.style)
    setSize(recipe.size)
    setNegative(recipe.negative)
    setNoText(recipe.noText)
    try {
      localStorage.setItem(imageStudioStyleKey(conversationId), recipe.style)
      localStorage.setItem(imageStudioSizeKey(conversationId), recipe.size)
      localStorage.setItem(imageStudioNegativeKey(conversationId), recipe.negative)
      localStorage.setItem(IMAGE_STUDIO_NO_TEXT_KEY, recipe.noText ? '1' : '0')
    } catch { /* приватный режим */ }
  }

  /**
   * Досчитать средние цвета для видимых файлов. Идём партиями по четыре: сотня
   * одновременных `createImageBitmap` подвешивает вкладку сильнее, чем сама
   * сортировка помогает.
   */
  /**
   * Сколько кадров ещё считается по цвету. Порядок «По цвету» на сотне файлов
   * думает несколько секунд (каждый кадр — blob, `createImageBitmap` и канвас),
   * и всё это время на экране не менялось ничего: человек не понимал, работает
   * ли сортировка вообще.
   */
  const ensureTints = (list: ImageStudioFile[]): void => {
    if (tintQueue.current) return
    /**
     * Файлы, у которых цвет не берётся (svg, битые, отозванный blob), держим
     * отдельно: без этого партия из одних неудач повторяется на каждом рендере
     * — а с индикатором прогресса, который сам вызывает рендер, это уже вечный
     * цикл (вкладка вставала намертво, поймано в браузере).
     */
    const pending = list.filter((file) => !tints[file.path] && !tintFailed.current.has(file.path)).slice(0, 24)
    if (!pending.length) return
    tintQueue.current = true
    void (async () => {
      // Счётчик ставим уже в микротаске: `ensureTints` зовут прямо из тела
      // рендера, а `setState` в фазе рендера React крутит по кругу — прогон
      // тестов на этом вставал намертво.
      setTintProgress(pending.length)
      try {
        const found: Record<string, { r: number; g: number; b: number }> = {}
        await mapWithLimit(pending, 4, async (file) => {
          try {
            const blob = await blobOf(file.path)
            const bitmap = await createImageBitmap(blob)
            const canvas = document.createElement('canvas')
            canvas.width = 24
            canvas.height = 24
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(bitmap, 0, 0, 24, 24)
              const tint = averageColor(ctx.getImageData(0, 0, 24, 24).data)
              if (tint) found[file.path] = tint
            }
            bitmap.close?.()
          } catch {
            // svg и битые пропускаем: у них цвета не спросить — и больше не спрашиваем.
            tintFailed.current.add(file.path)
          }
          setTintProgress((left) => Math.max(0, left - 1))
        })
        if (Object.keys(found).length) setTints((prev) => ({ ...prev, ...found }))
      } finally {
        tintQueue.current = false
        setTintProgress(0)
      }
    })()
  }

  /** Применить сохранённый вид: недостающие поля означают «условие снято». */
  const applyView = (view: StudioView): void => {
    setFilter(view.query ?? '')
    setOriginFilter(view.origin ?? '')
    setMarkFilter(view.mark ?? '')
    setActiveSet(view.set ?? '')
    setKindFilter(view.kind ?? '')
    setShapeFilter(view.shape ?? '')
    setOrder(view.order ?? 'new')
    setGrouped(Boolean(view.grouped))
    setStarsOnly(Boolean(view.starsOnly))
    // Условия сменились — страница начинается заново, иначе «показать ещё»
    // остаётся от прежнего отбора и сетка выглядит длиннее, чем есть.
    setVisibleCount(PAGE_SIZE)
    // Смена отбора меняет весь список, а читалке об этом никто не сообщал:
    // для незрячего это «экран внезапно другой».
    setAnnounce(`Отбор: ${viewSummary(view)}`)
  }

  const setNote = (path: string, text: string): void => {
    setNotes((prev) => {
      const next = { ...prev }
      if (text.trim()) next[path] = text.trim()
      else delete next[path]
      try { localStorage.setItem(imageStudioNotesKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  /**
   * Пакетное переименование в два прохода через временные имена: цель одного
   * файла часто совпадает с текущим именем другого, и прямой rename упёрся бы
   * в «уже есть» на середине пачки, оставив её наполовину переименованной.
   */
  const applyRenamePlan = async (plan: Array<{ from: string; to: string }>): Promise<void> => {
    const stamp = Date.now()
    const temp = plan.map((step, index) => {
      const dot = step.from.lastIndexOf('.')
      return `пакет-${stamp}-${index}${dot > 0 ? step.from.slice(dot) : ''}`
    })
    for (const [index, step] of plan.entries()) await api['imgstudio:rename']({ conversationId, from: step.from, to: temp[index]! })
    for (const [index, step] of plan.entries()) await api['imgstudio:rename']({ conversationId, from: temp[index]!, to: step.to })
    for (const step of plan) moveMarks(step.from, step.to)
  }

  const rememberPrompt = (text: string): void => {
    setRecent((prev) => {
      const next = [text, ...prev.filter((item) => item !== text)].slice(0, RECENT_LIMIT)
      try { localStorage.setItem(imageStudioPromptsKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  const togglePin = (text: string): void => {
    setPinned((prev) => {
      const next = prev.includes(text) ? prev.filter((item) => item !== text) : [...prev, text].slice(-8)
      try { localStorage.setItem(imageStudioPinnedKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }

  /**
   * `override` нужен «Ещё раз»: он запускает прошлый промпт сразу, а не ждёт,
   * пока обновится состояние поля — замыкание всё равно видело бы старое.
   */
  const generate = (override?: string): void => {
    const source = (override ?? prompt).trim()
    if (busy || !source) return
    const cleaned = source
    // Пресет размера — просто добавка к промпту: модель рисует скриптом и
    // размер для неё такой же текст, как и всё остальное.
    const withStyle = style && !selected ? `${cleaned}\nСтиль: ${style}.` : cleaned
    const withSize = size && !selected ? `${withStyle}\nРазмер изображения: ${size.replace('×', 'x')}` : withStyle
    const withNegative = negative.trim() && !selected ? `${withSize}\nНе должно быть на изображении: ${negative.trim()}.` : withSize
    const fullPrompt = noText ? `${withNegative}\nНе добавляй на изображение никакой текст, надписи и водяные знаки.` : withNegative
    const typedName = fileName.trim()
    const name = typedName
      ? (!isImageStudioPath(typedName) ? `${typedName}.png` : typedName)
      // Имя не задано — «синий-кит.png» из промпта читается лучше «изображение-7.png».
      : nameFromPrompt(cleaned)
    const target = selected
    rememberPrompt(cleaned)
    // Запуск захватывает все аргументы: «Повторить» из баннера ошибки гоняет
    // ровно тот же ран, а не то, что успело поменяться в полях.
    const launch = (): Promise<boolean> => run(async () => {
      // Выбрана картинка — правим её; нет — рисуем новую. Один промпт на
      // оба действия: так работает голова пользователя, а не наша схема.
      const result = target
        ? await api['imgstudio:edit']({ conversationId, path: target, prompt: fullPrompt })
        : await api['imgstudio:generate']({ conversationId, prompt: fullPrompt, ...(name ? { name } : {}) })
      // Готовый файл может уехать вниз при сортировке по имени — показываем его.
      const created = result.file.path
      setLastCreated(created)
      setTimeout(() => document.querySelector(`[data-path="${CSS.escape(created)}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 150)
      setPrompt('')
      setFileName('')
      try { localStorage.removeItem(imageStudioDraftKey(conversationId)) } catch { /* приватный режим */ }
      promptRef.current?.focus()
    }, target ? 'Правка готова — результат рядом с оригиналом' : 'Изображение готово',
      target ? `Модель правит «${target}»` : 'Модель рисует')
    setLastAttempt(() => launch)
    void launch()
  }

  /**
   * Серия вариаций одной картинки: три отдельных рана модели подряд с той же
   * просьбой. Раньше приходилось нажимать ✦ и ждать каждую по отдельности.
   */
  const variateSeries = (file: ImageStudioFile, count: number): void => {
    const batch = beginBatch(count)
    void run(async () => {
      try {
        let done = 0
        for (let index = 0; index < count; index += 1) {
          if (batch.stop()) { toast.info(`Прервано: готово вариаций ${done} из ${count}`); break }
          setProgress({ label: `Модель рисует вариацию ${index + 1} из ${count}: «${file.path}»`, seconds: 0 })
          await api['imgstudio:edit']({ conversationId, path: file.path, prompt: 'Нарисуй ещё один вариант этого изображения: та же тема и стиль, но с заметными отличиями в деталях или композиции.' })
          done += 1
          batch.step(done)
        }
      } finally {
        endBatch()
      }
    }, `Вариации готовы (${count})`)
  }

  /** Вариация: та же картинка-исходник, промпт фиксированный. */
  const variate = (file: ImageStudioFile): void => {
    void run(
      () => api['imgstudio:edit']({ conversationId, path: file.path, prompt: 'Нарисуй ещё один вариант этого изображения: та же тема и стиль, но с заметными отличиями в деталях или композиции.' }),
      'Вариация готова — результат рядом с оригиналом',
      `Модель рисует вариацию «${file.path}»`
    )
  }

  /** Файл больше лимита пробуем ужать канвасом (jpeg), а не отфутболивать 413-й. */
  /**
   * Привести длинную сторону к `target`. Отдельно от `shrinkOversized`: тот
   * спасает файл от лимита по весу, а этот выполняет осознанную просьбу
   * «уменьшить», и потому оставляет формат PNG (прозрачность важнее веса).
   */
  const downscaleTo = async (file: File, target: number): Promise<File> => {
    if (typeof createImageBitmap !== 'function') return file
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, target / Math.max(bitmap.width, bitmap.height))
      if (scale >= 1) { bitmap.close?.(); return file }
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { bitmap.close?.(); return file }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close?.()
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' }) : file
    } catch {
      return file
    }
  }

  const shrinkOversized = async (file: File): Promise<{ name: string; blob: Blob } | null> => {
    if (file.size <= IMAGE_STUDIO_LIMITS.maxFileBytes) return { name: file.name, blob: file }
    if (typeof createImageBitmap !== 'function') return null
    try {
      const bitmap = await createImageBitmap(file)
      // Даунскейлим по площади: байты примерно пропорциональны ей.
      const scale = Math.sqrt((IMAGE_STUDIO_LIMITS.maxFileBytes * 0.8) / file.size)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (!blob || blob.size > IMAGE_STUDIO_LIMITS.maxFileBytes) return null
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      toast.info(`«${file.name}» больше лимита — сжато до ${Math.round(blob.size / 1024)} КБ (${name})`)
      return { name, blob }
    } catch {
      return null
    }
  }

  /**
   * Побайтовые дубликаты среди загружаемого: одна и та же картинка под другим
   * именем — самый частый мусор в галерее (перетащили дважды, скачали и
   * вернули). Сравниваем только с файлами того же размера, поэтому лишних
   * чтений почти не бывает.
   */
  const findDuplicates = async (items: File[]): Promise<Map<string, string>> => {
    const found = new Map<string, string>()
    for (const file of items) {
      const candidates = (files ?? []).filter((item) => item.size === file.size)
      if (!candidates.length) continue
      let base64: string
      try {
        // Сравниваем в base64, а не в байтах: сервер отдаёт файл именно так,
        // и одинаковые байты дают одинаковую строку без лишних конверсий.
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
        base64 = btoa(binary)
      } catch { continue }
      for (const candidate of candidates) {
        try {
          if (await readBase64(candidate.path) === base64) {
            found.set(file.name, candidate.path)
            break
          }
        } catch { /* нечитаемый файл галереи дубликатом не считаем */ }
      }
    }
    return found
  }

  const upload = (list: FileList | File[]): void => {
    const all = Array.from(list)
    const bad = all.find((file) => !isImageStudioPath(file.name))
    if (bad) {
      toast.error(`«${bad.name}» — не изображение; студия принимает png, jpg, webp, gif, svg`)
      return
    }
    if (!all.length) return
    void (async () => {
      // Имя приводим к пригодному для адресов заранее: «Снимок экрана 2026-09-04
      // в 12:31:05.png» ломал ссылки на кадр и публичную галерею.
      const renamedFor = new Map<string, string>()
      const cleaned = all.map((file) => {
        const safe = safeUploadName(file.name)
        if (safe === file.name) return file
        renamedFor.set(file.name, safe)
        return new File([file], safe, { type: file.type })
      })
      if (renamedFor.size) {
        const sample = [...renamedFor.entries()].slice(0, 2).map(([from, to]) => `«${from}» → «${to}»`).join(', ')
        toast.info(renamedFor.size === 1 ? `Имя поправлено: ${sample}` : `Имена поправлены (${renamedFor.size}): ${sample}…`)
      }
      // Очень большая картинка: предлагаем уменьшить сразу, иначе она съест
      // квоту и будет тормозить превью всей галереи.
      const huge: File[] = []
      for (const file of cleaned) {
        if (typeof createImageBitmap !== 'function' || file.type === 'image/svg+xml') continue
        try {
          const bitmap = await createImageBitmap(file)
          if (shouldDownscale(bitmap.width, bitmap.height)) huge.push(file)
          bitmap.close?.()
        } catch { /* битый файл поймает загрузка */ }
      }
      let shrinkHuge = false
      if (huge.length) {
        shrinkHuge = await confirm({
          title: huge.length === 1 ? `«${huge[0]!.name}» очень большая — уменьшить?` : `Очень больших картинок: ${huge.length} — уменьшить?`,
          message: `Длинная сторона больше ${DOWNSCALE_SIDE} px. «Уменьшить» приведёт её к ${DOWNSCALE_TARGET} px — этого хватает и для печати, и для веба. «Отмена» загрузит как есть.`,
          confirmLabel: 'Уменьшить'
        })
      }
      const bigOnes = cleaned.filter((file) => file.size > BIG_FILE_BYTES)
      if (bigOnes.length && !shrinkHuge) {
        toast.info(bigOnes.length === 1
          ? `«${bigOnes[0]!.name}» весит ${formatBytes(bigOnes[0]!.size)} — займёт заметную часть квоты`
          : `Тяжёлых файлов: ${bigOnes.length} — вместе ${formatBytes(bigOnes.reduce((sum, file) => sum + file.size, 0))}`)
      }
      // Дубликат — вопрос до всего остального: если человек его пропускает,
      // ни имена, ни квота для этого файла уже не важны.
      const duplicates = await findDuplicates(cleaned)
      let items = cleaned
      if (duplicates.size) {
        const pairs = [...duplicates.entries()].map(([from, to]) => `«${from}» = «${to}»`).join(', ')
        const keepCopies = await confirm({
          title: duplicates.size === 1 ? 'Такая картинка уже есть в галерее' : `Уже есть в галерее: ${duplicates.size} из ${cleaned.length}`,
          message: `${pairs}. «Загрузить копию» добавит ещё один файл, «Отмена» пропустит совпадения.`,
          confirmLabel: 'Загрузить копию'
        })
        if (!keepCopies) {
          items = cleaned.filter((file) => !duplicates.has(file.name))
          if (!items.length) {
            toast.info(cleaned.length === 1 ? 'Эта картинка уже есть в галерее — ничего не загружено' : 'Все выбранные картинки уже есть в галерее')
            return
          }
        }
      }
      // Совпадение имён — вопрос ДО начала загрузки: молчаливая перезапись
      // уничтожила бы существующий файл без корзины.
      const taken = new Set((files ?? []).map((item) => item.path))
      const clashes = items.filter((file) => taken.has(file.name))
      let replace = false
      if (clashes.length) {
        replace = await confirm({
          title: clashes.length === 1 ? `«${clashes[0]!.name}» уже есть — заменить?` : `${clashes.length} имён уже заняты — заменить файлы?`,
          message: '«Заменить» перезапишет существующие; «Отмена» сохранит загружаемые копиями с номером.',
          confirmLabel: 'Заменить'
        })
      }
      // Квота считается ДО первого запроса: иначе половина файлов уляжется, а
      // остальные упадут по 413-му, и виноватым выглядит последний.
      const occupied = (files ?? []).reduce((sum, item) => sum + item.size, 0)
      const freedByReplace = replace
        ? clashes.reduce((sum, file) => sum + ((files ?? []).find((item) => item.path === file.name)?.size ?? 0), 0)
        : 0
      const incoming = items.reduce((sum, file) => sum + file.size, 0)
      if (occupied - freedByReplace + incoming > IMAGE_STUDIO_LIMITS.maxConversationBytes) {
        const free = Math.max(0, IMAGE_STUDIO_LIMITS.maxConversationBytes - occupied + freedByReplace)
        const message = `Не хватит места: нужно ${formatBytes(incoming)}, свободно ${formatBytes(free)}. Удалите ненужное в галерее.`
        setLastError(message)
        toast.error(message)
        return
      }
      await run(async () => {
        let done = 0
        for (const file of items) {
          // Счётчик в секундомере: при пяти файлах молчащий спиннер пугает.
          if (items.length > 1) setProgress({ label: `Загружаем ${done + 1} из ${items.length}: ${file.name}`, seconds: 0 })
          const prepared = shrinkHuge && huge.includes(file) ? await downscaleTo(file, DOWNSCALE_TARGET) : file
          const shrunk = await shrinkOversized(prepared)
          if (!shrunk) throw new Error(`«${file.name}» слишком большой (лимит ${formatBytes(IMAGE_STUDIO_LIMITS.maxFileBytes)}), и сжать его не вышло`)
          const name = !replace && taken.has(shrunk.name) ? copyName(shrunk.name, taken) : shrunk.name
          taken.add(name)
          const buffer = await shrunk.blob.arrayBuffer()
          let binary = ''
          const bytes = new Uint8Array(buffer)
          for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
          await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary) })
          done += 1
        }
      }, items.length === 1 ? `Загружено: ${items[0]!.name}` : `Загружено файлов: ${items.length}`,
        items.length > 1 ? `Загружаем ${items.length} файла(ов)` : undefined)
    })()
  }

  const readBase64 = (path: string): Promise<string> =>
    api['imgstudio:read']({ conversationId, path }).then(({ dataBase64 }) => dataBase64)

  const blobOf = (path: string): Promise<Blob> =>
    readBase64(path).then((dataBase64) => {
      const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
      return new Blob([bytes], { type: imageStudioMime(path) })
    })

  const download = (path: string): Promise<void> =>
    blobOf(path).then((blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = path
      link.click()
      URL.revokeObjectURL(url)
    }).catch((error) => { toast.error(error instanceof Error ? error.message : String(error)) })

  const downloadAll = (list: ImageStudioFile[]): void => {
    void (async () => {
      try {
        // Один ZIP вместо лавины скачиваний: браузеру и пользователю так проще.
        // На двух десятках файлов сборка занимает секунды, поэтому она
        // отчитывается: молчащая кнопка читается как «ничего не произошло».
        const entries = [] as Array<{ name: string; data: Uint8Array }>
        for (const [index, file] of list.entries()) {
          if (list.length > 1) setProgress({ label: `Собираем архив: ${index + 1} из ${list.length}`, seconds: 0 })
          const dataBase64 = await readBase64(file.path)
          entries.push({ name: file.path, data: Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0)) })
        }
        // Промпты — текстом рядом с картинками: архив самодостаточен.
        const promptLines = list.filter((file) => file.prompt).map((file) => `${file.path}: ${file.prompt}`)
        if (promptLines.length) entries.push({ name: 'prompts.txt', data: new TextEncoder().encode(promptLines.join('\n')) })
        // Полные метаданные — для программной обработки архива. Заметки и
        // звёзды живут только в браузере, поэтому в архиве им самое место:
        // иначе смысл подборки теряется при передаче кому-то ещё.
        const meta = list.map((file) => ({
          ...file,
          ...(notes[file.path] ? { note: notes[file.path] } : {}),
          ...(stars.has(file.path) ? { starred: true } : {}),
          // Готовность — такая же браузерная пометка, как звезда и заметка:
          // без неё подборка уезжает коллеге без главного признака.
          ...(statuses[file.path] ? { status: statuses[file.path] } : {})
        }))
        entries.push({ name: 'metadata.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) })
        const url = URL.createObjectURL(buildZip(entries))
        const link = document.createElement('a')
        link.href = url
        link.download = 'галерея.zip'
        link.click()
        URL.revokeObjectURL(url)
        toast.success(list.length === 1 ? 'Архив собран' : `Архив собран: ${list.length} файл(ов)`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setProgress(null)
      }
    })()
  }

  const copy = (file: ImageStudioFile): void => {
    void blobOf(file.path)
      .then((blob) => copyImage(blob))
      .catch(() => false)
      .then((ok) => (ok ? toast.success('Скопировано в буфер') : toast.error('Не удалось скопировать — браузер не разрешил доступ к буферу')))
  }

  const transform = (file: ImageStudioFile, kind: (typeof IMAGE_TRANSFORMS)[number]): void => {
    void run(async () => {
      const blob = await blobOf(file.path)
      const result = await applyImageTransform(blob, kind.kind)
      const name = transformName(file.path, kind.suffix, new Set((files ?? []).map((item) => item.path)), kind.ext ?? 'png')
      const buffer = new Uint8Array(await result.arrayBuffer())
      let binary = ''
      for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
      await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: file.path })
      setLastCreated(name)
      setToolsFor(null)
    }, `Готово: ${kind.label.toLowerCase()}`)
  }

  const duplicate = (file: ImageStudioFile): void => {
    void run(async () => {
      const dataBase64 = await readBase64(file.path)
      const name = copyName(file.path, new Set((files ?? []).map((item) => item.path)))
      await api['imgstudio:upload']({ conversationId, path: name, dataBase64, source: file.path })
    }, 'Копия создана')
  }

  if (failed) return <div className="image-studio"><ErrorState message="Не удалось загрузить галерею — чат недоступен или удалён" onRetry={() => void reload()} /></div>
  if (!files) return <div className="image-studio"><Skeleton variant="list" count={3} item="block" height={96} gap={10} /></div>

  const usedBytes = files.reduce((sum, file) => sum + file.size, 0)
  /** Сколько условий отбора включено: и для «Сбросить», и для свёрнутой строки. */
  const activeFilterCount = [
    Boolean(filter.trim()), Boolean(kindFilter), Boolean(originFilter), Boolean(markFilter),
    Boolean(activeSet), Boolean(shapeFilter), Boolean(heavyFilter), Boolean(familyOf),
    starsOnly, freshOnly, sinceVisitOnly, dayOnly, Boolean(tintOf)
  ].filter(Boolean).length
  const fileExt = (path: string): string => path.toLowerCase().split('.').pop() ?? ''
  // Типы, которые реально лежат в галерее: селект с пятью пунктами, из которых
  // четыре ничего не находят, только мешает.
  const presentKinds = [...new Set(files.map((file) => fileExt(file.path)))].sort()
  const shown = files
    .filter((file) => !kindFilter || fileExt(file.path) === kindFilter)
    // «Нарисованные» — с промптом (модель), «производные» — результат обработки
    // (есть source, но нет промпта), «свои» — ни того, ни другого.
    .filter((file) => {
      if (!originFilter) return true
      if (originFilter === 'ai') return Boolean(file.prompt)
      if (originFilter === 'derived') return Boolean(file.source) && !file.prompt
      return !file.prompt && !file.source
    })
    .filter((file) => {
      if (!markFilter) return true
      if (markFilter === 'noted') return Boolean(notes[file.path])
      // «Неразобранное» — ни звезды, ни заметки, ни готовности: именно с этого
      // начинают уборку большой галереи.
      if (markFilter === 'none') return !stars.has(file.path) && !notes[file.path] && !statuses[file.path]
      return statuses[file.path] === markFilter
    })
    .filter((file) => !activeSet || (sets[activeSet] ?? []).includes(file.path))
    .filter((file) => !freshOnly || fresh.has(file.path))
    .filter((file) => !sinceVisitOnly || file.updatedAt > seenAt)
    .filter((file) => !starsOnly || stars.has(file.path))
    .filter((file) => !heavyFilter || file.size > Number(heavyFilter) * 1024 * 1024)
    .filter((file) => !familyOf || versionFamily(files, familyOf).includes(file.path))
    .filter((file) => !pickedOnly || !multi || multi.has(file.path))
    .filter((file) => !dayOnly || Date.now() - file.updatedAt < 24 * 60 * 60 * 1000)
    // «Похожие по цвету»: оставляем кадры, чей средний цвет близок к образцу.
    // Порог 60 подобран на глаз — дальше начинается «просто тёплые».
    .filter((file) => {
      if (!tintOf) return true
      const sample = tints[tintOf]
      const own = tints[file.path]
      return !sample || !own || colorDistance(sample, own) <= 60
    })
    // Размер известен не у всех: неизвестные остаются видимыми (см. shapeFilter).
    .filter((file) => !shapeFilter || shapeOf(dimensions[file.path]) === null || shapeOf(dimensions[file.path]) === shapeFilter)
    // Искать по промпту так же естественно, как по имени: «где был кит» —
    // это про содержание картинки, а имя у неё часто автоматическое.
    .filter((file) => matchesQuery(filter.trim(), [file.path, file.prompt, notes[file.path]]))
    .sort((left, right) => {
      if (order === 'name') return left.path.localeCompare(right.path, 'ru', { numeric: true })
      if (order === 'size') return right.size - left.size
      // «По разрешению» — по площади в пикселях; неизвестный размер (превью ещё
      // не загрузилось) даёт ноль и уезжает в конец, а не в случайное место.
      if (order === 'pixels' && pixelsOf(dimensions[left.path]) !== pixelsOf(dimensions[right.path])) {
        return pixelsOf(dimensions[right.path]) - pixelsOf(dimensions[left.path])
      }
      // «Сначала избранные»: внутри группы порядок обычный, по свежести.
      if (order === 'stars' && stars.has(left.path) !== stars.has(right.path)) return stars.has(left.path) ? -1 : 1
      // «По цвету» — по оттенку среднего цвета: так рядом оказываются кадры
      // одной гаммы, а не одного размера. Незасчитанные уходят в конец.
      if (order === 'tint') {
        const leftTint = tints[left.path]
        const rightTint = tints[right.path]
        if (Boolean(leftTint) !== Boolean(rightTint)) return leftTint ? -1 : 1
        if (leftTint && rightTint && colorHue(leftTint) !== colorHue(rightTint)) return colorHue(leftTint) - colorHue(rightTint)
      }
      if (order === 'noted' && Boolean(notes[left.path]) !== Boolean(notes[right.path])) return notes[left.path] ? -1 : 1
      if (order === 'ready') {
        // Готовые вперёд, черновики следом, неотмеченные в конце.
        const rank = (path: string): number => statuses[path] === 'ready' ? 0 : statuses[path] === 'draft' ? 1 : 2
        if (rank(left.path) !== rank(right.path)) return rank(left.path) - rank(right.path)
      }
      return right.updatedAt - left.updatedAt
    })
  // Разворот делаем после сортировки, а не отдельным критерием: иначе каждое
  // сравнение обросло бы знаком, и «сначала избранные» перестало бы работать.
  if (reversed) shown.reverse()
  // Зеркало отфильтрованного списка для эффектов: они срабатывают после
  // рендера, а `shown` — локальная переменная рендера, до неё им не дотянуться.
  shownRef.current = shown
  // Сортировка «по цвету» без цветов бессмысленна: досчитываем их, как только
  // режим включили (партиями, чтобы не подвесить вкладку).
  if (order === 'tint') ensureTints(shown)
  const paged = shown.slice(0, Math.max(visibleCount, pageSize))
  /**
   * Окно видимых карточек. Включается от порога и только в обычной сетке:
   * в режиме групп строки разной длины, и одна высота строки там не работает.
   * Пока сетка не измерена (первый кадр, jsdom), рисуем всё — иначе экран
   * остался бы пустым.
   */
  const virtual = !grouped && paged.length >= VIRTUAL_THRESHOLD && metrics.rowHeight > 0
    ? gridWindow(paged.length, metrics.columns, metrics.rowHeight, viewport.top, viewport.height)
    : null
  const windowed = virtual ? paged.slice(virtual.from, virtual.to) : paged
  /** Поиск побайтовых дубликатов в галерее: читаем только файлы того же размера. */
  const findGalleryDuplicates = (): void => void (async () => {

        setBusy(true)
        setProgress({ label: 'Ищем дубликаты', seconds: 0 })
        try {
          // Читаем только тех, у кого размер совпал хоть с одним другим: у
          // остальных содержимое различается заведомо, а чтение — это запрос.
          const bySize = new Map<number, ImageStudioFile[]>()
          for (const file of files) {
            const list = bySize.get(file.size)
            if (list) list.push(file)
            else bySize.set(file.size, [file])
          }
          const candidates = [...bySize.values()].filter((list) => list.length > 1).flat()
          const keys = new Map<string, string>()
          await mapWithLimit(candidates, 4, async (file, index) => {
            setProgress({ label: `Сравниваем содержимое: ${index + 1} из ${candidates.length}`, seconds: 0 })
            try { keys.set(file.path, await readBase64(file.path)) } catch { /* нечитаемый файл не дубликат */ }
          })
          const groups = groupDuplicates(files, (file) => keys.get(file.path))
          const copies = groups.flatMap((group) => group.copies)
          if (!copies.length) { toast.info('Дубликатов нет — все картинки разные'); return }
          // Отмечаем именно копии: что удалять, решает человек.
          setMulti(new Set(copies))
          setAnnounce(`Найдено копий: ${copies.length}`)
          toast.success(`Нашлось копий: ${copies.length} в ${groups.length} групп(ах) — они отмечены`)
        } finally {
          setBusy(false)
          setProgress(null)
        }
  })()

  /** Проверка читаемости всех файлов галереи пачками по четыре. */
  const verifyFiles = (): void => void (async () => {

        setBusy(true)
        const batch = beginBatch(files.length)
        try {
          const bad: string[] = []
          await mapWithLimit(files, 4, async (file, index) => {
            if (batch.stop()) return
            batch.step(index + 1)
            setProgress({ label: `Проверяем файлы: ${index + 1} из ${files.length}`, seconds: 0 })
            try { await readBase64(file.path) } catch { bad.push(file.path) }
          })
          if (!bad.length) { toast.success(`Все файлы читаются (${files.length})`); return }
          // Битые помечаем в сетке — тогда видно, какие именно потерялись.
          setBroken((prev) => new Set([...prev, ...bad]))
          setLastError(`Не читаются файлы: ${bad.join(', ')}`)
          // Сразу отмечаем их: следующее действие после «нашлись битые» —
          // «удалить битые», и собирать их галочками вручную незачем.
          setMulti(new Set(bad))
          toast.error(`Не читаются файлы: ${bad.length} — они отмечены в сетке`)
        } finally {
          endBatch()
          setProgress(null)
          setBusy(false)
        }
  })()

  /**
   * Пакетные действия мультирежима. Собраны в один объект: строка действий
   * (`ImageStudioBatchBar`) только рисует кнопки, а вся работа со стором,
   * квотой и прерыванием остаётся здесь.
   */
  const batchActions: BatchActions = {
    onSelectAll: () => setMulti(new Set(shown.map((file) => file.path))),
    onInvert: () => setMulti((prev) => new Set(shown.filter((file) => !(prev ?? new Set()).has(file.path)).map((file) => file.path))),
    onDownload: () => downloadAll(shown.filter((file) => (multi ?? new Set()).has(file.path))),
    onToggleStars: (allStarred) => {
      const picked = multi
      if (!picked) return
      setStars((prev) => {
        const next = new Set(prev)
        for (const path of picked) { if (allStarred) next.delete(path); else next.add(path) }
        try { localStorage.setItem(imageStudioStarsKey(conversationId), JSON.stringify([...next])) } catch { /* приватный режим */ }
        return next
      })
      setAnnounce(allStarred ? `Убрано из избранного: ${picked.size}` : `В избранное добавлено: ${picked.size}`)
    },
    onNote: () => {
      const picked = multi
      const text = batchNote.trim()
      if (!picked || !text) return
      setNotes((prev) => {
        const next = { ...prev }
        for (const path of picked) next[path] = text
        try { localStorage.setItem(imageStudioNotesKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
        return next
      })
      setBatchNote('')
      toast.success(`Заметка поставлена файлам: ${picked.size}`)
    },
    onCollage: () => {
      const targets = shown.filter((file) => (multi ?? new Set()).has(file.path))
      // Коллаж — один PNG на всю сетку: оценим его как сумму исходников.
      const short = quotaShort(targets.reduce((sum, file) => sum + file.size, 0))
      if (short) { setLastError(short); toast.error(short); return }
      void run(async () => {
        const blobs = [] as Blob[]
        for (const [index, file] of targets.entries()) {
          setProgress({ label: `Читаем для коллажа: ${index + 1} из ${targets.length}`, seconds: 0 })
          blobs.push(await blobOf(file.path))
        }
        setProgress({ label: 'Собираем коллаж', seconds: 0 })
        const collage = await buildCollage(blobs)
        const name = freeName('коллаж', 'png', new Set(files.map((file) => file.path)))
        const buffer = new Uint8Array(await collage.arrayBuffer())
        let binary = ''
        for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
        await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary) })
        setLastCreated(name)
        setMulti(new Set())
      }, `Коллаж собран из ${targets.length} картинок`)
    },
    onRenameByTemplate: () => {
      const picked = multi
      if (!picked) return
      const targets = shown.filter((file) => picked.has(file.path)).map((file) => file.path)
      const plan = renamePlan(renameTemplate.trim(), targets)
      const others = new Set(files.map((file) => file.path).filter((path) => !picked.has(path)))
      const clash = plan.find((step) => others.has(step.to))
      if (clash) { toast.error(`«${clash.to}» уже занято другим файлом — измените шаблон`); return }
      void run(async () => {
        await applyRenamePlan(plan)
        setLastRename(plan)
        setMulti(new Set())
        setRenameTemplate('')
        if (selected && targets.includes(selected)) setSelected(null)
      }, `Переименовано файлов: ${plan.length}`)
    },
    onRenameByPrompt: () => {
      const picked = multi
      if (!picked?.size) return
      // Имя из промпта читается лучше «изображение-7.png», а промпт у файла уже
      // есть — переносим его в имя тем же правилом, что при рисовании.
      const taken = new Set(files.map((file) => file.path))
      const plan: Array<{ from: string; to: string }> = []
      for (const file of shown.filter((item) => picked.has(item.path))) {
        if (!file.prompt) continue
        const base = nameFromPrompt(file.prompt)
        if (!base) continue
        const ext = file.path.toLowerCase().split('.').pop() ?? 'png'
        const wanted = base.replace(/\.png$/, `.${ext}`)
        // `copyName` всегда дописывает «-копия» — он про дубликаты. Здесь имя
        // нужно как есть, и только при совпадении отходим в сторону.
        const target = taken.has(wanted) ? copyName(wanted, taken) : wanted
        if (target === file.path) continue
        taken.add(target)
        plan.push({ from: file.path, to: target })
      }
      if (!plan.length) { toast.info('У выбранных нет промптов, из которых взять имя'); return }
      void (async () => {
        if (!(await confirm({
          title: `Переименовать по промпту: ${plan.length}?`,
          message: `${plan.slice(0, 2).map((step) => `«${step.from}» → «${step.to}»`).join(', ')}${plan.length > 2 ? ` и ещё ${plan.length - 2}` : ''}.`,
          confirmLabel: 'Переименовать'
        }))) return
        if (await run(() => applyRenamePlan(plan), `Переименовано по промпту: ${plan.length}`)) {
          setLastRename(plan)
          remember(`Переименовано по промпту: ${plan.length}`, () => void run(() => applyRenamePlan(plan.map((step) => ({ from: step.to, to: step.from }))), 'Имена возвращены'))
          setMulti(new Set())
        }
      })()
    },
    onRepeatTransform: () => { if (lastTransform) batchActions.onTransform(lastTransform) },
    onTransform: (kindName) => {
      const kind = IMAGE_TRANSFORMS.find((item) => item.kind === kindName)
      if (!kind) return
      // Запоминаем обработку, чтобы «Ещё раз» повторил её на новом выборе:
      // одну и ту же подгонку обычно применяют к нескольким пачкам подряд.
      setLastTransform(kindName)
      const targets = shown.filter((file) => (multi ?? new Set()).has(file.path))
      // Результат обработки весит примерно как исходник — этой оценки хватает,
      // чтобы не начинать пакет, которому заведомо некуда ложиться.
      const short = quotaShort(targets.reduce((sum, file) => sum + file.size, 0))
      if (short) { setLastError(short); toast.error(short); return }
      const batch = beginBatch(targets.length)
      void run(async () => {
        const created: string[] = []
        try {
          let done = 0
          for (const file of targets) {
            if (batch.stop()) { toast.info(`Прервано: обработано ${done} из ${targets.length}`); break }
            if (targets.length > 1) setProgress({ label: `Обрабатываем ${done + 1} из ${targets.length}: ${file.path}`, seconds: 0 })
            done += 1
            batch.step(done)
            const blob = await blobOf(file.path)
            const result = await applyImageTransform(blob, kind.kind)
            const name = transformName(file.path, kind.suffix, new Set(files.map((item) => item.path).concat(created)), kind.ext ?? 'png')
            const buffer = new Uint8Array(await result.arrayBuffer())
            let binary = ''
            for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
            await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: file.path })
            created.push(name)
          }
          setMulti(new Set())
          // Двадцать новых файлов одним нажатием стоит уметь убрать тем же.
          if (created.length) setLastBatchCreated(created)
        } finally {
          endBatch()
        }
      }, `Обработано файлов: ${targets.length} (${kind.label.toLowerCase()})`)
    },
    onReferences: () => {
      const picked = multi
      const cleaned = prompt.trim()
      if (!picked) return
      if (!cleaned) { toast.info('Сначала опишите в поле промпта, что нарисовать'); promptRef.current?.focus(); return }
      const refs = [...picked]
      rememberPrompt(cleaned)
      const launch = (): Promise<boolean> => run(async () => {
        await api['imgstudio:generate']({ conversationId, prompt: cleaned, references: refs, ...(nameFromPrompt(cleaned) ? { name: nameFromPrompt(cleaned) } : {}) })
        setPrompt('')
        try { localStorage.removeItem(imageStudioDraftKey(conversationId)) } catch { /* приватный режим */ }
        setMulti(null)
        setPickedOnly(false)
      }, 'Изображение готово', `Модель рисует по ${refs.length} референс(ам)`)
      setLastAttempt(() => launch)
      void launch()
    },
    onEditBatch: () => {
      const picked = multi
      const cleaned = prompt.trim()
      if (!picked) return
      if (!cleaned) { toast.info('Сначала опишите в поле промпта, что изменить'); promptRef.current?.focus(); return }
      const targets = shown.filter((file) => picked.has(file.path)).map((file) => file.path)
      rememberPrompt(cleaned)
      const batch = beginBatch(targets.length)
      void run(async () => {
        try {
          let done = 0
          for (const path of targets) {
            // Каждая правка — отдельный ран модели на минуту-две, поэтому
            // «Прервать пакет» здесь важнее, чем где-либо ещё.
            if (batch.stop()) { toast.info(`Прервано: поправлено ${done} из ${targets.length}`); break }
            setProgress({ label: `Модель правит ${done + 1} из ${targets.length}: ${path}`, seconds: 0 })
            await api['imgstudio:edit']({ conversationId, path, prompt: cleaned })
            done += 1
            batch.step(done)
          }
          setMulti(new Set())
          setPrompt('')
          try { localStorage.removeItem(imageStudioDraftKey(conversationId)) } catch { /* приватный режим */ }
        } finally {
          endBatch()
        }
      }, `Правка применена к выбранным (${targets.length})`)
    },
    onCompare: () => {
      const picked = [...(multi ?? new Set<string>())]
      if (picked.length < 2) return
      if (picked.length > 2) {
        // Шторка сравнивает два кадра; для трёх-четырёх нужна сетка.
        setCompareGrid(picked)
        setCompareWith(null)
        setViewing(picked[0]!)
        setCompare(true)
        return
      }
      setCompareGrid(null)
      setCompareWith(picked[0]!)
      setViewing(picked[1]!)
      setCompare(true)
    },
    onTransfer: (target, copyMode) => {
      const picked = multi
      if (!picked || !target) return
      const moved = [...picked]
      void run(async () => {
        for (const path of moved) {
          const { name } = await api['imgstudio:transfer']({ conversationId, path, to: target, copy: copyMode })
          copyMarksTo(target, path, name, !copyMode)
        }
        if (!copyMode && selected && picked.has(selected)) setSelected(null)
        setMulti(new Set())
      }, copyMode ? `Скопировано файлов: ${moved.length}` : `Перенесено файлов: ${moved.length}`)
    },
    // Подпись пачкой: именем файла (контрольный лист) или одной строкой на всех
    // (черновик клиенту, водяной знак). Разница — только в тексте, поэтому и
    // действие одно с необязательным текстом.
    onCaptionNames: (text?: string) => {
      const targets = shown.filter((file) => (multi ?? new Set()).has(file.path))
      const short = quotaShort(targets.reduce((sum, file) => sum + file.size, 0))
      if (short) { setLastError(short); toast.error(short); return }
      const batch = beginBatch(targets.length)
      void run(async () => {
        const created: string[] = []
        try {
          for (const [index, file] of targets.entries()) {
            if (batch.stop()) { toast.info(`Прервано: подписано ${index} из ${targets.length}`); break }
            setProgress({ label: `Подписываем ${index + 1} из ${targets.length}: ${file.path}`, seconds: 0 })
            batch.step(index + 1)
            const blob = await blobOf(file.path)
            const result = await captionImage(blob, text?.trim() ? text.trim() : file.path)
            const name = transformName(file.path, 'подпись', new Set(files.map((item) => item.path).concat(created)))
            const buffer = new Uint8Array(await result.arrayBuffer())
            let binary = ''
            for (let position = 0; position < buffer.length; position += 1) binary += String.fromCharCode(buffer[position]!)
            await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: file.path })
            created.push(name)
          }
          setMulti(new Set())
          if (created.length) setLastBatchCreated(created)
        } finally {
          endBatch()
        }
      }, `Подписано файлов: ${targets.length}`)
    },
    onShowPicked: () => {
      setPickedOnly((prev) => !prev)
      setVisibleCount(PAGE_SIZE)
    },
    onRemoveFromSet: (name) => {
      const picked = multi
      if (!picked || picked.size === 0) return
      const rest = (sets[name] ?? []).filter((path) => !picked.has(path))
      // Набор без файлов — это не набор: он бы остался пустой строкой в
      // фильтрах и в списке, и его пришлось бы удалять вручную.
      const next = { ...sets }
      if (rest.length) next[name] = rest
      else delete next[name]
      saveSets(next)
      toast.success(rest.length ? `Из «${name}» убрано: ${(sets[name] ?? []).length - rest.length}` : `Набор «${name}» опустел и удалён`)
    },
    onAttachBatch: onAttachToChat
      ? () => {
          const targets = shown.filter((file) => (multi ?? new Set()).has(file.path))
          if (!targets.length) return
          void (async () => {
            try {
              for (const file of targets) {
                const blob = await blobOf(file.path)
                onAttachToChat(new File([blob], file.path, { type: blob.type }))
              }
              toast.success(`К сообщению прикреплено: ${targets.length}`)
            } catch {
              toast.error('Не удалось прочитать файлы')
            }
          })()
        }
      : null,
    onDuplicateBatch: () => {
      const targets = shown.filter((file) => (multi ?? new Set()).has(file.path))
      if (!targets.length) return
      const short = quotaShort(targets.reduce((sum, file) => sum + file.size, 0))
      if (short) { setLastError(short); toast.error(short); return }
      const batch = beginBatch(targets.length)
      void run(async () => {
        const created: string[] = []
        try {
          for (const [index, file] of targets.entries()) {
            if (batch.stop()) { toast.info(`Прервано: скопировано ${index} из ${targets.length}`); break }
            setProgress({ label: `Копируем ${index + 1} из ${targets.length}: ${file.path}`, seconds: 0 })
            batch.step(index + 1)
            const dataBase64 = await readBase64(file.path)
            // Занятые имена копим сами: список файлов обновится только после
            // перезагрузки, и вторая копия иначе встала бы на то же имя.
            const name = copyName(file.path, new Set(files.map((item) => item.path).concat(created)))
            await api['imgstudio:upload']({ conversationId, path: name, dataBase64, source: file.path })
            created.push(name)
          }
          setMulti(new Set())
          if (created.length) setLastBatchCreated(created)
        } finally {
          endBatch()
        }
      }, `Копий создано: ${targets.length}`)
    },
    onSetStatus: (status) => {
      const picked = multi
      if (!picked || picked.size === 0) return
      setStatuses((prev) => {
        const next = { ...prev }
        for (const path of picked) next[path] = status
        try { localStorage.setItem(imageStudioStatusKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
        return next
      })
      setAnnounce(status === 'ready' ? `Отмечено готовыми: ${picked.size}` : `Отмечено черновиками: ${picked.size}`)
      toast.success(status === 'ready' ? `Готовыми отмечено: ${picked.size}` : `Черновиками отмечено: ${picked.size}`)
    },
    onClearMarks: () => {
      const picked = multi
      if (!picked || picked.size === 0) return
      const paths = [...picked]
      // Одним действием снимаем всё локальное: звезду, заметку и готовность.
      dropMarks(paths)
      setStatuses((prev) => {
        if (!paths.some((path) => prev[path])) return prev
        const next = { ...prev }
        for (const path of paths) delete next[path]
        try { localStorage.setItem(imageStudioStatusKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
        return next
      })
      toast.success(`Пометки сняты: ${paths.length}`)
    },
    onAddToSet: (name) => {
      const picked = multi
      if (!picked || !sets[name]) return
      // Набор — множество: повторное добавление не должно плодить дубли.
      const merged = [...new Set([...sets[name]!, ...picked])]
      saveSets({ ...sets, [name]: merged })
      toast.success(`В набор «${name}» добавлено: ${merged.length - sets[name]!.length}`)
    },
    onSaveSet: () => {
      const picked = multi
      const name = setName.trim()
      if (!picked || !name) return
      saveSets({ ...sets, [name]: [...picked] })
      setSetName('')
      toast.success(`Набор «${name}» сохранён (${picked.size})`)
    },
    onCopyPrompts: () => {
      const picked = multi
      if (!picked) return
      const lines = shown.filter((file) => picked.has(file.path) && file.prompt).map((file) => `${file.path}: ${file.prompt}`)
      if (!lines.length) { toast.info('У выбранных нет промптов — это загруженные или обработанные файлы'); return }
      void navigator.clipboard?.writeText(lines.join('\n'))
        .then(() => toast.success(`Промпты скопированы (${lines.length})`))
        .catch(() => toast.error('Буфер обмена недоступен'))
    },
    onDownloadArchive: () => {
      const picked = multi
      if (!picked) return
      downloadAll(shown.filter((file) => picked.has(file.path)))
    },
    onDelete: () => void (async () => {
      const picked = multi
      if (!picked || picked.size === 0) return
      if (!(await confirm({ title: `Удалить ${picked.size} файл(ов)?`, message: 'Файлы уедут в корзину — вернуть их можно оттуда или кнопкой «Вернуть».', confirmLabel: 'Удалить' }))) return
      const doomed = [...picked]
      const ok = await run(async () => {
        for (const path of doomed) await api['imgstudio:delete']({ conversationId, path })
      })
      setLastDeleted(doomed)
      if (ok) {
        const undo = (): void => void run(async () => {
          for (const path of doomed) await api['imgstudio:restore']({ conversationId, name: path })
        }, `Возвращено файлов: ${doomed.length}`)
        remember(`Удалено файлов: ${doomed.length}`, undo)
        toast.success(`Удалено файлов: ${doomed.length}`, { action: { label: 'Вернуть', onClick: undo } })
        setAnnounce(`Удалено файлов: ${doomed.length}`)
      }
      setMulti(new Set())
      if (selected && picked.has(selected)) setSelected(null)
    })()
  }

  /**
   * Карточка галереи. Вынесена в функцию, потому что сетка теперь рисуется
   * либо одним списком, либо секциями по датам — а разметка карточки одна.
   */
              const renderCard = (file: ImageStudioFile): JSX.Element => <div role="listitem" key={file.path} data-path={file.path} className={`image-studio-card${selected === file.path ? ' image-studio-card--selected' : ''}${flash === file.path ? ' image-studio-card--flash' : ''}`}
                // Двойной клик по карточке — на весь экран: так ведут себя все
                // проводники и галереи, и пользователи пробовали это первым.
                onDoubleClick={(event) => { event.stopPropagation(); setViewing(file.path) }}
                onContextMenu={(event) => {
                  // Правый клик — короткий путь к частым действиям: иконок в
                  // строке карточки четыре, остальное — в этом меню.
                  event.preventDefault()
                  setMenu({ path: file.path, x: event.clientX, y: event.clientY })
                }}>
              <button type="button" className="image-studio-thumb" aria-label={file.path} aria-pressed={selected === file.path} onClick={() => setSelected(selected === file.path ? null : file.path)} onDoubleClick={() => setViewing(file.path)} title={selected === file.path ? 'Снять выбор (двойной клик — на весь экран)' : 'Выбрать для правки (двойной клик — на весь экран)'}>
                {previews[file.path]
                  ? <img loading="lazy" src={previews[file.path]} alt="" onLoad={(event) => {
                      const img = event.currentTarget
                      if (img.naturalWidth) setDimensions((prev) => prev[file.path] === `${img.naturalWidth}×${img.naturalHeight}` ? prev : { ...prev, [file.path]: `${img.naturalWidth}×${img.naturalHeight}` })
                    }} />
                  : broken.has(file.path)
                    ? <span className="image-studio-thumb-loading" role="status">превью не загрузилось</span>
                    : <span className="image-studio-thumb-loading" role="status" aria-label={`Превью ${file.path} загружается`}>
                        {/* Многоточие в квадрате читалось как «файл битый»;
                            скелетон повторяет геометрию карточки и объясняет,
                            что картинка ещё едет. */}
                        <Skeleton variant="block" height="100%" />
                      </span>}
                {fresh.has(file.path) && <span className="image-studio-fresh" aria-label="Новая картинка" title={`Появилась ${relativeTime(file.updatedAt)} — нажмите, чтобы оставить в сетке только новое`} onClick={(event) => { event.stopPropagation(); setFreshOnly(true); setVisibleCount(PAGE_SIZE) }}>новое</span>}
                {/* Точка «в наборе»: иначе принадлежность подборке видна только
                    в свойствах, и собранный набор легко разобрать случайно. */}
                {Object.values(sets).some((list) => list.includes(file.path)) && <span className="image-studio-in-set" aria-hidden="true" />}
              </button>
              {multi && <label className="image-studio-check">
                <input type="checkbox" aria-label={`Выбрать ${file.path}`} checked={multi.has(file.path)} onClick={(event) => {
                  // Shift+клик отмечает всё от предыдущего клика до этого: на
                  // двадцати файлах щёлкать по одному — не работа.
                  if (!event.shiftKey || !lastPicked.current || lastPicked.current === file.path) return
                  event.preventDefault()
                  const from = shown.findIndex((item) => item.path === lastPicked.current)
                  const to = shown.findIndex((item) => item.path === file.path)
                  if (from < 0 || to < 0) return
                  const range = shown.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.path)
                  setMulti((prev) => new Set([...(prev ?? []), ...range]))
                  lastPicked.current = file.path
                }} onChange={(event) => {
                  lastPicked.current = file.path
                  setMulti((prev) => { const next = new Set(prev); if (event.target.checked) next.add(file.path); else next.delete(file.path); return next })
                }} />
                выбрать
              </label>}
              {broken.has(file.path) && <Button size="sm" variant="ghost" onClick={() => void reload()}>Перечитать превью</Button>}
              {renaming?.from === file.path
                ? (() => {
                  // Пользователь стёр расширение — дописываем исходное, а не
                  // заставляем вспоминать, что имя должно быть картинкой.
                  const typed = renaming.to.trim()
                  const target = typed && !isImageStudioPath(typed) ? `${typed}${file.path.slice(file.path.lastIndexOf('.'))}` : typed
                  // Ошибку показываем до запроса: сервер проверяет то же, но
                  // после его отказа поле закрывалось и имя терялось.
                  const error = renameError(target, new Set(files.map((item) => item.path).filter((path) => path !== file.path)))
                  const apply = (): void => void (async () => {
                    const from = file.path
                    const ok = await run(async () => {
                      await api['imgstudio:rename']({ conversationId, from, to: target })
                      moveMarks(from, target)
                      setRenaming(null)
                      if (selected === from) setSelected(target)
                    })
                    if (!ok) return
                    // Переименование бьёт по ссылкам и памяти: «а как оно
                    // называлось?» — вопрос через минуту, а не через день.
                    const undoRename = (): void => void run(async () => {
                      await api['imgstudio:rename']({ conversationId, from: target, to: from })
                      moveMarks(target, from)
                      if (selected === target) setSelected(from)
                    }, `Имя «${from}» возвращено`)
                    remember(`«${from}» → «${target}»`, undoRename)
                    toast.success(`Теперь «${target}»`, { action: { label: 'Вернуть имя', onClick: undoRename } })
                  })()
                  return <div className="image-studio-rename">
                    <input
                      ref={renameRef}
                      aria-label="Новое имя файла"
                      aria-invalid={error ? true : undefined}
                      value={renaming.to}
                      onChange={(event) => setRenaming({ from: file.path, to: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenaming(null)
                        if (event.key === 'Enter' && !error) { event.preventDefault(); apply() }
                      }}
                    />
                    <Button size="sm" disabled={busy || Boolean(error)} title={error ?? 'Переименовать'} onClick={apply}>Ок</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Отмена</Button>
                    {error && <span className="image-studio-rename-error" role="alert">{error}</span>}
                  </div>
                })()
                : <div className="image-studio-meta">
                    <span role="button" tabIndex={0} aria-label={`Скопировать имя ${file.path}`} className="image-studio-name"
                      // Двойной клик по имени — переименовать: так делают все
                      // проводники. Всплытие гасим: на карточке двойной клик
                      // открывает лайтбокс, и без этого случалось и то, и то.
                      onDoubleClick={(event) => { event.stopPropagation(); event.preventDefault(); setRenaming({ from: file.path, to: file.path }) }} title={`${file.path} · ${formatBytes(file.size)}${dimensions[file.path] ? ` · ${dimensions[file.path]}` : ''}\nОбновлён: ${new Date(file.updatedAt).toLocaleString('ru-RU')} (${relativeTime(file.updatedAt)})${file.tookMs ? `\nСгенерировано за ${Math.round(file.tookMs / 1000)} с` : ''}${file.prompt ? `\nПромпт: ${file.prompt}` : ''}${notes[file.path] ? `\nЗаметка: ${notes[file.path]}` : ''}${file.source ? `\nИз: ${file.source}` : ''}\nКлик — скопировать имя, двойной клик — переименовать`}
                      onClick={() => { void navigator.clipboard?.writeText(file.path).then(() => toast.success('Имя скопировано')).catch(() => undefined) }}
                      onKeyDown={(event) => { if (event.key === 'Enter') { void navigator.clipboard?.writeText(file.path).then(() => toast.success('Имя скопировано')).catch(() => undefined) } }}>
                      {filter.trim()
                        ? highlightParts(file.path, filter.trim()).map((part, index) => part.hit
                            ? <mark key={index} className="image-studio-hit">{part.text}</mark>
                            : <span key={index}>{part.text}</span>)
                        : file.path}
                      {dimensions[file.path] && <small className="image-studio-dim"> {dimensions[file.path]}{aspectLabel(dimensions[file.path]!) ? ` · ${aspectLabel(dimensions[file.path]!)}` : ''}</small>}
                      {file.source && <small className="image-studio-dim image-studio-source"> из {file.source}</small>}
                      {/* Предупреждение появляется только у уже прочитанных
                          файлов: специально читать всю галерею ради значка
                          дорого, зато после открытия свойств оно остаётся. */}
                      {/* Заметка потеряла свою кнопку в ряду действий (он ушёл
                          в меню), но след о ней остаётся видимым — иначе
                          заметка снова живёт только в тултипе. */}
                      {notes[file.path] && <small className="image-studio-dim" title={notes[file.path]} aria-label={`Заметка: ${notes[file.path]}`}> 🗒</small>}
                      {factsCache.current.get(file.path)?.mismatch && <small className="image-studio-warn" title={factsCache.current.get(file.path)?.mismatch ?? ''} aria-label={factsCache.current.get(file.path)?.mismatch ?? ''}> ⚠</small>}
                    </span>
                    <span className="image-studio-card-actions">
                      {phone
                        ? <IconButton size="sm" aria-label={`Действия ${file.path}`} title="Действия" onClick={(event) => {
                            const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            setMenu({ path: file.path, x: Math.round(box.left), y: Math.round(box.bottom + 4) })
                          }}>⋯</IconButton>
                        : <>
                      <IconButton size="sm" aria-label={stars.has(file.path) ? `Убрать ${file.path} из избранного` : `В избранное ${file.path}`} title={stars.has(file.path) ? 'Убрать из избранного' : 'В избранное'} aria-pressed={stars.has(file.path)} onClick={() => toggleStar(file.path)}>{stars.has(file.path) ? '★' : '☆'}</IconButton>
                      {!dense && <IconButton
                        size="sm"
                        aria-label={statuses[file.path] === 'ready' ? `${file.path}: готово — снять пометку` : statuses[file.path] === 'draft' ? `${file.path}: черновик — отметить готовым` : `Отметить ${file.path} черновиком`}
                        title={statuses[file.path] === 'ready' ? 'Готово' : statuses[file.path] === 'draft' ? 'Черновик' : 'Готовность: не отмечено'}
                        onClick={() => cycleStatus(file.path)}
                      >{statuses[file.path] === 'ready' ? '✔' : statuses[file.path] === 'draft' ? '✎' : '◦'}</IconButton>}
                      <IconButton size="sm" aria-label={`Открыть ${file.path} в полный размер`} title="В полный размер" onClick={() => setViewing(file.path)}>⛶</IconButton>
                      {/* Мелкая карточка — 104 px: там и три иконки тесно, поэтому
                          готовность и удаление живут только в меню. */}
                      {!dense && <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void (async () => {
                        if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
                        await deleteOne(file.path)
                        if (selected === file.path) setSelected(null)
                      })()}>✕</IconButton>}
                      {/* Круги улучшений довели ряд до десяти иконок, и имя
                          файла в карточке ужималось до нуля. На виду остаются
                          четыре частых действия, остальные — в том же меню,
                          что и на телефоне. */}
                      <IconButton size="sm" aria-label={`Действия ${file.path}`} title="Ещё действия (клавиша m)" onClick={(event) => {
                        const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                        setMenu({ path: file.path, x: Math.round(box.left), y: Math.round(box.bottom + 4) })
                      }}>⋯</IconButton>
                        </>}
                    </span>
                  </div>}
              {toolsFor === file.path && !renaming && <ImageStudioToolsRow
                file={file}
                busy={busy}
                otherChats={otherChats ?? []}
                onDownload={(path) => void download(path)}
                onCopy={copy}
                onDuplicate={duplicate}
                onTransform={transform}
                onCopyDeepLink={(item) => {
                  const link = `${location.origin}${location.pathname}#/images/${conversationId}/${encodeURIComponent(item.path)}`
                  void navigator.clipboard?.writeText(link).then(() => toast.success('Ссылка на кадр в буфере')).catch(() => toast.info(link))
                }}
                onOpenTab={(item) => {
                  // Своей вкладке нужен URL, живущий дольше вызова: blob-URL из
                  // превью подходит, а авторизованный путь к файлу — нет (там 401).
                  const url = previews[item.path]
                  if (!url) { toast.info('Превью ещё не загрузилось'); return }
                  window.open(url, '_blank', 'noopener')
                }}
                onCopyDataUri={(item) => void readBase64(item.path).then((dataBase64) => {
                  const uri = `data:${imageStudioMime(item.path)};base64,${dataBase64}`
                  return navigator.clipboard?.writeText(uri).then(() => toast.success(`data-URI скопирован (${formatBytes(uri.length)})`))
                }).catch(() => toast.error('Не удалось прочитать файл'))}
                onCaption={(item, text) => void run(async () => {
                  const blob = await blobOf(item.path)
                  const result = await captionImage(blob, text)
                  const name = transformName(item.path, 'подпись', new Set((files ?? []).map((entry) => entry.path)))
                  const buffer = new Uint8Array(await result.arrayBuffer())
                  let binary = ''
                  for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
                  await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: item.path })
                  setLastCreated(name)
                  setToolsFor(null)
                }, 'Подпись нанесена новым файлом')}
                {...(typeof shareUrl === 'string' ? {
                  onCopyLink: (item: ImageStudioFile) => {
                    // Публичная страница отдаёт файлы по тому же токену: ссылка
                    // на конкретную картинку нужна, чтобы показать одну, а не всё.
                    const link = `${location.origin}${shareUrl}file?path=${encodeURIComponent(item.path)}`
                    void navigator.clipboard?.writeText(link).then(() => toast.success('Ссылка на файл в буфере')).catch(() => toast.info(link))
                  }
                } : {})}
                onTransfer={(item, to, copyMode) => void run(async () => {
                  const { name } = await api['imgstudio:transfer']({ conversationId, path: item.path, to, copy: copyMode })
                  // Звезда и заметка едут вместе с картинкой: в новом чате она
                  // иначе выглядела бы чужой и непомеченной.
                  copyMarksTo(to, item.path, name, !copyMode)
                  if (!copyMode && selected === item.path) setSelected(null)
                  setToolsFor(null)
                }, copyMode ? 'Скопировано в другой чат' : 'Перенесено в другой чат')}
              />}
              </div>

  const viewingIndex = viewing ? shown.findIndex((file) => file.path === viewing) : -1
  /**
   * Открытый кадр может выпасть из отбора: сузили поиск, включили фильтр,
   * получили результат обработки. Раньше в этом случае стрелки молчали, а
   * счётчик «N из M» исчезал — картинка висела в никуда. Листаем по всей
   * галерее: человек видит именно её, а не отбор.
   */
  const viewList = viewingIndex >= 0 ? shown : (files ?? [])
  const viewListIndex = viewingIndex >= 0 ? viewingIndex : viewList.findIndex((file) => file.path === viewing)
  const viewStep = (delta: number): void => {
    if (viewListIndex < 0 || !viewList.length) return
    const next = viewList[(viewListIndex + delta + viewList.length) % viewList.length]
    if (next) setViewing(next.path)
  }

  return <div
    ref={paneRef}
    className={`image-studio${dropActive ? ' image-studio--drop' : ''}${printMode ? ' image-studio--print' : ''}`}
    data-testid="image-studio"
    onDoubleClick={(event) => {
      // Клик мимо карточек — «снять выбор»: раньше для этого искали крестик
      // в чипе или жали Esc, стоя в поле промпта.
      const target = event.target as HTMLElement
      if (target.closest('.image-studio-card') || target.closest('.image-studio-toolbar') || target.closest('.image-studio-filter')) return
      if (selected) setSelected(null)
    }}
    onScroll={(event) => {
      scheduleViewport()
      try { sessionStorage.setItem(imageStudioScrollKey(conversationId), String(Math.round(event.currentTarget.scrollTop))) } catch { /* приватный режим */ }
    }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true) } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false) }}
    onDrop={(event) => { event.preventDefault(); setDropActive(false); if (event.dataTransfer.files.length) upload(event.dataTransfer.files) }}
    onPaste={(event) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
      if (!images.length) return
      event.preventDefault()
      // У скриншота из буфера имя «image.png» — даём времязависимое, чтобы не плодить «-2».
      upload(images.map((file, index) => new File([file], file.name && file.name !== 'image.png' ? file.name : `вставка-${Date.now()}${index ? `-${index}` : ''}.png`, { type: file.type })))
    }}
    onKeyDown={(event) => {
      // Delete на выбранной карточке — то же удаление, что и крестиком.
      if (event.key === 'Escape' && multi) { setMulti(null); setPickedOnly(false); return }
      // ⌘/Ctrl+Z — отменить последнее необратимое: тост с «Вернуть» живёт
      // недолго, а рука тянется к привычной комбинации.
      if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const typedIn = (event.target as HTMLElement).tagName
        if (typedIn === 'TEXTAREA' || typedIn === 'INPUT') return
        if (lastDeleted?.length) {
          event.preventDefault()
          const names = lastDeleted
          setLastDeleted(null)
          void run(async () => {
            for (const path of names) await api['imgstudio:restore']({ conversationId, name: path })
          }, `Возвращено файлов: ${names.length}`)
          return
        }
        if (lastRename?.length) {
          event.preventDefault()
          const plan = lastRename
          setLastRename(null)
          void run(() => applyRenamePlan(plan.map((step) => ({ from: step.to, to: step.from }))), `Имена возвращены: ${plan.length}`)
          return
        }
        return
      }
      // ⌘F — общесистемное «найти»: пусть работает и здесь, рядом с «/».
      if (event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        filterRef.current?.focus()
        return
      }
      // ⌘A вне мультирежима включает его и отмечает всё видимое: иначе
      // приходилось сначала искать кнопку «Выбрать несколько».
      if (!multi && event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)) {
        const tag = (event.target as HTMLElement).tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        event.preventDefault()
        setMulti(new Set(shown.map((file) => file.path)))
        setAnnounce(`Выбрано файлов: ${shown.length}`)
        return
      }
      if (multi && event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setMulti(new Set(shown.map((file) => file.path)))
        return
      }
      const tag = (event.target as HTMLElement).tagName
      const typing = tag === 'TEXTAREA' || tag === 'INPUT'
      // Shift+F10 и клавиша «меню» — системные способы позвать контекстное
      // меню; на карточке они должны работать так же, как правый клик.
      if (!typing && selected && ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) {
        event.preventDefault()
        openMenuForSelected()
        return
      }
      // Буквенные хоткеи — только вне полей ввода и без модификаторов: иначе
      // «u» в промпте открывало бы выбор файла посреди слова.
      if (!typing && !renaming && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === '/') { event.preventDefault(); filterRef.current?.focus(); return }
        if (event.key.toLowerCase() === 'u') { event.preventDefault(); uploadRef.current?.click(); return }
        if (event.key.toLowerCase() === 'm' && selected) {
          // Клавиатурный вход в контекстное меню: без него меню оставалось
          // доступным только мышью, а все остальные действия панели — нет.
          event.preventDefault()
          openMenuForSelected()
          return
        }
        if (event.key.toLowerCase() === 'g') { event.preventDefault(); setGrouped((prev) => !prev); return }
        if (event.key.toLowerCase() === 'b') {
          event.preventDefault()
          setGridBg((prev) => {
            const next = prev === 'checker' ? 'light' : prev === 'light' ? 'dark' : 'checker'
            try { localStorage.setItem(IMAGE_STUDIO_GRID_BG_KEY, next) } catch { /* приватный режим */ }
            return next
          })
          return
        }
        if (event.key.toLowerCase() === 'o') { event.preventDefault(); toggleFit(); return }
        if (event.key.toLowerCase() === 'f' && selected) { event.preventDefault(); toggleStar(selected); return }
        if (event.key.toLowerCase() === 'd' && selected) {
          event.preventDefault()
          const file = files.find((item) => item.path === selected)
          if (file) duplicate(file)
          return
        }
        if (event.key.toLowerCase() === 'e' && selected) {
          // «Править»: выбор уже сделан, остаётся написать, что менять.
          event.preventDefault()
          promptRef.current?.focus()
          return
        }
        // Цифра — сохранённый вид по порядку: у кого их три-четыре, тот
        // переключается между ними десятки раз за сессию.
        if (/^[1-9]$/.test(event.key)) {
          const names = Object.keys(views)
          const name = names[Number(event.key) - 1]
          if (name && views[name]) {
            event.preventDefault()
            applyView(views[name]!)
            toast.success(`Вид «${name}»`)
          }
          return
        }
        if (event.key === 'F' && event.shiftKey) {
          event.preventDefault()
          setStarsOnly((prev) => !prev)
          setVisibleCount(PAGE_SIZE)
          return
        }
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault()
          void reload()
          setAnnounce('Галерея обновлена')
          return
        }
        if (event.key.toLowerCase() === 't') {
          event.preventDefault()
          setTrashOpen((prev) => { if (!prev) void refreshTrash(); return !prev })
          return
        }
        if (event.key.toLowerCase() === 'v') {
          event.preventDefault()
          setViewName('')
          setViewsOpen(true)
          return
        }
        if (event.key.toLowerCase() === 'i' && selected) {
          // «Что это за файл» — частый вопрос: открываем просмотр с уже
          // раскрытыми свойствами, а не заставляем искать кнопку ⓘ.
          event.preventDefault()
          setPropsRequested(true)
          setViewing(selected)
          return
        }
        if (event.key === 'F2' && selected) {
          // F2 — общесистемное «переименовать»: в проводниках и таблицах она
          // делает именно это, и пробовали её первой.
          event.preventDefault()
          setRenaming({ from: selected, to: selected })
          return
        }
        if (event.key.toLowerCase() === 'n' && selected) {
          event.preventDefault()
          setNoteFor({ path: selected, text: notes[selected] ?? '' })
          return
        }
        if (event.key.toLowerCase() === 'p' && selected) {
          // Промпт выбранной — в поле: так «нарисуй похожее, но…» начинается с
          // готового текста, а не с попыток вспомнить формулировку.
          const source = files.find((file) => file.path === selected)?.prompt
          if (source) { event.preventDefault(); setPrompt(source); setSelected(null); promptRef.current?.focus() }
          return
        }
        if (event.key.toLowerCase() === 's' && selected) { event.preventDefault(); void download(selected); return }
        if (event.key.toLowerCase() === 'c' && selected) {
          event.preventDefault()
          copy(files.find((file) => file.path === selected) ?? { path: selected, size: 0, updatedAt: 0 })
          return
        }
      }
      // Клавиатурная навигация по сетке: без неё выбрать картинку можно только
      // мышью, а весь остальной сценарий (правка, Delete) уже клавиатурный.
      // Home/End/PageUp/PageDown добавлены потому, что стрелками до конца
      // тысячной галереи не дойти: это ровно те клавиши, которыми листают
      // любой длинный список.
      // Shift+стрелки в мультирежиме расширяют выделение, как в списках
      // файлов: до этого диапазон можно было отметить только Shift+кликом.
      if (multi && event.shiftKey && (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')) {
        const anchorIndex = shown.findIndex((file) => file.path === (selected ?? lastPicked.current))
        if (anchorIndex >= 0) {
          const template = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns : ''
          const columns = Math.max(1, template.split(' ').filter(Boolean).length)
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : event.key === 'ArrowUp' ? -columns : 0
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, anchorIndex + step))
          event.preventDefault()
          const picked = rangeBetween(anchorIndex, target).map((index) => shown[index]?.path).filter((path): path is string => Boolean(path))
          setMulti((prev) => new Set([...(prev ?? []), ...picked]))
          const focusPath = shown[target]?.path
          if (focusPath) {
            setSelected(focusPath)
            revealCard(focusPath, target)
          }
          return
        }
      }
      const jumps = ['Home', 'End', 'PageDown', 'PageUp']
      if (!typing && !renaming && shown.length && (event.key.startsWith('Arrow') || jumps.includes(event.key))) {
        const template = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns : ''
        const columns = Math.max(1, template.split(' ').filter(Boolean).length)
        // «Страница» — экран строк: измеренная высота строки есть не всегда
        // (первый кадр, jsdom), тогда берём три строки как разумный шаг.
        const pageRows = metrics.rowHeight > 0 && paneRef.current
          ? Math.max(2, Math.floor(paneRef.current.clientHeight / metrics.rowHeight))
          : 3
        const step = event.key === 'ArrowRight' ? 1
          : event.key === 'ArrowLeft' ? -1
          : event.key === 'ArrowDown' ? columns
          : event.key === 'ArrowUp' ? -columns
          : event.key === 'PageDown' ? columns * pageRows
          : event.key === 'PageUp' ? -columns * pageRows
          : 0
        const current = selected ? shown.findIndex((file) => file.path === selected) : -1
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? shown.length - 1
          : current < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, current + step))
        const path = shown[next]?.path
        if (!path) return
        event.preventDefault()
        setSelected(path)
        revealCard(path, next)
        return
      }
      // Enter на выбранной карточке — то же, что двойной клик по превью.
      if (!typing && !renaming && event.key === 'Enter' && selected) {
        event.preventDefault()
        setViewing(selected)
        return
      }
      // В мультирежиме Delete относится к выбранным: одиночный выбор и пачка —
      // одно и то же действие в голове пользователя, и клавиша должна быть та же.
      if ((event.key === 'Delete' || event.key === 'Backspace') && multi?.size && !renaming && (event.target as HTMLElement).tagName !== 'TEXTAREA' && (event.target as HTMLElement).tagName !== 'INPUT') {
        event.preventDefault()
        batchActions.onDelete()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !renaming && (event.target as HTMLElement).tagName !== 'TEXTAREA' && (event.target as HTMLElement).tagName !== 'INPUT') {
        event.preventDefault()
        void (async () => {
          if (!(await confirm({ title: `Удалить «${selected}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
          const path = selected
          setSelected(null)
          await deleteOne(path)
          promptRef.current?.focus()
        })()
      }
    }}
  >
    {/* Рамка при перетаскивании говорила «сюда можно», но не говорила, что
        случится: подсказка называет действие прямо. */}
    {dropActive && <div className="image-studio-drop-hint" role="status">Отпустите файлы — добавим в галерею</div>}
    <div className="image-studio-toolbar">
      {/* Панель рисования сворачивается: когда разбираешь готовую галерею, поле
          промпта с настройками занимает экран впустую. Баннеры прогресса и
          отмены остаются видимыми — они про уже запущенное. */}
      <Button size="sm" variant="ghost" className="image-studio-composer-toggle" aria-expanded={composerOpen} title={composerOpen ? 'Скрыть панель рисования' : 'Показать панель рисования'} onClick={() => setComposerOpen((prev) => {
        try { localStorage.setItem(IMAGE_STUDIO_COMPOSER_KEY, prev ? '0' : '1') } catch { /* приватный режим */ }
        return !prev
      })}>
        {composerOpen ? '▾ Рисование' : '▸ Рисование'}
      </Button>
      {composerOpen && <>
      <textarea
        ref={promptRef}
        aria-label="Промпт для изображения"
        rows={2}
        placeholder={selected ? `Что изменить в «${selected}»…` : 'Что нарисовать…'}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value)
          // Черновик переживает переключение чатов — как в композере.
          try {
            if (event.target.value) localStorage.setItem(imageStudioDraftKey(conversationId), event.target.value)
            else localStorage.removeItem(imageStudioDraftKey(conversationId))
          } catch { /* приватный режим */ }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); generate() }
          // Esc — «выйти из режима правки», не покидая поля.
          if (event.key === 'Escape' && selected) { event.preventDefault(); setSelected(null) }
        }}
      />
      {selected && <p className="image-studio-selected-chip">
        {previews[selected] && <img src={previews[selected]} alt="" />}
        <span>правим: {selected}</span>
        <button type="button" className="image-studio-cancel" aria-label="Снять выбор картинки" onClick={() => setSelected(null)}>×</button>
      </p>}
      {/* Строка под полем появляется с первым символом: слова и «Очистить»
          полезны всегда, а счётчик символов — только когда лимит близко. */}
      {prompt.length > 0 && <p className={`image-studio-progress${prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars ? ' image-studio-quota--warn' : ''}`}>
        {prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars * 0.2 && `${prompt.length} / ${IMAGE_STUDIO_LIMITS.maxPromptChars}`}
        {prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars * 0.2 && ' · '}слов: {prompt.trim().split(/\s+/).filter(Boolean).length}
        {prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars ? ' — промпт слишком длинный' : ''}
        {' '}
        {/* Очистить поле одним нажатием: длинный промпт иначе выделяют руками. */}
        <button type="button" className="image-studio-cancel" onClick={() => { setPrompt(''); try { localStorage.removeItem(imageStudioDraftKey(conversationId)) } catch { /* приватный режим */ } promptRef.current?.focus() }}>Очистить</button>
      </p>}
      {(pinned.length > 0 || recent.length > 0) && !prompt && <div className="image-studio-recent" aria-label="Недавние промпты">
        {/* Поиск по истории появляется, когда чипов больше десятка: глазами в
            них уже не найти «того самого кота в шляпе». */}
        {recent.length > 10 && <input
          className="image-studio-filename"
          aria-label="Поиск по истории промптов"
          placeholder="искать в истории…"
          value={promptSearch}
          onChange={(event) => setPromptSearch(event.target.value)}
        />}
        {pinned.map((text) => <span key={`pin-${text}`} className="image-studio-chip image-studio-chip--pinned">
          <button type="button" className="image-studio-chip-text" title={text} onClick={() => { setPrompt(text); promptRef.current?.focus() }}>★ {text.length > 36 ? `${text.slice(0, 36)}…` : text}</button>
          <button type="button" className="image-studio-chip-pin" aria-label={`Открепить промпт: ${text.slice(0, 40)}`} title="Открепить" onClick={() => togglePin(text)}>×</button>
        </span>)}
        {recent.filter((text) => !pinned.includes(text)).filter((text) => matchesQuery(promptSearch.trim(), [text])).map((text) => <span key={text} className="image-studio-chip">
          <button type="button" className="image-studio-chip-text" title={text} onClick={() => { setPrompt(text); promptRef.current?.focus() }}>{text.length > 36 ? `${text.slice(0, 36)}…` : text}</button>
          <button type="button" className="image-studio-chip-pin" aria-label={`Закрепить промпт: ${text.slice(0, 40)}`} title="Закрепить" onClick={() => togglePin(text)}>☆</button>
        </span>)}
        {recent[0] && !selected && <button type="button" className="image-studio-chip image-studio-chip--pinned" title={`Повторить: ${recent[0]}`} onClick={() => {
          // «Ещё раз» — самый частый жест после неудачной картинки: тот же
          // промпт, новый результат. Раньше приходилось искать чип и жать
          // «Нарисовать» вторым движением.
          setPrompt(recent[0]!)
          generate(recent[0]!)
        }}>↻ Ещё раз</button>}
        {recent.length > 0 && <button type="button" className="image-studio-chip" aria-label="Очистить историю промптов" title="Очистить историю" onClick={() => { setRecent([]); try { localStorage.removeItem(imageStudioPromptsKey(conversationId)) } catch { /* приватный режим */ } }}>×</button>}
      </div>}
      <div className="image-studio-actions">
        <Button size="sm" disabled={busy || !prompt.trim() || prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars} loading={busy} title={`⌘Enter / Ctrl+Enter${prompt.trim() ? `\nУйдёт модели:\n${prompt.trim()}${style && !selected ? `\nСтиль: ${style}.` : ''}${size && !selected ? `\nРазмер изображения: ${size.replace('×', 'x')}` : ''}${negative.trim() && !selected ? `\nНе должно быть: ${negative.trim()}.` : ''}${noText ? '\nНе добавляй на изображение никакой текст…' : ''}` : ''}`} onClick={() => generate()}>
          {selected ? 'Изменить выбранную' : 'Нарисовать'}
        </Button>
        {!selected && <select aria-label="Стиль изображения" value={style} disabled={busy} onChange={(event) => { setStyle(event.target.value); try { localStorage.setItem(imageStudioStyleKey(conversationId), event.target.value); localStorage.setItem(IMAGE_STUDIO_STYLE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {STYLE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Стиль: авто' : preset}</option>)}
        </select>}
        {!selected && <select aria-label="Размер изображения" value={size} disabled={busy} onChange={(event) => { setSize(event.target.value); try { localStorage.setItem(imageStudioSizeKey(conversationId), event.target.value); localStorage.setItem(IMAGE_STUDIO_SIZE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {SIZE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Размер: авто' : preset === '1200×630' ? '1200×630 (OG-превью)' : preset === '1080×1080' ? '1080×1080 (пост)' : preset === '1280×720' ? '1280×720 (обложка)' : preset === '1080×1350' ? '1080×1350 (портрет)' : preset === '1500×500' ? '1500×500 (баннер)' : preset}</option>)}
        </select>}
        {/* Пресет запроса: одним выбором ставит стиль, размер, негатив и запрет
            надписей. Виден только когда есть что выбрать или что запомнить. */}
        {!selected && (Object.keys(recipes).length > 0 || style || size || negative.trim() || noText) && <span className="image-studio-rename-batch">
          {Object.keys(recipes).length > 0 && <select aria-label="Пресет запроса" disabled={busy} value="" onChange={(event) => {
            const [mode, name] = event.target.value.split(':', 2)
            if (!name) return
            if (mode === 'drop') {
              const next = { ...recipes }
              delete next[name]
              saveRecipes(next)
              return
            }
            const recipe = recipes[name]
            if (!recipe) return
            applyRecipe(recipe)
            toast.success(`Пресет «${name}»`)
          }}>
            <option value="">Пресет запроса…</option>
            <optgroup label="Применить">
              {Object.keys(recipes).map((name) => <option key={`use:${name}`} value={`use:${name}`}>{name}</option>)}
            </optgroup>
            <optgroup label="Удалить">
              {Object.keys(recipes).map((name) => <option key={`drop:${name}`} value={`drop:${name}`}>{name}</option>)}
            </optgroup>
          </select>}
          <input aria-label="Имя пресета запроса" placeholder="имя пресета…" value={recipeName} onChange={(event) => setRecipeName(event.target.value)} />
          <Button size="sm" variant="ghost" disabled={!recipeName.trim()} title="Запомнить нынешние стиль, размер, негатив и «без текста»" onClick={() => {
            saveRecipes({ ...recipes, [recipeName.trim()]: { style, size, negative: negative.trim(), noText } })
            setRecipeName('')
            toast.success('Пресет запроса запомнен')
          }}>Запомнить пресет</Button>
        </span>}
        <label className="image-studio-check" title="Дописывает к промпту запрет на надписи">
          <input type="checkbox" checked={noText} onChange={(event) => { setNoText(event.target.checked); try { localStorage.setItem(IMAGE_STUDIO_NO_TEXT_KEY, event.target.checked ? '1' : '0') } catch { /* приватный режим */ } }} />
          без текста
        </label>
        {/* Поле запретов с четырьмя чипами занимало строку композера всегда,
            хотя заполняют его редко: кнопка показывает, сколько запретов
            включено, и раскрывает список по требованию. */}
        {!selected && <Button size="sm" variant="ghost" aria-expanded={negativeOpen} aria-controls="image-studio-negative" title="Чего не должно быть на картинке" onClick={() => setNegativeOpen((prev) => {
          const next = !prev
          try { localStorage.setItem(IMAGE_STUDIO_NEGATIVE_OPEN_KEY, next ? '1' : '0') } catch { /* приватный режим */ }
          return next
        })}>
          {negativeOpen ? 'Скрыть запреты' : `Без…${negative.split(',').map((part) => part.trim()).filter(Boolean).length ? ` (${negative.split(',').map((part) => part.trim()).filter(Boolean).length})` : ''}`}
        </Button>}
        {!selected && negativeOpen && <span className="image-studio-negative" id="image-studio-negative">
          <input className="image-studio-filename" aria-label="Чего не должно быть на картинке" placeholder="без чего: текст, люди…" value={negative} disabled={busy} onChange={(event) => { setNegative(event.target.value); try { localStorage.setItem(imageStudioNegativeKey(conversationId), event.target.value); localStorage.setItem(IMAGE_STUDIO_NEGATIVE_KEY, event.target.value) } catch { /* приватный режим */ } }} />
          {NEGATIVE_PRESETS.map((preset) => {
            const parts = negative.split(',').map((part) => part.trim()).filter(Boolean)
            const on = parts.includes(preset)
            return <button
              key={preset}
              type="button"
              className={`image-studio-chip${on ? ' image-studio-chip--pinned' : ''}`}
              aria-pressed={on}
              title={on ? `Убрать «${preset}» из запрета` : `Добавить «${preset}» в запрет`}
              onClick={() => {
                const next = (on ? parts.filter((part) => part !== preset) : [...parts, preset]).join(', ')
                setNegative(next)
                try { localStorage.setItem(imageStudioNegativeKey(conversationId), next); localStorage.setItem(IMAGE_STUDIO_NEGATIVE_KEY, next) } catch { /* приватный режим */ }
              }}
            >{on ? '✓ ' : ''}{preset}</button>
          })}
        </span>}
        {!selected && <input className="image-studio-filename" aria-label="Имя нового файла" placeholder="имя.png (не обязательно)" value={fileName} disabled={busy} onChange={(event) => setFileName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); generate() } }} />}
        {api['prompt:suggest'] && <IconButton size="sm" aria-label="Улучшить промпт с помощью AI" title="Улучшить промпт" disabled={busy || !prompt.trim()} onClick={() => void (async () => {
          const current = prompt.trim()
          try {
            const { variants } = await api['prompt:suggest']!({ prompt: current, modifiers: [{ id: 'image-studio', title: 'Промпт для картинки', text: 'Сделай из этого детальный промпт для генерации изображения: композиция, стиль, цвета, фон. Верни только сам промпт, одним абзацем, по-русски.', enabled: true }] })
            const improved = variants[0]?.text.trim()
            if (!improved) { toast.info('AI не предложил вариант'); return }
            rememberPrompt(current) // прежний промпт остаётся чипом — «отмена» в один клик
            setPrompt(improved)
            promptRef.current?.focus()
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
          }
        })()}>✨</IconButton>}
        <Button size="sm" variant="ghost" title="Каркасы промптов с переменными: «{объект} в стиле акварели»" onClick={() => { setTemplateName(''); setTemplateFill(null); setTemplateOpen(true) }}>
          Шаблоны…{Object.keys(templates).length ? ` (${Object.keys(templates).length})` : ''}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>Загрузить…</Button>
        {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Снять выбор</Button>}
        <input ref={uploadRef} type="file" accept="image/*,.svg" multiple hidden aria-label="Файл изображения" onChange={(event) => { if (event.target.files?.length) upload(event.target.files); event.target.value = '' }} />
      </div>
      </>}
      {progress && <p className="image-studio-progress" role="status">
        {progress.label}… {progress.seconds} с. {(() => {
          const usual = usualSeconds(files)
          // Своя статистика вместо «до минуты»: у одного чата картинка выходит
          // за восемь секунд, у другого за сорок, и общая фраза врёт обоим.
          if (usual && progress.seconds > usual * 2 + 10) return `Дольше обычного (обычно ~${usual} с) — можно отменить и упростить промпт.`
          if (usual) return `Обычно ~${usual} с.`
          return progress.seconds > 90 ? 'Дольше обычного — можно отменить и упростить промпт.' : 'Обычно это занимает до минуты.'
        })()}
        {' '}
        <button type="button" className="image-studio-cancel" onClick={() => void api['imgstudio:cancel']({ conversationId }).catch(() => undefined)}>Отменить</button>
        {batchTotal !== null && <>
          {' · '}
          <button type="button" className="image-studio-cancel" onClick={() => { abortBatch.current = true }}>Прервать пакет</button>
        </>}
      </p>}
      {batchTotal !== null && batchDone !== null && <span className="image-studio-batch-bar" role="presentation" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.round(batchDone / Math.max(1, batchTotal) * 100))}%` }} />
      </span>}
      <span className="vc-sr-only" role="status">{announce}</span>
      {lastCreated && !busy && <p className="image-studio-progress" role="status">
        Создано: {lastCreated}{' '}
        <button type="button" className="image-studio-cancel" onClick={() => {
          const path = lastCreated
          setLastCreated(null)
          void run(() => api['imgstudio:delete']({ conversationId, path }), `«${path}» отменён (лежит в корзине)`)
        }}>Отменить</button>
      </p>}
      {lastDeleted && !busy && <p className="image-studio-progress" role="status">
        Удалено файлов: {lastDeleted.length}{' '}
        <button type="button" className="image-studio-cancel" onClick={() => {
          const names = lastDeleted
          setLastDeleted(null)
          // Удаление мягкое, поэтому «вернуть» — это восстановление из корзины.
          void run(async () => {
            for (const name of names) await api['imgstudio:restore']({ conversationId, name })
          }, `Возвращено файлов: ${names.length}`)
        }}>Вернуть</button>
      </p>}
      {lastBatchCreated && !busy && <p className="image-studio-progress" role="status">
        Создано обработкой: {lastBatchCreated.length}{' '}
        <button type="button" className="image-studio-cancel" onClick={() => {
          const names = lastBatchCreated
          setLastBatchCreated(null)
          void run(async () => {
            for (const name of names) await api['imgstudio:delete']({ conversationId, path: name })
          }, `Результаты убраны (${names.length})`)
        }}>Убрать результаты</button>
      </p>}
      {lastRename && !busy && <p className="image-studio-progress" role="status">
        Переименовано файлов: {lastRename.length}{' '}
        <button type="button" className="image-studio-cancel" onClick={() => {
          const plan = lastRename
          setLastRename(null)
          // Откат — тот же план наоборот, поэтому и он проходит через временные имена.
          void run(() => applyRenamePlan(plan.map((step) => ({ from: step.to, to: step.from }))), 'Имена возвращены')
        }}>Вернуть имена</button>
      </p>}
      {lastError && !busy && <ErrorState compact message={lastError} {...(lastAttempt ? { onRetry: () => { setLastError(null); lastAttempt() } } : {})} />}
    </div>

    {/* Шесть селектов отбора подряд читаются как стена — и на телефоне они
        занимали пол-экрана. Ящик «Отбор» свёрнут по умолчанию: включённые
        условия видно чипами, а поиск, порядок и группы остаются на виду. */}
    {files.length >= 2 && <div className="image-studio-filter">
      <ImageStudioFilters
        expanded={filtersOpen}
        onToggleExpanded={() => setFiltersOpen((prev) => {
          const next = !prev
          try { localStorage.setItem(IMAGE_STUDIO_FILTERS_KEY, next ? '1' : '0') } catch { /* приватный режим */ }
          return next
        })}
        showSearch={files.length >= FILTER_THRESHOLD}
        searchRef={filterRef}
        query={filter}
        onQuery={(value) => { setFilter(value); setVisibleCount(PAGE_SIZE) }}
        found={filter.trim() ? shown.length : null}
        activeCount={activeFilterCount}
        onReset={() => {
          setFilter('')
          setKindFilter('')
          setOriginFilter('')
          setMarkFilter('')
          setActiveSet('')
          setShapeFilter('')
          setHeavyFilter('')
          setFamilyOf(null)
          setTintOf(null)
          setDayOnly(false)
          setStarsOnly(false)
          // Порядок и группы — тоже «вид»: после «сбросить» ожидают исходный
          // экран, а не прежнюю сортировку с новым отбором.
          setOrder('new')
          setReversed(false)
          setGrouped(false)
          setAnnounce('Все условия отбора сняты')
          setFreshOnly(false)
          setSinceVisitOnly(false)
          setVisibleCount(PAGE_SIZE)
        }}
        showOrigin={files.some((file) => file.prompt) && files.some((file) => !file.prompt)}
        origin={originFilter}
        onOrigin={(value) => { setOriginFilter(value); setVisibleCount(PAGE_SIZE) }}
        mark={markFilter}
        onMark={(value) => { setMarkFilter(value); setVisibleCount(PAGE_SIZE) }}
        dayCount={files.filter((file) => Date.now() - file.updatedAt < 24 * 60 * 60 * 1000).length}
        dayOnly={dayOnly}
        onDayOnly={() => { setDayOnly((prev) => !prev); setVisibleCount(PAGE_SIZE) }}
        missed={seenAt ? files.filter((file) => file.updatedAt > seenAt).length : 0}
        sinceVisitOnly={sinceVisitOnly}
        onSinceVisitOnly={() => { setSinceVisitOnly((prev) => !prev); setVisibleCount(PAGE_SIZE) }}
        onFoldAll={grouped ? () => {
          const titles = groupByDay(paged).map((group) => group.title)
          // Кнопка одна и делает противоположное текущему: свёрнуто хоть что-то —
          // «развернуть все», иначе «свернуть все».
          foldGroups(titles.some((title) => collapsedGroups.has(title)) ? new Set() : new Set(titles))
        } : null}
        allFolded={grouped && groupByDay(paged).every((group) => collapsedGroups.has(group.title))}
        grouped={grouped}
        onGrouped={() => setGrouped((prev) => !prev)}
        freshCount={fresh.size}
        freshOnly={freshOnly}
        onFreshOnly={() => { setFreshOnly((prev) => !prev); setVisibleCount(PAGE_SIZE) }}
        kinds={presentKinds}
        kind={kindFilter}
        onKind={(value) => { setKindFilter(value); setVisibleCount(PAGE_SIZE) }}
        setNames={Object.keys(sets)}
        setFilter={activeSet}
        onSetFilter={(value) => { setActiveSet(value); setVisibleCount(PAGE_SIZE) }}
        shape={shapeFilter}
        onShape={(value) => { setShapeFilter(value); setVisibleCount(PAGE_SIZE) }}
        heavy={heavyFilter}
        onHeavy={(value) => { setHeavyFilter(value); setVisibleCount(PAGE_SIZE) }}
        shownBytes={shown.length && shown.length < files.length ? formatBytes(shown.reduce((sum, file) => sum + file.size, 0)) : null}
        conditions={activeFilterCount ? viewSummary(currentView()) : null}
        shown={shown.length}
        total={files.length}
        order={order}
        onOrder={(next) => {
          setOrder(next as typeof order)
          try { localStorage.setItem(IMAGE_STUDIO_ORDER_KEY, next) } catch { /* приватный режим */ }
        }}
        reversed={reversed}
        onToggleReversed={() => setReversed((prev) => !prev)}
      />
      {tintProgress > 0 && <p className="image-studio-progress" role="status">Считаем цвета кадров… осталось {tintProgress}</p>}
      {tintOf && <p className="image-studio-progress" role="status">
        Показаны кадры близкой гаммы к «{tintOf}»{' '}
        <button type="button" className="image-studio-cancel" onClick={() => { setTintOf(null); setVisibleCount(PAGE_SIZE) }}>Показать всё</button>
      </p>}
      {familyOf && <p className="image-studio-progress" role="status">
        Показаны все версии «{familyOf}»{' '}
        <button type="button" className="image-studio-cancel" onClick={() => { setFamilyOf(null); setVisibleCount(PAGE_SIZE) }}>Показать всё</button>
      </p>}
      <ImageStudioShareBar
        url={shareUrl}
        views={shareViews}
        views7={shareViews7}
        passwordProtected={shareProtected}
        busy={busy}
        onPublish={() => void api['imgstudio:publish']({ conversationId }).then(({ url }) => {
          setShareUrl(url)
          const absolute = `${location.origin}${url}`
          void navigator.clipboard?.writeText(absolute).then(() => toast.success('Опубликовано — ссылка в буфере')).catch(() => toast.success(`Опубликовано: ${absolute}`))
        }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}
        onCopyLink={() => {
          const absolute = `${location.origin}${shareUrl ?? ''}`
          void navigator.clipboard?.writeText(absolute).then(() => toast.success('Ссылка в буфере')).catch(() => toast.info(absolute))
        }}
        onOpenPage={() => { if (shareUrl) window.open(shareUrl, '_blank', 'noopener') }}
        onPassword={() => { setViewerPassword(''); setPasswordDialog(true) }}
        onUnpublish={() => void (async () => {
          if (!(await confirm({ title: 'Снять публикацию галереи?', message: 'Публичная ссылка перестанет открываться.', confirmLabel: 'Снять' }))) return
          await api['imgstudio:unpublish']({ conversationId }).then(() => { setShareUrl(null); toast.success('Публикация снята') }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
        })()}
      />
      <ImageStudioActions
        busy={busy}
        shownCount={shown.length}
        totalCount={files.length}
        hasPrompts={shown.some((file) => file.prompt)}
        gridBg={gridBg}
        dense={dense}
        fit={fit}
        starsOnly={starsOnly}
        trashCount={trashCount ?? 0}
        trashOpen={trashOpen}
        canAskNotifications={typeof Notification === 'function' && Notification.permission === 'default'}
        onDownloadArchive={() => downloadAll(shown)}
        onCopyInventory={() => {
          const text = inventoryMarkdown(shown, { dimensions, notes })
          void navigator.clipboard?.writeText(text).then(() => toast.success('Список скопирован таблицей')).catch(() => toast.error('Буфер обмена недоступен'))
        }}
        onDownloadInventory={() => {
          const blob = new Blob([inventoryMarkdown(shown, { dimensions, notes })], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'галерея.md'
          link.click()
          URL.revokeObjectURL(url)
          toast.success('Список сохранён файлом')
        }}
        onFindDuplicates={findGalleryDuplicates}
        onVerifyFiles={verifyFiles}
        onCopyPrompts={() => {
          const text = shown.filter((file) => file.prompt).map((file) => `${file.path}: ${file.prompt}`).join('\n')
          void navigator.clipboard?.writeText(text).then(() => toast.success('Промпты скопированы')).catch(() => toast.error('Буфер обмена недоступен'))
        }}
        onCycleGridBg={() => setGridBg((prev) => {
          const next = prev === 'checker' ? 'light' : prev === 'light' ? 'dark' : 'checker'
          try { localStorage.setItem(IMAGE_STUDIO_GRID_BG_KEY, next) } catch { /* приватный режим */ }
          return next
        })}
        onToggleFit={toggleFit}
        onToggleDense={() => setDense((prev) => {
          const next = !prev
          try { localStorage.setItem(IMAGE_STUDIO_DENSE_KEY, next ? '1' : '0') } catch { /* приватный режим */ }
          return next
        })}
        onToggleStarsOnly={() => setStarsOnly((prev) => !prev)}
        onReload={() => void reload()}
        onAskNotifications={() => void Notification.requestPermission().then((result) => {
          if (result === 'granted') toast.success('Уведомления включены — сообщим, когда картинка будет готова')
          else toast.info('Без уведомлений: о готовности скажет заголовок вкладки и короткий сигнал')
        }).catch(() => undefined)}
        onOpenKeys={() => setKeysOpen(true)}
        onOpenMarks={() => {
          // Наборы и виды — такие же браузерные пометки: без них переезд в
          // другой браузер терял всю организацию, а не только звёзды.
          setMarksDraft(JSON.stringify({ stars: [...stars], notes, statuses, sets, views }, null, 2))
          setMarksOpen(true)
        }}
        pageSize={pageSize}
        onPageSize={(value) => {
          setPageSize(value)
          setVisibleCount(value)
          try { localStorage.setItem(IMAGE_STUDIO_PAGE_KEY, String(value)) } catch { /* приватный режим */ }
        }}
        journalCount={journal.length}
        onOpenJournal={() => setJournalOpen(true)}
        hasNotes={Object.values(notes).some((text) => text.trim())}
        onCopyNotes={() => void navigator.clipboard?.writeText(notesMarkdown(notes))
          .then(() => toast.success('Заметки скопированы'))
          .catch(() => toast.error('Буфер обмена недоступен'))}
        onSlideshow={shown.length > 1 ? () => {
          // Показ начинается с первого отобранного: «покажи заказчику подборку»
          // — это ровно нынешний отбор, а не вся галерея.
          setViewing(shown[0]!.path)
          setSlideshowRequested(true)
        } : null}
        onPrint={() => {
          // Печать штатным окном браузера: оттуда же делают PDF, а свой
          // предпросмотр пришлось бы рисовать и поддерживать отдельно.
          setPrintMode(true)
          setTimeout(() => { window.print(); setPrintMode(false) }, 50)
        }}
        viewsCount={Object.keys(views).length}
        onCopyViewLink={isEmptyView(currentView()) ? null : () => {
          const link = `${location.origin}${location.pathname}#/images/${conversationId}/view/${encodeURIComponent(encodeStudioView(currentView()))}`
          void navigator.clipboard?.writeText(link)
            .then(() => toast.success('Ссылка на отбор в буфере'))
            .catch(() => toast.info(link))
        }}
        onOpenViews={() => { setViewName(''); setViewsOpen(true) }}
        onToggleTrash={() => {
          const next = !trashOpen
          setTrashOpen(next)
          if (next) void refreshTrash()
        }}
      />
      {setRename && <span className="image-studio-rename-batch">
        <input
          aria-label="Новое имя набора"
          autoFocus
          value={setRename.to}
          onChange={(event) => setSetRename({ from: setRename.from, to: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSetRename(null)
            if (event.key === 'Enter') { event.preventDefault(); renameSet() }
          }}
        />
        <Button size="sm" disabled={!setRename.to.trim() || (setRename.to.trim() !== setRename.from && Boolean(sets[setRename.to.trim()]))} onClick={renameSet}>Ок</Button>
        <Button size="sm" variant="ghost" onClick={() => setSetRename(null)}>Отмена</Button>
      </span>}
      {Object.entries(sets).map(([name, list]) => <span key={name} className="image-studio-chip">
        <button type="button" className="image-studio-chip-text" title={`Выбрать набор «${name}» (${list.length})`} onClick={() => {
          // Файлы могли исчезнуть — берём только существующие, иначе выбор
          // показывал бы «выбрано 5 из 3».
          const alive = list.filter((path) => files.some((file) => file.path === path))
          setMulti(new Set(alive))
          if (alive.length < list.length) toast.info(`Часть набора «${name}» уже удалена: ${list.length - alive.length}`)
        }}>▤ {name} ({list.filter((path) => files.some((file) => file.path === path)).length}{list.some((path) => !files.some((file) => file.path === path)) ? ` из ${list.length}` : ''})</button>
        {/* Набор с исчезнувшими файлами чистится одним нажатием: иначе счётчик
            врёт до конца жизни набора. */}
        {list.some((path) => !files.some((file) => file.path === path)) && <button type="button" className="image-studio-chip-pin" aria-label={`Убрать из набора ${name} удалённые файлы`} title="Убрать удалённые из набора" onClick={() => {
          const alive = list.filter((path) => files.some((file) => file.path === path))
          const next = { ...sets }
          if (alive.length) next[name] = alive
          else delete next[name]
          saveSets(next)
          toast.success(alive.length ? `Из «${name}» убрано удалённых: ${list.length - alive.length}` : `Набор «${name}» опустел и удалён`)
        }}>⌫</button>}
        <button type="button" className="image-studio-chip-pin" aria-label={`Переименовать набор ${name}`} title="Переименовать набор" onClick={() => setSetRename({ from: name, to: name })}>✎</button>
        <button type="button" className="image-studio-chip-pin" aria-label={`Забыть набор ${name}`} title="Забыть набор" onClick={() => {
          const next = { ...sets }
          delete next[name]
          saveSets(next)
        }}>×</button>
      </span>)}
      <Button size="sm" variant="ghost" onClick={() => { setMulti(multi ? null : new Set()); setPickedOnly(false) }}>{multi ? 'Готово' : 'Выбрать несколько'}</Button>
      {multi && <ImageStudioBatchBar
        selected={multi}
        total={shown.length}
        bytes={shown.filter((file) => multi.has(file.path)).reduce((sum, file) => sum + file.size, 0)}
        busy={busy}
        allStarred={multi.size > 0 && [...multi].every((path) => stars.has(path))}
        otherChats={otherChats ?? []}
        pickedOnly={pickedOnly}
        lastTransformLabel={IMAGE_TRANSFORMS.find((item) => item.kind === lastTransform)?.label ?? null}
        renameTemplate={renameTemplate}
        onRenameTemplateChange={setRenameTemplate}
        renamePreview={(() => {
          const template = renameTemplate.trim()
          if (!template || !multi?.size) return null
          const plan = renamePlan(template, shown.filter((file) => multi.has(file.path)).map((file) => file.path))
          if (!plan.length) return null
          const head = plan.slice(0, 2).map((step) => `${step.from} → ${step.to}`).join(', ')
          return plan.length > 2 ? `${head} … и ещё ${plan.length - 2}` : head
        })()}
        noteDraft={batchNote}
        onNoteDraftChange={setBatchNote}
        captionDraft={batchCaption}
        onCaptionDraftChange={setBatchCaption}
        setNames={Object.keys(sets)}
        setName={setName}
        onSetNameChange={setSetName}
        formatBytes={formatBytes}
        actions={batchActions}
      />}
    </div>}

    {trashOpen && <div className="image-studio-trash" role="group" aria-label="Корзина галереи">
      {trash.length > 1 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => {
        // Порядок не важен: имена в корзине уникальны, каждое возвращается своим.
        for (const item of trash) await api['imgstudio:restore']({ conversationId, name: item.name })
      }, `Восстановлено файлов: ${trash.length}`)}>Восстановить всё ({trash.length})</Button>}
      {trash.some((item) => Date.now() - item.deletedAt > 24 * 60 * 60 * 1000) && <Button size="sm" variant="ghost" disabled={busy} title="Удалить навсегда только то, что лежит больше суток — свежее останется" onClick={() => void (async () => {
        const old = trash.filter((item) => Date.now() - item.deletedAt > 24 * 60 * 60 * 1000).map((item) => item.name)
        if (!(await confirm({ title: `Удалить навсегда ${old.length} файл(ов) старше суток?`, message: 'Свежее удалённое останется в корзине. Восстановить очищенное будет нельзя.', confirmLabel: 'Очистить' }))) return
        await run(async () => {
          for (const name of old) await api['imgstudio:purge']({ conversationId, name })
          dropMarks(old)
        }, `Удалено навсегда: ${old.length}`)
      })()}>Очистить старше суток</Button>}
      
      {trash.length === 0
        ? <span className="image-studio-dim">Корзина пуста — удалённое хранится здесь 7 дней.</span>
        : trash.map((item) => <span key={`${item.name}-${item.deletedAt}`} className="image-studio-chip">
            {/* Возраст рядом с именем: корзина живёт 7 дней, и «сколько ещё
                осталось» — единственное, что о записи нужно знать. */}
            {/* Вес — в тултипе рядом с датой: по нему решают, что вернуть, а
                что добить, когда место в разговоре кончается. */}
            <span className="image-studio-chip-text" title={`Удалён: ${new Date(item.deletedAt).toLocaleString('ru-RU')}${item.size ? ` · ${formatBytes(item.size)}` : ''}`}>{item.name} <small className="image-studio-dim">{relativeTime(item.deletedAt)}</small></span>
            <button type="button" className="image-studio-chip-pin" aria-label={`Восстановить ${item.name}`} title="Восстановить" onClick={() => void run(
              () => api['imgstudio:restore']({ conversationId, name: item.name }),
              `«${item.name}» восстановлен`
            )}>↩</button>
            <button type="button" className="image-studio-chip-pin" aria-label={`Удалить ${item.name} навсегда`} title="Удалить навсегда" onClick={() => void (async () => {
              if (!(await confirm({ title: `Удалить «${item.name}» навсегда?`, message: 'Восстановить файл после этого будет нельзя.', confirmLabel: 'Удалить навсегда' }))) return
              await run(async () => {
                await api['imgstudio:purge']({ conversationId, name: item.name })
                dropMarks([item.name])
              }, `«${item.name}» удалён навсегда`)
            })()}>✕</button>
          </span>)}
      {trash.length > 0 && <Button size="sm" variant="danger" disabled={busy} title="Удалить содержимое корзины навсегда и освободить место" onClick={() => void (async () => {
        if (!(await confirm({
          title: `Очистить корзину (${trash.length})?`,
          message: 'Файлы будут удалены навсегда — восстановить их будет нельзя. Место в галерее освободится сразу.',
          confirmLabel: 'Очистить'
        }))) return
        const doomed = trash.map((item) => item.name)
        await run(async () => {
          const { removed } = await api['imgstudio:purge']({ conversationId })
          dropMarks(doomed)
          setTrash([])
          setTrashCount(0)
          return removed
        }, 'Корзина очищена')
      })()}>Очистить корзину ({trash.length}{trash.reduce((sum, item) => sum + (item.size ?? 0), 0) ? ` · ${formatBytes(trash.reduce((sum, item) => sum + (item.size ?? 0), 0))}` : ''})</Button>}
    </div>}
    {files.length === 0
      ? <div>
          {/* Пустая галерея объясняла три способа наполнить её, но ни один
              нельзя было запустить отсюда — кнопка ведёт к самому быстрому. */}
          <EmptyState title="Галерея пуста — нарисуйте первую картинку" description="Опишите её в поле выше, перетащите файлы сюда или попросите ассистента в чате слева: всё нарисованное попадает сюда." actionLabel="Загрузить с диска" onAction={() => uploadRef.current?.click()} />
          <div className="image-studio-recent image-studio-examples" aria-label="Примеры промптов">
            {PROMPT_EXAMPLES.map((example) => <button key={example} type="button" className="image-studio-chip" onClick={() => { setPrompt(example); promptRef.current?.focus() }}>{example}</button>)}
          </div>
        </div>
      : shown.length === 0
        ? <EmptyState compact title="Ничего не нашлось" description="Условий может быть несколько: поиск, тип, происхождение, пометки, избранное." actionLabel="Сбросить все фильтры" onAction={() => {
            setFilter('')
            setKindFilter('')
            setOriginFilter('')
            setMarkFilter('')
            setStarsOnly(false)
            setFreshOnly(false)
            setSinceVisitOnly(false)
            setVisibleCount(PAGE_SIZE)
          }} />
        : <>
          {grouped
            ? groupByDay(paged).map((group) => {
                const folded = collapsedGroups.has(group.title)
                return <section key={group.title} className="image-studio-group" aria-label={group.title}>
                  <h3 className="image-studio-group-title">
                    {/* Заголовок группы сворачивает её: у «Раньше» бывают сотни
                        кадров, и они закрывали собой сегодняшнюю работу. */}
                    <Button size="sm" variant="ghost" aria-expanded={!folded} title={folded ? 'Развернуть группу' : 'Свернуть группу'} onClick={() => {
                      const next = new Set(collapsedGroups)
                      if (next.has(group.title)) next.delete(group.title)
                      else next.add(group.title)
                      foldGroups(next)
                    }}>
                      {folded ? '▸' : '▾'} {group.title}
                    </Button>
                    <small className="image-studio-dim">{group.files.length}</small>
                    {/* В мультирежиме «выбрать всё за день» — самый частый
                        отбор: обычно разбирают именно сегодняшнюю работу. */}
                    {multi && <Button size="sm" variant="ghost" title={`Отметить все файлы группы «${group.title}»`} onClick={() => setMulti((prev) => new Set([...(prev ?? []), ...group.files.map((file) => file.path)]))}>
                      Выбрать группу
                    </Button>}
                  </h3>
                  {!folded && <div className={`image-studio-grid image-studio-bg--${gridBg}${dense ? ' image-studio-grid--dense' : ''}${fit ? ' image-studio-grid--fit' : ''}`} role="list" aria-label={`Галерея изображений: ${group.title.toLowerCase()}`}>
                    {group.files.map(renderCard)}
                  </div>}
                </section>
              })
            : <div ref={gridRef} className={`image-studio-grid image-studio-bg--${gridBg}${dense ? ' image-studio-grid--dense' : ''}${fit ? ' image-studio-grid--fit' : ''}`} role="list" aria-label="Галерея изображений" aria-busy={busy || undefined}>
                {progress && <div role="listitem" className="image-studio-card image-studio-card--ghost" aria-hidden="true">
                  <div className="image-studio-thumb image-studio-thumb--ghost"><Skeleton item="block" height={120} /></div>
                  <span className="image-studio-name">{progress.label}…</span>
                </div>}
              {virtual && virtual.padTop > 0 && <div className="image-studio-spacer" style={{ height: virtual.padTop }} aria-hidden="true" />}
              {windowed.map(renderCard)}
              {virtual && virtual.padBottom > 0 && <div className="image-studio-spacer" style={{ height: virtual.padBottom }} aria-hidden="true" />}
            </div>}
          {shown.length > visibleCount && <div ref={moreRef} className="image-studio-more">
            <Button size="sm" variant="ghost" onClick={() => setVisibleCount((prev) => prev + pageSize)}>
              Показать ещё ({shown.length - visibleCount})
            </Button>
          </div>}
          <div className="image-studio-quota-bar" role="presentation" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round(usedBytes / IMAGE_STUDIO_LIMITS.maxConversationBytes * 100))}%` }} className={usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? 'image-studio-quota-bar--warn' : undefined} />
          </div>
          <p
            className={`image-studio-quota${usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? ' image-studio-quota--warn' : ''}`}
            // «Занято 35 МБ из 128» не отвечает на вопрос «сколько ещё можно
            // нарисовать» — считаем по среднему весу нынешних файлов.
            title={files.length ? `Средний файл — ${formatBytes(Math.round(usedBytes / files.length))}; при таком весе влезет ещё около ${Math.max(0, Math.floor((IMAGE_STUDIO_LIMITS.maxConversationBytes - usedBytes) / Math.max(1, usedBytes / files.length)))} картинок` : undefined}
          >
            {files.length === 1 ? '1 файл' : `Файлов: ${files.length}`}
            {shown.length !== files.length ? ` · отобрано ${shown.length}` : ''}
            {multi?.size ? ` · выбрано ${multi.size} (${formatBytes(files.filter((file) => multi.has(file.path)).reduce((sum, file) => sum + file.size, 0))})` : ''}
            {' · '}занято {formatBytes(usedBytes)} из {formatBytes(IMAGE_STUDIO_LIMITS.maxConversationBytes)}
            {/* Пока превью грузятся, сетка выглядит наполовину пустой — счётчик
                объясняет, что это не ошибка. */}
            {paged.some((file) => !previews[file.path] && !broken.has(file.path))
              ? ` · превью: ${paged.filter((file) => previews[file.path]).length} из ${paged.length}`
              : ''}
            {usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 && ' — место кончается, удалите ненужное'}
          </p>
        </>}

    {/* «Наверх»: на галерее в сотню файлов возврат к промпту — это долгая
        прокрутка колесом, а поле ввода живёт в самом верху панели. */}
    {viewport.top > 600 && <Button
      size="sm"
      className="image-studio-to-top"
      title="К началу галереи и полю промпта"
      onClick={() => {
        const pane = paneRef.current
        if (!pane) return
        pane.scrollTo?.({ top: 0, behavior: 'smooth' })
        pane.scrollTop = 0
        syncViewport()
      }}
    >↑ Наверх</Button>}

    {menu && (() => {
      const file = files.find((item) => item.path === menu.path)
      if (!file) return null
      const item = (label: string, action: () => void): JSX.Element => (
        <button type="button" role="menuitem" onClick={() => { setMenu(null); action() }}>{label}</button>
      )
      return <div
        className="image-studio-menu"
        role="menu"
        aria-label={`Действия ${file.path}`}
        style={{ left: menu.x, top: menu.y }}
        // У нижних карточек меню не влезало в окно и обрезалось по краю:
        // измеряем его сразу после вставки и сдвигаем внутрь экрана.
        ref={(node) => {
          if (!node) return
          const box = node.getBoundingClientRect()
          const overflowX = Math.max(0, box.right - window.innerWidth + 8)
          const overflowY = Math.max(0, box.bottom - window.innerHeight + 8)
          if (overflowX) node.style.left = `${Math.max(8, menu.x - overflowX)}px`
          if (overflowY) node.style.top = `${Math.max(8, menu.y - overflowY)}px`
          // Фокус уводим в меню сразу: иначе с клавиатуры оно открывалось, но
          // управлять им было нечем.
          node.querySelector<HTMLButtonElement>('button')?.focus()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Меню — это меню: стрелки ходят по пунктам, Home/End прыгают к
          // краям, Tab из него не выпадает. Всплытие обязательно гасим: меню
          // живёт внутри панели, и та же стрелка иначе двигала выбор по сетке
          // и уводила фокус на превью (поймано в браузере).
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) event.stopPropagation()
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          if (!items.length) return
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          const focus = (next: number): void => {
            event.preventDefault()
            items[(next + items.length) % items.length]?.focus()
          }
          if (event.key === 'ArrowDown') focus(index + 1)
          else if (event.key === 'ArrowUp') focus(index - 1)
          else if (event.key === 'Home') focus(0)
          else if (event.key === 'End') focus(items.length - 1)
          else if (event.key === 'Tab') { event.preventDefault(); focus(index + (event.shiftKey ? -1 : 1)) }
        }}
      >
        {item('Открыть на весь экран', () => setViewing(file.path))}
        {item(selected === file.path ? 'Снять выбор' : 'Выбрать для правки', () => { setSelected(selected === file.path ? null : file.path); promptRef.current?.focus() })}
        {item(stars.has(file.path) ? 'Убрать из избранного' : 'В избранное', () => toggleStar(file.path))}
        {item('Скачать', () => void download(file.path))}
        {item('Копировать в буфер', () => copy(file))}
        {item('Ссылка на кадр', () => {
          const link = `${location.origin}${location.pathname}#/images/${conversationId}/${encodeURIComponent(file.path)}`
          void navigator.clipboard?.writeText(link).then(() => toast.success('Ссылка на кадр в буфере')).catch(() => toast.info(link))
        })}
        {file.prompt ? item('Взять промпт в поле', () => { setPrompt(file.prompt ?? ''); setSelected(null); promptRef.current?.focus() }) : null}
        {item('Скопировать имя без расширения', () => void navigator.clipboard?.writeText(file.path.replace(/\.[^.]+$/, ''))
          .then(() => toast.success('Имя без расширения скопировано'))
          .catch(() => toast.error('Буфер обмена недоступен')))}
        {file.prompt ? item('Скопировать промпт', () => void navigator.clipboard?.writeText(file.prompt ?? '')
          .then(() => toast.success('Промпт скопирован'))
          .catch(() => toast.error('Буфер обмена недоступен'))) : null}
        {item('Похожие по цвету', () => {
          // Цвета считаются лениво: перед отбором досчитываем их для видимых.
          ensureTints(shown)
          setTintOf(file.path)
          setVisibleCount(PAGE_SIZE)
          toast.info('Оставлены кадры близкой гаммы')
        })}
        {versionFamily(files, file.path).length > 1
          ? item(`Все версии (${versionFamily(files, file.path).length})`, () => { setFamilyOf(file.path); setVisibleCount(PAGE_SIZE) })
          : null}
        {item(notes[file.path] ? 'Изменить заметку' : 'Заметка…', () => setNoteFor({ path: file.path, text: notes[file.path] ?? '' }))}
        {onAttachToChat ? item('В сообщение чата', () => void blobOf(file.path).then((blob) => {
          onAttachToChat(new File([blob], file.path, { type: blob.type }))
          toast.success(`«${file.path}» прикреплена к сообщению`)
        }).catch(() => toast.error('Не удалось прочитать файл'))) : null}
        {file.prompt ? item('Похожие: тот же промпт', () => {
          setFilter(file.prompt!.slice(0, 40))
          setVisibleCount(PAGE_SIZE)
          filterRef.current?.focus()
        }) : null}
        {item('Вариация', () => variate(file))}
        {item('Три вариации подряд', () => variateSeries(file, 3))}
        {item('Дубликат', () => duplicate(file))}
        {item('Переименовать', () => setRenaming({ from: file.path, to: file.path }))}
        {item('Инструменты обработки', () => setToolsFor(file.path))}
        {item('Удалить', () => void (async () => {
          if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Файл уедет в корзину — вернуть его можно оттуда.', confirmLabel: 'Удалить' }))) return
          await deleteOne(file.path)
          if (selected === file.path) setSelected(null)
        })())}
      </div>
    })()}

    <ImageStudioDialogs
      keysOpen={keysOpen}
      onCloseKeys={() => setKeysOpen(false)}
      note={noteFor}
      noteSaved={Boolean(noteFor && notes[noteFor.path])}
      onNoteText={(text) => setNoteFor((prev) => prev ? { path: prev.path, text } : prev)}
      onNoteSave={() => { if (noteFor) { setNote(noteFor.path, noteFor.text); setNoteFor(null); toast.success('Заметка сохранена') } }}
      onNoteClear={() => { if (noteFor) { setNote(noteFor.path, ''); setNoteFor(null); toast.success('Заметка снята') } }}
      onNoteClose={() => setNoteFor(null)}
      viewsOpen={viewsOpen}
      onCloseViews={() => setViewsOpen(false)}
      views={views}
      viewName={viewName}
      onViewName={setViewName}
      onApplyView={(name) => {
        const view = views[name]
        if (!view) return
        applyView(view)
        setViewsOpen(false)
        toast.success(`Вид «${name}» применён`)
      }}
      onDeleteView={(name) => {
        const next = { ...views }
        delete next[name]
        saveViews(next)
      }}
      onSaveView={() => {
        saveViews({ ...views, [viewName.trim()]: currentView() })
        setViewName('')
        toast.success('Вид запомнен')
      }}
    />

    {templateOpen && <Dialog title="Шаблоны промптов" onClose={() => setTemplateOpen(false)} size="sm" padded>
      {templateFill
        ? <>
            {/* Второй шаг: у шаблона спрашиваем только его переменные — так
                каркас остаётся неприкосновенным, а меняется суть. */}
            <p className="image-studio-dim">{templates[templateFill.name]}</p>
            {promptTemplateVars(templates[templateFill.name] ?? '').map((variable) => <span key={variable} className="image-studio-rename-batch">
              <input
                aria-label={`Значение переменной ${variable}`}
                placeholder={variable}
                value={templateFill.values[variable] ?? ''}
                onChange={(event) => setTemplateFill({ name: templateFill.name, values: { ...templateFill.values, [variable]: event.target.value } })}
              />
            </span>)}
            <span className="image-studio-rename-batch">
              <Button size="sm" onClick={() => {
                setPrompt(promptTemplateFill(templates[templateFill.name] ?? '', templateFill.values))
                setTemplateOpen(false)
                setTemplateFill(null)
                promptRef.current?.focus()
              }}>Подставить в промпт</Button>
              <Button size="sm" variant="ghost" onClick={() => setTemplateFill(null)}>Назад</Button>
            </span>
          </>
        : <>
            {Object.keys(templates).length === 0
              ? <p className="image-studio-dim">Шаблонов пока нет. Напишите промпт с переменными в фигурных скобках — «{'{объект}'} в стиле акварели, белый фон» — и запомните его здесь.</p>
              : <ul className="image-studio-views" role="list">
                  {Object.entries(templates).map(([name, text]) => <li key={name} role="listitem">
                    <Button size="sm" variant="ghost" onClick={() => {
                      const vars = promptTemplateVars(text)
                      if (!vars.length) {
                        setPrompt(text)
                        setTemplateOpen(false)
                        promptRef.current?.focus()
                        return
                      }
                      setTemplateFill({ name, values: {} })
                    }}>{name}</Button>
                    <span className="image-studio-dim" title={text}>{text}</span>
                    <IconButton size="sm" aria-label={`Удалить шаблон ${name}`} title="Удалить шаблон" onClick={() => {
                      const next = { ...templates }
                      delete next[name]
                      saveTemplates(next)
                    }}>✕</IconButton>
                  </li>)}
                </ul>}
            <span className="image-studio-rename-batch">
              <input aria-label="Имя шаблона" placeholder="имя шаблона…" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              <Button size="sm" disabled={!templateName.trim() || !prompt.trim()} title={prompt.trim() ? 'Запомнить текст из поля промпта' : 'Сначала напишите промпт в поле'} onClick={() => {
                saveTemplates({ ...templates, [templateName.trim()]: prompt.trim() })
                setTemplateName('')
                toast.success('Шаблон запомнен')
              }}>Запомнить промпт как шаблон</Button>
            </span>
          </>}
    </Dialog>}

    {journalOpen && <Dialog title="Что делали в галерее" onClose={() => setJournalOpen(false)} size="sm" padded>
      <ul className="image-studio-journal" role="list">
        {journal.map((entry) => <li key={entry.id} role="listitem">
          <span title={new Date(entry.at).toLocaleString('ru-RU')}>{entry.text}</span>
          <span className="image-studio-dim">{relativeTime(entry.at)}</span>
          {/* Отмена есть только у обратимого: у обработки её нет, и обещать
              её кнопкой нельзя. */}
          {entry.undo && <Button size="sm" variant="ghost" onClick={() => {
            entry.undo?.()
            setJournal((prev) => prev.filter((item) => item.id !== entry.id))
            setJournalOpen(false)
          }}>Вернуть</Button>}
        </li>)}
      </ul>
      <p className="image-studio-dim">Журнал живёт до перезагрузки страницы и хранит двадцать последних операций.</p>
    </Dialog>}

    {marksOpen && <Dialog title="Звёзды и заметки" onClose={() => setMarksOpen(false)} size="sm" padded actions={<>
      <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(marksDraft).then(() => toast.success('Пометки скопированы')).catch(() => toast.error('Буфер обмена недоступен'))}>Скопировать</Button>
      <Button onClick={() => {
        // Пометки живут в этом браузере, поэтому единственный способ забрать
        // их с собой — текстом: вставил в другом браузере и применил.
        try {
          const parsed: unknown = JSON.parse(marksDraft)
          const data = parsed && typeof parsed === 'object' ? parsed as { stars?: unknown; notes?: unknown; statuses?: unknown; sets?: unknown; views?: unknown } : {}
          const nextStars = new Set(Array.isArray(data.stars) ? data.stars.filter((item): item is string => typeof item === 'string') : [])
          const rawNotes = data.notes && typeof data.notes === 'object' ? data.notes as Record<string, unknown> : {}
          const nextNotes: Record<string, string> = {}
          for (const [key, value] of Object.entries(rawNotes)) if (typeof value === 'string') nextNotes[key] = value
          // Готовность тоже пометка: без неё перенос терял отбор «что уже можно отдавать».
          const rawStatuses = data.statuses && typeof data.statuses === 'object' ? data.statuses as Record<string, unknown> : {}
          const nextStatuses: Record<string, 'draft' | 'ready'> = {}
          for (const [key, value] of Object.entries(rawStatuses)) if (value === 'draft' || value === 'ready') nextStatuses[key] = value
          const rawSets = data.sets && typeof data.sets === 'object' ? data.sets as Record<string, unknown> : {}
          const nextSets: Record<string, string[]> = {}
          for (const [key, value] of Object.entries(rawSets)) {
            if (Array.isArray(value)) nextSets[key] = value.filter((item): item is string => typeof item === 'string')
          }
          const rawViews = data.views && typeof data.views === 'object' ? data.views as Record<string, unknown> : {}
          const nextViews: Record<string, StudioView> = {}
          for (const [key, value] of Object.entries(rawViews)) {
            // Вид из чужого файла разбираем тем же кодом, что и вид из ссылки:
            // незнакомые значения отбрасываются, а не попадают в состояние.
            if (value && typeof value === 'object') nextViews[key] = decodeStudioView(encodeStudioView(value as StudioView))
          }
          setStars(nextStars)
          setNotes(nextNotes)
          setStatuses(nextStatuses)
          if (Object.keys(nextSets).length) saveSets(nextSets)
          if (Object.keys(nextViews).length) saveViews(nextViews)
          try {
            localStorage.setItem(imageStudioStarsKey(conversationId), JSON.stringify([...nextStars]))
            localStorage.setItem(imageStudioNotesKey(conversationId), JSON.stringify(nextNotes))
            localStorage.setItem(imageStudioStatusKey(conversationId), JSON.stringify(nextStatuses))
          } catch { /* приватный режим */ }
          setMarksOpen(false)
          toast.success(`Применено: звёзд ${nextStars.size}, заметок ${Object.keys(nextNotes).length}, пометок готовности ${Object.keys(nextStatuses).length}, наборов ${Object.keys(nextSets).length}, видов ${Object.keys(nextViews).length}`)
        } catch {
          toast.error('Это не похоже на пометки: ожидается JSON со списком stars и объектом notes')
        }
      }}>Применить</Button>
    </>}>
      <p className="image-studio-dim">Звёзды и заметки хранятся в этом браузере. Скопируйте текст, чтобы перенести их, или вставьте свой и нажмите «Применить».</p>
      <textarea aria-label="Пометки галереи в формате JSON" rows={8} className="image-studio-marks" value={marksDraft} onChange={(event) => setMarksDraft(event.target.value)} />
    </Dialog>}

    {passwordDialog && <Dialog title="Пароль для зрителей" onClose={() => setPasswordDialog(false)} size="sm" padded actions={<>
      {shareProtected && <Button variant="ghost" onClick={() => void api['imgstudio:publish']({ conversationId, password: null }).then(() => { setShareProtected(false); setPasswordDialog(false); toast.success('Пароль снят') }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}>Снять пароль</Button>}
      <Button disabled={viewerPassword.trim().length < 4} onClick={() => void api['imgstudio:publish']({ conversationId, password: viewerPassword.trim() }).then(() => { setShareProtected(true); setPasswordDialog(false); toast.success('Пароль установлен') }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}>Сохранить</Button>
    </>}>
      <p className="image-studio-dim">Зрители по ссылке увидят форму пароля. Это пароль публикации, не ваш пароль от аккаунта.</p>
      <input
        className="image-studio-filename"
        style={{ width: '100%' }}
        aria-label="Пароль для зрителей галереи"
        placeholder="Минимум 4 символа"
        value={viewerPassword}
        onChange={(event) => setViewerPassword(event.target.value)}
      />
    </Dialog>}
    {viewing && <ImageStudioViewer
      viewing={viewing}
      busy={busy}
      files={files}
      previews={previews}
      dimensions={dimensions}
      compare={compare}
      compareWith={compareWith}
      {...(compareGrid ? { compareGrid } : {})}
      formatBytes={formatBytes}
      canStep={viewList.length > 1}
      onCompareChange={setCompare}
      onView={setViewing}
      onStep={viewStep}
      onUsePrompt={(text) => { setPrompt(text); setViewing(null); promptRef.current?.focus() }}
      onPickForEdit={(path) => { setSelected(path); setViewing(null); setCompare(false); promptRef.current?.focus() }}
      onVariate={(path) => { setViewing(null); setCompare(false); variate(files.find((file) => file.path === path) ?? { path, size: 0, updatedAt: 0 }) }}
      onDownload={(path) => void download(path)}
      onCopy={(path) => copy(files.find((file) => file.path === path) ?? { path, size: 0, updatedAt: 0 })}
      {...(notes[viewing] !== undefined ? { note: notes[viewing] } : {})}
      onNoteChange={(path, text) => { setNote(path, text); toast.success(text.trim() ? 'Заметка сохранена' : 'Заметка убрана') }}
      onPalette={async (path) => {
        const cached = toneCache.current.get(path)
        if (cached?.palette) return cached.palette
        const palette = await blobOf(path).then((blob) => extractPalette(blob))
        toneCache.current.set(path, { ...cached, palette })
        return palette
      }}
      onChannels={async (path) => {
        const cached = channelCache.current.get(path)
        if (cached) return cached
        const result = await blobOf(path).then((blob) => channelHistogramsOf(blob))
        channelCache.current.set(path, result)
        return result
      }}
      starred={stars.has(viewing)}
      onToggleStar={toggleStar}
      {...(statuses[viewing] ? { status: statuses[viewing] } : {})}
      onCycleStatus={cycleStatus}
      sets={Object.entries(sets).filter(([, paths]) => paths.includes(viewing)).map(([name]) => name)}
      versions={versionTree(files, viewing)}
      onFacts={async (path) => {
        const cached = factsCache.current.get(path)
        if (cached) return cached
        const blob = await blobOf(path)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const type = sniffImageType(bytes)
        // Пиксели нужны только для прозрачности и числа цветов: читаем
        // уменьшенную копию, полный проход по большой картинке ощутимо тормозит.
        let alpha = false
        let colors = 0
        try {
          const bitmap = await createImageBitmap(blob)
          const scale = Math.min(1, 128 / Math.max(1, bitmap.width, bitmap.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            alpha = hasAlphaPixels(data)
            colors = approxColorCount(data)
          }
          bitmap.close?.()
        } catch { /* SVG и битые файлы: тип уже знаем, пиксели не обязательны */ }
        const result = { type, mismatch: extensionMismatch(path, type), alpha, colors }
        factsCache.current.set(path, result)
        return result
      }}
      autoProps={propsRequested}
      onAutoPropsUsed={() => setPropsRequested(false)}
      autoSlideshow={slideshowRequested}
      onAutoSlideshowUsed={() => setSlideshowRequested(false)}
      onLocate={(path) => {
        setViewing(null)
        setCompare(false)
        setSelected(path)
        const index = shownRef.current.findIndex((file) => file.path === path)
        if (index >= 0) revealCard(path, index)
      }}
      onHistogram={async (path) => {
        const cached = toneCache.current.get(path)
        if (cached?.histogram) return cached.histogram
        const histogram = await blobOf(path).then((blob) => histogramOf(blob))
        toneCache.current.set(path, { ...cached, histogram })
        return histogram
      }}
      onCrop={(path, rect) => void run(async () => {
        const blob = await blobOf(path)
        const result = await cropImage(blob, rect)
        const name = transformName(path, 'кроп', new Set((files ?? []).map((item) => item.path)))
        const buffer = new Uint8Array(await result.arrayBuffer())
        let binary = ''
        for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
        await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: path })
        setViewing(name)
      }, 'Кроп сохранён новым файлом')}
      onAnnotate={(path, strokes, displaySize) => void run(async () => {
        const blob = await blobOf(path)
        const result = await annotateImage(blob, strokes, displaySize)
        const name = transformName(path, 'разметка', new Set((files ?? []).map((item) => item.path)))
        const buffer = new Uint8Array(await result.arrayBuffer())
        let binary = ''
        for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
        await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: path })
        setViewing(name)
      }, 'Разметка сохранена новым файлом')}
      position={viewListIndex >= 0 ? { index: viewListIndex, total: viewList.length } : undefined}
      onDelete={(path) => void (async () => {
        if (!(await confirm({ title: `Удалить «${path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
        // После удаления открываем соседний файл, а не пустой лайтбокс.
        const rest = viewList.filter((file) => file.path !== path)
        setViewing(rest[Math.min(Math.max(viewListIndex, 0), rest.length - 1)]?.path ?? null)
        if (selected === path) setSelected(null)
        await run(() => api['imgstudio:delete']({ conversationId, path }), 'Удалено')
      })()}
      onClose={() => { setViewing(null); setCompare(false); setCompareWith(null); setCompareGrid(null) }}
    />}
  </div>
}
