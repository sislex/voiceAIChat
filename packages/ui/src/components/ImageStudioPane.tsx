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
import { applyImageTransform, captionImage, cropImage, IMAGE_TRANSFORMS, transformName } from '../lib/imageTransform'
import { annotateImage } from '../lib/imageAnnotate'
import { extractPalette } from '../lib/imagePalette'
import { histogramOf } from '../lib/imageTone'
import { buildCollage } from '../lib/imageCollage'
import { getCachedPreview, putCachedPreview } from '../lib/previewCache'
import { playStopCue } from '../lib/cues'
import { ImageStudioViewer } from './ImageStudioViewer'
import { ImageStudioToolsRow } from './ImageStudioToolsRow'
import { ImageStudioBatchBar, type BatchActions } from './ImageStudioBatchBar'
import { ImageStudioShareBar } from './ImageStudioShareBar'
import { ImageStudioFilters } from './ImageStudioFilters'
import { groupDuplicates, inventoryMarkdown, mapWithLimit } from '../lib/imageInventory'
import { IMAGE_STUDIO_DENSE_KEY, IMAGE_STUDIO_GRID_BG_KEY, IMAGE_STUDIO_NEGATIVE_KEY, IMAGE_STUDIO_NO_TEXT_KEY, IMAGE_STUDIO_ORDER_KEY, IMAGE_STUDIO_SIZE_KEY, IMAGE_STUDIO_STYLE_KEY, imageStudioDraftKey, imageStudioNegativeKey, imageStudioNotesKey, imageStudioPinnedKey, imageStudioPromptsKey, imageStudioScrollKey, imageStudioSeenKey, imageStudioSetsKey, imageStudioSizeKey, imageStudioStarsKey, imageStudioStyleKey } from '../store/contracts'

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
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = haystacks.filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * Разбивает строку на куски с отметкой совпадения — по ним имя подсвечивается
 * в карточке. Без подсветки при поиске по промпту непонятно, почему файл нашёлся.
 */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
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
  const routeFile = segments[0] === 'images' && segments[1] === conversationId && segments[2]
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
  /** Карточка с раскрытой строкой инструментов обработки (canvas, без модели). */
  const [toolsFor, setToolsFor] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  /** Корзина: содержимое подгружается при раскрытии. */
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<Array<{ name: string; deletedAt: number }>>([])
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
  /** Диалог переноса пометок между браузерами (звёзды и заметки текстом). */
  const [marksOpen, setMarksOpen] = useState(false)
  const [marksDraft, setMarksDraft] = useState('')
  const [viewerPassword, setViewerPassword] = useState('')
  const [filter, setFilter] = useState('')
  /** Фильтр по расширению: пустой — все типы. */
  const [kindFilter, setKindFilter] = useState('')
  /** Фильтр по происхождению: нарисованные моделью или загруженные руками. */
  const [originFilter, setOriginFilter] = useState<'' | 'ai' | 'own'>('')
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
  const [order, setOrder] = useState<'new' | 'name' | 'size' | 'stars'>(() => {
    try {
      const saved = localStorage.getItem(IMAGE_STUDIO_ORDER_KEY)
      return saved === 'name' || saved === 'size' || saved === 'stars' ? saved : 'new'
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
  // Докрутили до конца — следующая порция приезжает сама. Кнопка остаётся:
  // IntersectionObserver есть не везде (и не в jsdom), а список должен
  // дорастать в любом браузере.
  useEffect(() => {
    const node = moreRef.current
    if (!node || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((prev) => prev + PAGE_SIZE)
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
      run: () => { setMarksDraft(JSON.stringify({ stars: [...stars], notes }, null, 2)); setMarksOpen(true) }
    }
  ])

  const run = async (action: () => Promise<unknown>, success?: string, progressLabel?: string): Promise<void> => {
    setBusy(true)
    setLastError(null)
    if (progressLabel) setProgress({ label: progressLabel, seconds: 0 })
    try {
      await action()
      await reload()
      // Любая операция панели может пополнить корзину (удаление, замена).
      void refreshTrash()
      if (success) { toast.success(success); setAnnounce(success); notifyDone(success) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      toast.error(message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
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
  const endBatch = (): void => { setBatchTotal(null); setBatchDone(null); abortBatch.current = false }

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

  const saveSets = (next: Record<string, string[]>): void => {
    setSets(next)
    try { localStorage.setItem(imageStudioSetsKey(conversationId), JSON.stringify(next)) } catch { /* приватный режим */ }
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

  const generate = (): void => {
    if (busy || !prompt.trim()) return
    const cleaned = prompt.trim()
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
    const launch = (): Promise<void> => run(async () => {
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
      // Дубликат — вопрос до всего остального: если человек его пропускает,
      // ни имена, ни квота для этого файла уже не важны.
      const duplicates = await findDuplicates(all)
      let items = all
      if (duplicates.size) {
        const pairs = [...duplicates.entries()].map(([from, to]) => `«${from}» = «${to}»`).join(', ')
        const keepCopies = await confirm({
          title: duplicates.size === 1 ? 'Такая картинка уже есть в галерее' : `Уже есть в галерее: ${duplicates.size} из ${all.length}`,
          message: `${pairs}. «Загрузить копию» добавит ещё один файл, «Отмена» пропустит совпадения.`,
          confirmLabel: 'Загрузить копию'
        })
        if (!keepCopies) {
          items = all.filter((file) => !duplicates.has(file.name))
          if (!items.length) {
            toast.info(all.length === 1 ? 'Эта картинка уже есть в галерее — ничего не загружено' : 'Все выбранные картинки уже есть в галерее')
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
          const shrunk = await shrinkOversized(file)
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
          ...(stars.has(file.path) ? { starred: true } : {})
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
  const fileExt = (path: string): string => path.toLowerCase().split('.').pop() ?? ''
  // Типы, которые реально лежат в галерее: селект с пятью пунктами, из которых
  // четыре ничего не находят, только мешает.
  const presentKinds = [...new Set(files.map((file) => fileExt(file.path)))].sort()
  const shown = files
    .filter((file) => !kindFilter || fileExt(file.path) === kindFilter)
    // «Нарисованные» — с промптом (модель), «свои» — без промпта: у файла с
    // диска его нет, а у результата обработки нет и подавно.
    .filter((file) => !originFilter || (originFilter === 'ai' ? Boolean(file.prompt) : !file.prompt))
    .filter((file) => !freshOnly || fresh.has(file.path))
    .filter((file) => !sinceVisitOnly || file.updatedAt > seenAt)
    .filter((file) => !starsOnly || stars.has(file.path))
    // Искать по промпту так же естественно, как по имени: «где был кит» —
    // это про содержание картинки, а имя у неё часто автоматическое.
    .filter((file) => matchesQuery(filter.trim(), [file.path, file.prompt, notes[file.path]]))
    .sort((left, right) => {
      if (order === 'name') return left.path.localeCompare(right.path, 'ru', { numeric: true })
      if (order === 'size') return right.size - left.size
      // «Сначала избранные»: внутри группы порядок обычный, по свежести.
      if (order === 'stars' && stars.has(left.path) !== stars.has(right.path)) return stars.has(left.path) ? -1 : 1
      return right.updatedAt - left.updatedAt
    })
  const paged = shown.slice(0, visibleCount)
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
    onTransform: (kindName) => {
      const kind = IMAGE_TRANSFORMS.find((item) => item.kind === kindName)
      if (!kind) return
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
      const launch = (): Promise<void> => run(async () => {
        await api['imgstudio:generate']({ conversationId, prompt: cleaned, references: refs, ...(nameFromPrompt(cleaned) ? { name: nameFromPrompt(cleaned) } : {}) })
        setPrompt('')
        try { localStorage.removeItem(imageStudioDraftKey(conversationId)) } catch { /* приватный режим */ }
        setMulti(null)
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
    onCaptionNames: () => {
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
            const result = await captionImage(blob, file.path)
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
    onDelete: () => void (async () => {
      const picked = multi
      if (!picked || picked.size === 0) return
      if (!(await confirm({ title: `Удалить ${picked.size} файл(ов)?`, message: 'Файлы уедут в корзину — вернуть их можно оттуда или кнопкой «Вернуть».', confirmLabel: 'Удалить' }))) return
      const doomed = [...picked]
      await run(async () => {
        for (const path of doomed) await api['imgstudio:delete']({ conversationId, path })
      }, `Удалено файлов: ${doomed.length}`)
      setLastDeleted(doomed)
      setMulti(new Set())
      if (selected && picked.has(selected)) setSelected(null)
    })()
  }

  /**
   * Карточка галереи. Вынесена в функцию, потому что сетка теперь рисуется
   * либо одним списком, либо секциями по датам — а разметка карточки одна.
   */
              const renderCard = (file: ImageStudioFile): JSX.Element => <div role="listitem" key={file.path} data-path={file.path} className={`image-studio-card${selected === file.path ? ' image-studio-card--selected' : ''}`}
                onContextMenu={(event) => {
                  // Правый клик — короткий путь к частым действиям: иконок в
                  // строке карточки уже восемь, и попадать в них мышью тесно.
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
                    : <span className="image-studio-thumb-loading" role="status">…</span>}
                {fresh.has(file.path) && <span className="image-studio-fresh" aria-label="Новая картинка">новое</span>}
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
                  const apply = (): void => void run(async () => {
                    await api['imgstudio:rename']({ conversationId, from: file.path, to: target })
                    moveMarks(file.path, target)
                    setRenaming(null)
                    if (selected === file.path) setSelected(target)
                  }, 'Переименовано')
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
                    <span role="button" tabIndex={0} aria-label={`Скопировать имя ${file.path}`} className="image-studio-name" title={`${file.path} · ${formatBytes(file.size)}${dimensions[file.path] ? ` · ${dimensions[file.path]}` : ''}\nОбновлён: ${new Date(file.updatedAt).toLocaleString('ru-RU')}${file.tookMs ? `\nСгенерировано за ${Math.round(file.tookMs / 1000)} с` : ''}${file.prompt ? `\nПромпт: ${file.prompt}` : ''}${notes[file.path] ? `\nЗаметка: ${notes[file.path]}` : ''}${file.source ? `\nИз: ${file.source}` : ''}\nКлик — скопировать имя`}
                      onClick={() => { void navigator.clipboard?.writeText(file.path).then(() => toast.success('Имя скопировано')).catch(() => undefined) }}
                      onKeyDown={(event) => { if (event.key === 'Enter') { void navigator.clipboard?.writeText(file.path).then(() => toast.success('Имя скопировано')).catch(() => undefined) } }}>
                      {filter.trim()
                        ? highlightParts(file.path, filter.trim()).map((part, index) => part.hit
                            ? <mark key={index} className="image-studio-hit">{part.text}</mark>
                            : <span key={index}>{part.text}</span>)
                        : file.path}
                      {dimensions[file.path] && <small className="image-studio-dim"> {dimensions[file.path]}{aspectLabel(dimensions[file.path]!) ? ` · ${aspectLabel(dimensions[file.path]!)}` : ''}</small>}
                      {file.source && <small className="image-studio-dim image-studio-source"> из {file.source}</small>}
                    </span>
                    <span className="image-studio-card-actions">
                      {phone
                        ? <IconButton size="sm" aria-label={`Действия ${file.path}`} title="Действия" onClick={(event) => {
                            const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            setMenu({ path: file.path, x: Math.round(box.left), y: Math.round(box.bottom + 4) })
                          }}>⋯</IconButton>
                        : <>
                      <IconButton size="sm" aria-label={stars.has(file.path) ? `Убрать ${file.path} из избранного` : `В избранное ${file.path}`} title={stars.has(file.path) ? 'Убрать из избранного' : 'В избранное'} aria-pressed={stars.has(file.path)} onClick={() => toggleStar(file.path)}>{stars.has(file.path) ? '★' : '☆'}</IconButton>
                      <IconButton size="sm" aria-label={`Открыть ${file.path} в полный размер`} title="В полный размер" onClick={() => setViewing(file.path)}>⛶</IconButton>
                      {file.prompt && <IconButton size="sm" aria-label={`Показать похожие на ${file.path}`} title="Похожие: тот же промпт" onClick={() => {
                        // Фильтр ищет и по промпту, поэтому «похожие» — это тот же
                        // поиск по началу промпта: правки и вариации попадут все.
                        setFilter(file.prompt!.slice(0, 40))
                        setVisibleCount(PAGE_SIZE)
                        filterRef.current?.focus()
                      }}>≈</IconButton>}
                      <IconButton size="sm" aria-label={`Нарисовать вариацию ${file.path}`} title="Вариация" disabled={busy} onClick={() => variate(file)}>✦</IconButton>

                      {onAttachToChat && <IconButton size="sm" aria-label={`Прикрепить ${file.path} к сообщению`} title="В сообщение чата" onClick={() => void blobOf(file.path).then((blob) => { onAttachToChat(new File([blob], file.path, { type: blob.type })); toast.success(`«${file.path}» прикреплена к сообщению`) }).catch(() => toast.error('Не удалось прочитать файл'))}>📎</IconButton>}
                      <IconButton size="sm" aria-label={`Инструменты обработки ${file.path}`} title="Обработка (поворот, зеркало…)" aria-expanded={toolsFor === file.path} onClick={() => setToolsFor(toolsFor === file.path ? null : file.path)}>🛠</IconButton>
                      <IconButton size="sm" aria-label={`Переименовать ${file.path}`} title="Переименовать" onClick={() => setRenaming({ from: file.path, to: file.path })}>✎</IconButton>
                      <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void (async () => {
                        if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
                        await run(() => api['imgstudio:delete']({ conversationId, path: file.path }), 'Удалено')
                        if (selected === file.path) setSelected(null)
                      })()}>✕</IconButton>
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
  const viewStep = (delta: number): void => {
    if (viewingIndex < 0 || !shown.length) return
    const next = shown[(viewingIndex + delta + shown.length) % shown.length]
    if (next) setViewing(next.path)
  }

  return <div
    ref={paneRef}
    className={`image-studio${dropActive ? ' image-studio--drop' : ''}`}
    data-testid="image-studio"
    onDoubleClick={(event) => {
      // Клик мимо карточек — «снять выбор»: раньше для этого искали крестик
      // в чипе или жали Esc, стоя в поле промпта.
      const target = event.target as HTMLElement
      if (target.closest('.image-studio-card') || target.closest('.image-studio-toolbar') || target.closest('.image-studio-filter')) return
      if (selected) setSelected(null)
    }}
    onScroll={(event) => {
      const top = event.currentTarget.scrollTop
      try { sessionStorage.setItem(imageStudioScrollKey(conversationId), String(Math.round(top))) } catch { /* приватный режим */ }
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
      if (event.key === 'Escape' && multi) { setMulti(null); return }
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
        if (event.key.toLowerCase() === 'f' && selected) { event.preventDefault(); toggleStar(selected); return }
        if (event.key.toLowerCase() === 's' && selected) { event.preventDefault(); void download(selected); return }
        if (event.key.toLowerCase() === 'c' && selected) {
          event.preventDefault()
          copy(files.find((file) => file.path === selected) ?? { path: selected, size: 0, updatedAt: 0 })
          return
        }
      }
      // Клавиатурная навигация по сетке: без неё выбрать картинку можно только
      // мышью, а весь остальной сценарий (правка, Delete) уже клавиатурный.
      if (!typing && !renaming && shown.length && event.key.startsWith('Arrow')) {
        const template = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns : ''
        const columns = Math.max(1, template.split(' ').filter(Boolean).length)
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : -columns
        const current = selected ? shown.findIndex((file) => file.path === selected) : -1
        const next = current < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, current + step))
        const path = shown[next]?.path
        if (!path) return
        event.preventDefault()
        setSelected(path)
        // Карточка может лежать за «Показать ещё» — доращиваем страницу.
        setVisibleCount((prev) => next >= prev ? next + PAGE_SIZE : prev)
        setTimeout(() => {
          const card = document.querySelector(`[data-path="${CSS.escape(path)}"]`)
          card?.scrollIntoView?.({ block: 'nearest' })
          ;(card?.querySelector('.image-studio-thumb') as HTMLElement | null)?.focus?.()
        }, 0)
        return
      }
      // Enter на выбранной карточке — то же, что двойной клик по превью.
      if (!typing && !renaming && event.key === 'Enter' && selected) {
        event.preventDefault()
        setViewing(selected)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !renaming && (event.target as HTMLElement).tagName !== 'TEXTAREA' && (event.target as HTMLElement).tagName !== 'INPUT') {
        event.preventDefault()
        void (async () => {
          if (!(await confirm({ title: `Удалить «${selected}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
          const path = selected
          setSelected(null)
          await run(() => api['imgstudio:delete']({ conversationId, path }), 'Удалено')
          promptRef.current?.focus()
        })()
      }
    }}
  >
    <div className="image-studio-toolbar">
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
      {prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars * 0.2 && <p className={`image-studio-progress${prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars ? ' image-studio-quota--warn' : ''}`}>
        {prompt.length} / {IMAGE_STUDIO_LIMITS.maxPromptChars}{prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars ? ' — промпт слишком длинный' : ''}
      </p>}
      {(pinned.length > 0 || recent.length > 0) && !prompt && <div className="image-studio-recent" aria-label="Недавние промпты">
        {pinned.map((text) => <span key={`pin-${text}`} className="image-studio-chip image-studio-chip--pinned">
          <button type="button" className="image-studio-chip-text" title={text} onClick={() => { setPrompt(text); promptRef.current?.focus() }}>★ {text.length > 36 ? `${text.slice(0, 36)}…` : text}</button>
          <button type="button" className="image-studio-chip-pin" aria-label={`Открепить промпт: ${text.slice(0, 40)}`} title="Открепить" onClick={() => togglePin(text)}>×</button>
        </span>)}
        {recent.filter((text) => !pinned.includes(text)).map((text) => <span key={text} className="image-studio-chip">
          <button type="button" className="image-studio-chip-text" title={text} onClick={() => { setPrompt(text); promptRef.current?.focus() }}>{text.length > 36 ? `${text.slice(0, 36)}…` : text}</button>
          <button type="button" className="image-studio-chip-pin" aria-label={`Закрепить промпт: ${text.slice(0, 40)}`} title="Закрепить" onClick={() => togglePin(text)}>☆</button>
        </span>)}
        {recent.length > 0 && <button type="button" className="image-studio-chip" aria-label="Очистить историю промптов" title="Очистить историю" onClick={() => { setRecent([]); try { localStorage.removeItem(imageStudioPromptsKey(conversationId)) } catch { /* приватный режим */ } }}>×</button>}
      </div>}
      <div className="image-studio-actions">
        <Button size="sm" disabled={busy || !prompt.trim() || prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars} loading={busy} title={`⌘Enter / Ctrl+Enter${prompt.trim() ? `\nУйдёт модели:\n${prompt.trim()}${style && !selected ? `\nСтиль: ${style}.` : ''}${size && !selected ? `\nРазмер изображения: ${size.replace('×', 'x')}` : ''}${negative.trim() && !selected ? `\nНе должно быть: ${negative.trim()}.` : ''}${noText ? '\nНе добавляй на изображение никакой текст…' : ''}` : ''}`} onClick={generate}>
          {selected ? 'Изменить выбранную' : 'Нарисовать'}
        </Button>
        {!selected && <select aria-label="Стиль изображения" value={style} disabled={busy} onChange={(event) => { setStyle(event.target.value); try { localStorage.setItem(imageStudioStyleKey(conversationId), event.target.value); localStorage.setItem(IMAGE_STUDIO_STYLE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {STYLE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Стиль: авто' : preset}</option>)}
        </select>}
        {!selected && <select aria-label="Размер изображения" value={size} disabled={busy} onChange={(event) => { setSize(event.target.value); try { localStorage.setItem(imageStudioSizeKey(conversationId), event.target.value); localStorage.setItem(IMAGE_STUDIO_SIZE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {SIZE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Размер: авто' : preset === '1200×630' ? '1200×630 (OG-превью)' : preset === '1080×1080' ? '1080×1080 (пост)' : preset === '1280×720' ? '1280×720 (обложка)' : preset === '1080×1350' ? '1080×1350 (портрет)' : preset === '1500×500' ? '1500×500 (баннер)' : preset}</option>)}
        </select>}
        <label className="image-studio-check" title="Дописывает к промпту запрет на надписи">
          <input type="checkbox" checked={noText} onChange={(event) => { setNoText(event.target.checked); try { localStorage.setItem(IMAGE_STUDIO_NO_TEXT_KEY, event.target.checked ? '1' : '0') } catch { /* приватный режим */ } }} />
          без текста
        </label>
        {!selected && <span className="image-studio-negative">
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
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>Загрузить…</Button>
        {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Снять выбор</Button>}
        <input ref={uploadRef} type="file" accept="image/*,.svg" multiple hidden aria-label="Файл изображения" onChange={(event) => { if (event.target.files?.length) upload(event.target.files); event.target.value = '' }} />
      </div>
      {progress && <p className="image-studio-progress" role="status">
        {progress.label}… {progress.seconds} с. {progress.seconds > 90 ? 'Дольше обычного — можно отменить и упростить промпт.' : 'Обычно это занимает до минуты.'}
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

    {files.length >= 2 && <div className="image-studio-filter">
      <ImageStudioFilters
        showSearch={files.length >= FILTER_THRESHOLD}
        searchRef={filterRef}
        query={filter}
        onQuery={(value) => { setFilter(value); setVisibleCount(PAGE_SIZE) }}
        found={filter.trim() ? shown.length : null}
        activeCount={[Boolean(filter.trim()), Boolean(kindFilter), Boolean(originFilter), starsOnly, freshOnly, sinceVisitOnly].filter(Boolean).length}
        onReset={() => {
          setFilter('')
          setKindFilter('')
          setOriginFilter('')
          setStarsOnly(false)
          setFreshOnly(false)
          setSinceVisitOnly(false)
          setVisibleCount(PAGE_SIZE)
        }}
        showOrigin={files.some((file) => file.prompt) && files.some((file) => !file.prompt)}
        origin={originFilter}
        onOrigin={(value) => { setOriginFilter(value); setVisibleCount(PAGE_SIZE) }}
        missed={seenAt ? files.filter((file) => file.updatedAt > seenAt).length : 0}
        sinceVisitOnly={sinceVisitOnly}
        onSinceVisitOnly={() => { setSinceVisitOnly((prev) => !prev); setVisibleCount(PAGE_SIZE) }}
        grouped={grouped}
        onGrouped={() => setGrouped((prev) => !prev)}
        freshCount={fresh.size}
        freshOnly={freshOnly}
        onFreshOnly={() => { setFreshOnly((prev) => !prev); setVisibleCount(PAGE_SIZE) }}
        kinds={presentKinds}
        kind={kindFilter}
        onKind={(value) => { setKindFilter(value); setVisibleCount(PAGE_SIZE) }}
        orderLabel={order === 'new' ? 'Сначала новые' : order === 'name' ? 'По имени' : order === 'size' ? 'По размеру' : 'Сначала избранные'}
        onOrderNext={() => {
          const next = order === 'new' ? 'name' : order === 'name' ? 'size' : order === 'size' ? 'stars' : 'new'
          setOrder(next)
          try { localStorage.setItem(IMAGE_STUDIO_ORDER_KEY, next) } catch { /* приватный режим */ }
        }}
      />
      <Button size="sm" variant="ghost" disabled={busy || !shown.length} onClick={() => downloadAll(shown)}>Скачать архивом</Button>
      <Button size="sm" variant="ghost" disabled={!shown.length} title="Markdown-таблица: имя, размер, пиксели, промпт, заметка" onClick={() => {
        const text = inventoryMarkdown(shown, { dimensions, notes })
        void navigator.clipboard?.writeText(text).then(() => toast.success('Список скопирован таблицей')).catch(() => toast.error('Буфер обмена недоступен'))
      }}>Список в буфер</Button>
      {files.length >= 2 && <Button size="sm" variant="ghost" disabled={busy} title="Сравнить содержимое файлов и отметить лишние копии" onClick={() => void (async () => {
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
      })()}>Найти дубликаты</Button>}
      {files.length >= 2 && <Button size="sm" variant="ghost" disabled={busy} title="Прочитать все файлы и показать те, что не открываются" onClick={() => void (async () => {
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
          toast.error(`Не читаются файлы: ${bad.length}`)
        } finally {
          endBatch()
          setProgress(null)
          setBusy(false)
        }
      })()}>Проверить файлы</Button>}
      {shown.some((file) => file.prompt) && <Button size="sm" variant="ghost" onClick={() => {
        const text = shown.filter((file) => file.prompt).map((file) => `${file.path}: ${file.prompt}`).join('\n')
        void navigator.clipboard?.writeText(text).then(() => toast.success('Промпты скопированы')).catch(() => toast.error('Буфер обмена недоступен'))
      }}>Промпты в буфер</Button>}
      <IconButton size="sm" aria-label={`Фон сетки: ${gridBg === 'checker' ? 'шахматка' : gridBg === 'light' ? 'светлый' : 'тёмный'} — сменить`} title={`Фон сетки: ${gridBg === 'checker' ? 'шахматка' : gridBg === 'light' ? 'светлый' : 'тёмный'}`} onClick={() => setGridBg((prev) => {
        const next = prev === 'checker' ? 'light' : prev === 'light' ? 'dark' : 'checker'
        try { localStorage.setItem(IMAGE_STUDIO_GRID_BG_KEY, next) } catch { /* приватный режим */ }
        return next
      })}>◧</IconButton>
      <IconButton size="sm" aria-label={dense ? 'Крупные карточки' : 'Мелкие карточки'} title={dense ? 'Крупнее' : 'Мельче'} onClick={() => setDense((prev) => { const next = !prev; try { localStorage.setItem(IMAGE_STUDIO_DENSE_KEY, next ? '1' : '0') } catch { /* приватный режим */ } return next })}>{dense ? '▦' : '▤'}</IconButton>
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
      <IconButton size="sm" aria-label={starsOnly ? 'Показать все файлы' : 'Показать только избранные'} title={starsOnly ? 'Все файлы' : 'Только избранные'} aria-pressed={starsOnly} onClick={() => setStarsOnly((prev) => !prev)}>{starsOnly ? '★' : '☆'}</IconButton>
      <IconButton size="sm" aria-label="Обновить галерею" title="Обновить" onClick={() => void reload()}>↻</IconButton>
      {typeof Notification === 'function' && Notification.permission === 'default' && <Button size="sm" variant="ghost" title="Показывать системное уведомление, когда картинка готова и вкладка в фоне" onClick={() => void Notification.requestPermission().then((result) => {
        if (result === 'granted') toast.success('Уведомления включены — сообщим, когда картинка будет готова')
        else toast.info('Без уведомлений: о готовности скажет заголовок вкладки и короткий сигнал')
      }).catch(() => undefined)}>Уведомлять…</Button>}
      <IconButton size="sm" aria-label="Горячие клавиши галереи" title="Клавиши (?)" onClick={() => setKeysOpen(true)}>?</IconButton>
      <Button size="sm" variant="ghost" title="Звёзды и заметки текстом: перенести в другой браузер" onClick={() => {
        setMarksDraft(JSON.stringify({ stars: [...stars], notes }, null, 2))
        setMarksOpen(true)
      }}>Пометки…</Button>
      <Button size="sm" variant="ghost" aria-expanded={trashOpen} title={trashCount ? `В корзине файлов: ${trashCount} (хранятся 7 дней)` : 'Корзина пуста'} onClick={() => {
        const next = !trashOpen
        setTrashOpen(next)
        if (next) void refreshTrash()
      }}>Корзина…{trashCount ? ` (${trashCount})` : ''}</Button>
      {Object.entries(sets).map(([name, list]) => <span key={name} className="image-studio-chip">
        <button type="button" className="image-studio-chip-text" title={`Выбрать набор «${name}» (${list.length})`} onClick={() => {
          // Файлы могли исчезнуть — берём только существующие, иначе выбор
          // показывал бы «выбрано 5 из 3».
          const alive = list.filter((path) => files.some((file) => file.path === path))
          setMulti(new Set(alive))
          if (alive.length < list.length) toast.info(`Часть набора «${name}» уже удалена: ${list.length - alive.length}`)
        }}>▤ {name} ({list.length})</button>
        <button type="button" className="image-studio-chip-pin" aria-label={`Забыть набор ${name}`} title="Забыть набор" onClick={() => {
          const next = { ...sets }
          delete next[name]
          saveSets(next)
        }}>×</button>
      </span>)}
      <Button size="sm" variant="ghost" onClick={() => setMulti(multi ? null : new Set())}>{multi ? 'Готово' : 'Выбрать несколько'}</Button>
      {multi && <ImageStudioBatchBar
        selected={multi}
        total={shown.length}
        bytes={shown.filter((file) => multi.has(file.path)).reduce((sum, file) => sum + file.size, 0)}
        busy={busy}
        allStarred={multi.size > 0 && [...multi].every((path) => stars.has(path))}
        otherChats={otherChats ?? []}
        renameTemplate={renameTemplate}
        onRenameTemplateChange={setRenameTemplate}
        noteDraft={batchNote}
        onNoteDraftChange={setBatchNote}
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
      })()}>Очистить корзину ({trash.length})</Button>}
      {trash.length === 0
        ? <span className="image-studio-dim">Корзина пуста — удалённое хранится здесь 7 дней.</span>
        : trash.map((item) => <span key={`${item.name}-${item.deletedAt}`} className="image-studio-chip">
            <span className="image-studio-chip-text">{item.name}</span>
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
    </div>}
    {files.length === 0
      ? <div>
          <EmptyState title="Галерея пуста — нарисуйте первую картинку" description="Опишите её в поле выше, перетащите файлы сюда или попросите ассистента в чате слева: всё нарисованное попадает сюда." />
          <div className="image-studio-recent image-studio-examples" aria-label="Примеры промптов">
            {PROMPT_EXAMPLES.map((example) => <button key={example} type="button" className="image-studio-chip" onClick={() => { setPrompt(example); promptRef.current?.focus() }}>{example}</button>)}
          </div>
        </div>
      : shown.length === 0
        ? <EmptyState compact title="Ничего не нашлось" description="Уточните фильтр или очистите его, чтобы увидеть всю галерею." actionLabel="Показать все" onAction={() => setFilter('')} />
        : <>
          {grouped
            ? groupByDay(paged).map((group) => <section key={group.title} className="image-studio-group" aria-label={group.title}>
                <h3 className="image-studio-group-title">{group.title} <small className="image-studio-dim">{group.files.length}</small></h3>
                <div className={`image-studio-grid image-studio-bg--${gridBg}${dense ? ' image-studio-grid--dense' : ''}`} role="list" aria-label={`Галерея изображений: ${group.title.toLowerCase()}`}>
                  {group.files.map(renderCard)}
                </div>
              </section>)
            : <div ref={gridRef} className={`image-studio-grid image-studio-bg--${gridBg}${dense ? ' image-studio-grid--dense' : ''}`} role="list" aria-label="Галерея изображений" aria-busy={busy || undefined}>
                {progress && <div role="listitem" className="image-studio-card image-studio-card--ghost" aria-hidden="true">
                  <div className="image-studio-thumb image-studio-thumb--ghost"><Skeleton item="block" height={120} /></div>
                  <span className="image-studio-name">{progress.label}…</span>
                </div>}
              {paged.map(renderCard)}
            </div>}
          {shown.length > visibleCount && <div ref={moreRef} className="image-studio-more">
            <Button size="sm" variant="ghost" onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}>
              Показать ещё ({shown.length - visibleCount})
            </Button>
          </div>}
          <div className="image-studio-quota-bar" role="presentation" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round(usedBytes / IMAGE_STUDIO_LIMITS.maxConversationBytes * 100))}%` }} className={usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? 'image-studio-quota-bar--warn' : undefined} />
          </div>
          <p className={`image-studio-quota${usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? ' image-studio-quota--warn' : ''}`}>
            {files.length === 1 ? '1 файл' : `Файлов: ${files.length}`} · занято {formatBytes(usedBytes)} из {formatBytes(IMAGE_STUDIO_LIMITS.maxConversationBytes)}
            {usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 && ' — место кончается, удалите ненужное'}
          </p>
        </>}

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
        {item('Три вариации подряд', () => variateSeries(file, 3))}
        {item('Дубликат', () => duplicate(file))}
        {item('Переименовать', () => setRenaming({ from: file.path, to: file.path }))}
        {item('Инструменты обработки', () => setToolsFor(file.path))}
        {item('Удалить', () => void (async () => {
          if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Файл уедет в корзину — вернуть его можно оттуда.', confirmLabel: 'Удалить' }))) return
          await run(() => api['imgstudio:delete']({ conversationId, path: file.path }), 'Удалено')
          if (selected === file.path) setSelected(null)
        })())}
      </div>
    })()}

    {keysOpen && <Dialog title="Клавиши галереи" onClose={() => setKeysOpen(false)} size="sm" padded>
      <dl className="image-studio-keys">
        <dt>← → ↑ ↓</dt><dd>перейти по сетке (выбор для правки)</dd>
        <dt>Enter</dt><dd>открыть выбранную на весь экран</dd>
        <dt>Delete</dt><dd>удалить выбранную (с подтверждением)</dd>
        <dt>Esc</dt><dd>снять выбор картинки или выйти из мультирежима</dd>
        <dt>⌘/Ctrl + Enter</dt><dd>запустить рисование из поля промпта</dd>
        <dt>⌘/Ctrl + A</dt><dd>в мультирежиме — выбрать все видимые</dd>
        <dt>Shift + клик</dt><dd>в мультирежиме — отметить диапазон</dd>
        <dt>/</dt><dd>перейти в поиск</dd>
        <dt>u</dt><dd>выбрать файлы для загрузки</dd>
        <dt>f</dt><dd>избранное для выбранной</dd>
        <dt>s</dt><dd>скачать выбранную</dd>
        <dt>c</dt><dd>копировать выбранную в буфер</dd>
        <dt>g</dt><dd>группы по датам вкл/выкл</dd>
        <dt>b</dt><dd>фон сетки: шахматка → светлый → тёмный</dd>
        <dt>m</dt><dd>меню действий выбранной</dd>
        <dt>?</dt><dd>общая шпаргалка приложения (эта — по кнопке «?» в галерее)</dd>
      </dl>
      <p className="image-studio-dim">Буквенные клавиши работают, когда фокус в галерее, а не в поле ввода.</p>
    </Dialog>}

    {marksOpen && <Dialog title="Звёзды и заметки" onClose={() => setMarksOpen(false)} size="sm" padded actions={<>
      <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(marksDraft).then(() => toast.success('Пометки скопированы')).catch(() => toast.error('Буфер обмена недоступен'))}>Скопировать</Button>
      <Button onClick={() => {
        // Пометки живут в этом браузере, поэтому единственный способ забрать
        // их с собой — текстом: вставил в другом браузере и применил.
        try {
          const parsed: unknown = JSON.parse(marksDraft)
          const data = parsed && typeof parsed === 'object' ? parsed as { stars?: unknown; notes?: unknown } : {}
          const nextStars = new Set(Array.isArray(data.stars) ? data.stars.filter((item): item is string => typeof item === 'string') : [])
          const rawNotes = data.notes && typeof data.notes === 'object' ? data.notes as Record<string, unknown> : {}
          const nextNotes: Record<string, string> = {}
          for (const [key, value] of Object.entries(rawNotes)) if (typeof value === 'string') nextNotes[key] = value
          setStars(nextStars)
          setNotes(nextNotes)
          try {
            localStorage.setItem(imageStudioStarsKey(conversationId), JSON.stringify([...nextStars]))
            localStorage.setItem(imageStudioNotesKey(conversationId), JSON.stringify(nextNotes))
          } catch { /* приватный режим */ }
          setMarksOpen(false)
          toast.success(`Применено: звёзд ${nextStars.size}, заметок ${Object.keys(nextNotes).length}`)
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
      canStep={shown.length > 1}
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
      onPalette={(path) => blobOf(path).then((blob) => extractPalette(blob))}
      onHistogram={(path) => blobOf(path).then((blob) => histogramOf(blob))}
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
      position={viewingIndex >= 0 ? { index: viewingIndex, total: shown.length } : undefined}
      onDelete={(path) => void (async () => {
        if (!(await confirm({ title: `Удалить «${path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
        // После удаления открываем соседний файл, а не пустой лайтбокс.
        const rest = shown.filter((file) => file.path !== path)
        setViewing(rest[Math.min(viewingIndex, rest.length - 1)]?.path ?? null)
        if (selected === path) setSelected(null)
        await run(() => api['imgstudio:delete']({ conversationId, path }), 'Удалено')
      })()}
      onClose={() => { setViewing(null); setCompare(false); setCompareWith(null); setCompareGrid(null) }}
    />}
  </div>
}
