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
import { copyImage } from '../lib/clipboard'
import { buildZip } from '../lib/zipStore'
import { applyImageTransform, cropImage, IMAGE_TRANSFORMS, transformName } from '../lib/imageTransform'
import { annotateImage } from '../lib/imageAnnotate'
import { getCachedPreview, putCachedPreview } from '../lib/previewCache'
import { playStopCue } from '../lib/cues'
import { ImageStudioViewer } from './ImageStudioViewer'
import { ImageStudioToolsRow } from './ImageStudioToolsRow'
import { IMAGE_STUDIO_DENSE_KEY, IMAGE_STUDIO_NO_TEXT_KEY, IMAGE_STUDIO_ORDER_KEY, IMAGE_STUDIO_SIZE_KEY, IMAGE_STUDIO_STYLE_KEY, imageStudioDraftKey, imageStudioPinnedKey, imageStudioPromptsKey } from '../store/contracts'

type StudioApi = Pick<RendererApi,
  'imgstudio:list' | 'imgstudio:read' | 'imgstudio:upload' | 'imgstudio:delete' |
  'imgstudio:rename' | 'imgstudio:generate' | 'imgstudio:edit' | 'imgstudio:cancel' |
  'imgstudio:publish' | 'imgstudio:publication' | 'imgstudio:unpublish' | 'imgstudio:run' | 'imgstudio:transfer' |
  'imgstudio:trash' | 'imgstudio:restore'> &
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
const SIZE_PRESETS = ['', '512×512', '1024×1024', '1920×1080', '1200×630', '1080×1080', '1280×720'] as const
/** Сколько последних промптов помним на разговор. */
const RECENT_LIMIT = 4
/** Фильтр по имени появляется, когда глазами искать уже неудобно. */
const FILTER_THRESHOLD = 7
/** Сколько карточек рендерим сразу; дальше — «Показать ещё». */
const PAGE_SIZE = 60
/** Примеры для пустой галереи: первый промпт проще подсмотреть, чем придумать. */
const PROMPT_EXAMPLES = [
  'Логотип-щит с молнией, плоский стиль, два цвета',
  'Акварельный пейзаж: горы на рассвете',
  'Иконка папки с фотографиями, минимализм'
] as const

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

export function ImageStudioPane({ conversationId, api, turnActive, onAttachToChat, otherChats }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
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
      const saved = localStorage.getItem(IMAGE_STUDIO_SIZE_KEY) ?? ''
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
  /** Пресет стиля — добавка к промпту, как размер. */
  const [style, setStyle] = useState<string>(() => {
    try { return localStorage.getItem(IMAGE_STUDIO_STYLE_KEY) ?? '' } catch { return '' }
  })
  /** Режим множественного выбора: чекбоксы вместо выбора-для-правки. */
  const [multi, setMulti] = useState<Set<string> | null>(null)
  const [compare, setCompare] = useState(false)
  /** Пара «сравнить выбранные» из мультирежима (второй файл шторки). */
  const [compareWith, setCompareWith] = useState<string | null>(null)
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
  const [viewerPassword, setViewerPassword] = useState('')
  const [filter, setFilter] = useState('')
  const [order, setOrder] = useState<'new' | 'name' | 'size'>(() => {
    try {
      const saved = localStorage.getItem(IMAGE_STUDIO_ORDER_KEY)
      return saved === 'name' || saved === 'size' ? saved : 'new'
    } catch { return 'new' }
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
      for (const file of list) {
        if (previewKeys.current[file.path] === file.updatedAt) continue
        previewKeys.current[file.path] = file.updatedAt
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
        // Сначала IndexedDB-кэш (мгновенно и без трафика), затем сеть.
        void getCachedPreview(conversationId, file.path, file.updatedAt).then((cached) => {
          if (cached) { applyBlob(cached); return }
          return api['imgstudio:read']({ conversationId, path: file.path }).then(({ dataBase64 }) => {
            const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
            const blob = new Blob([bytes], { type: imageStudioMime(file.path) })
            applyBlob(blob)
            void putCachedPreview(conversationId, file.path, file.updatedAt, blob)
          })
        }).catch(() => {
          delete previewKeys.current[file.path]
          // Один автоповтор через 2 с: сетевые обрывы чаще всего мгновенные.
          if (!retriedOnce.current.has(file.path)) {
            retriedOnce.current.add(file.path)
            setTimeout(() => void reload(), 2000)
            return
          }
          setBroken((prev) => new Set(prev).add(file.path))
        })
      }
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
  // Промпт — главное действие панели: открыли студию → сразу можно печатать.
  useEffect(() => { promptRef.current?.focus() }, [conversationId])
  // Поле переименования открывается кнопкой ✎ — фокус руками, autoFocus в
  // React 18 с порталами срабатывает не всегда (видели живьём в браузере).
  useEffect(() => { if (renaming) renameRef.current?.focus() }, [renaming?.from])
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
  // Секундомер генерации: немой спиннер на минуту читается как «зависло».
  useEffect(() => {
    if (!progress) return
    const timer = setInterval(() => setProgress((prev) => prev && { ...prev, seconds: prev.seconds + 1 }), 1000)
    return () => clearInterval(timer)
  }, [progress?.label])

  const run = async (action: () => Promise<unknown>, success?: string, progressLabel?: string): Promise<void> => {
    setBusy(true)
    setLastError(null)
    if (progressLabel) setProgress({ label: progressLabel, seconds: 0 })
    try {
      await action()
      await reload()
      if (success) { toast.success(success); setAnnounce(success) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      toast.error(message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
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
    const fullPrompt = noText ? `${withSize}\nНе добавляй на изображение никакой текст, надписи и водяные знаки.` : withSize
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

  const upload = (list: FileList | File[]): void => {
    const items = Array.from(list)
    const bad = items.find((file) => !isImageStudioPath(file.name))
    if (bad) {
      toast.error(`«${bad.name}» — не изображение; студия принимает png, jpg, webp, gif, svg`)
      return
    }
    if (!items.length) return
    void run(async () => {
      for (const file of items) {
        const shrunk = await shrinkOversized(file)
        if (!shrunk) throw new Error(`«${file.name}» слишком большой (лимит ${formatBytes(IMAGE_STUDIO_LIMITS.maxFileBytes)}), и сжать его не вышло`)
        const buffer = await shrunk.blob.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
        await api['imgstudio:upload']({ conversationId, path: shrunk.name, dataBase64: btoa(binary) })
      }
    }, items.length === 1 ? `Загружено: ${items[0]!.name}` : `Загружено файлов: ${items.length}`,
      items.length > 1 ? `Загружаем ${items.length} файла(ов)` : undefined)
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
        const entries = [] as Array<{ name: string; data: Uint8Array }>
        for (const file of list) {
          const dataBase64 = await readBase64(file.path)
          entries.push({ name: file.path, data: Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0)) })
        }
        // Промпты — текстом рядом с картинками: архив самодостаточен.
        const promptLines = list.filter((file) => file.prompt).map((file) => `${file.path}: ${file.prompt}`)
        if (promptLines.length) entries.push({ name: 'prompts.txt', data: new TextEncoder().encode(promptLines.join('\n')) })
        const url = URL.createObjectURL(buildZip(entries))
        const link = document.createElement('a')
        link.href = url
        link.download = 'галерея.zip'
        link.click()
        URL.revokeObjectURL(url)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
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
  const shown = files
    .filter((file) => !filter.trim() || file.path.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((left, right) => order === 'name' ? left.path.localeCompare(right.path, 'ru', { numeric: true }) : order === 'size' ? right.size - left.size : right.updatedAt - left.updatedAt)
  const paged = shown.slice(0, visibleCount)
  const viewingIndex = viewing ? shown.findIndex((file) => file.path === viewing) : -1
  const viewStep = (delta: number): void => {
    if (viewingIndex < 0 || !shown.length) return
    const next = shown[(viewingIndex + delta + shown.length) % shown.length]
    if (next) setViewing(next.path)
  }

  return <div
    className={`image-studio${dropActive ? ' image-studio--drop' : ''}`}
    data-testid="image-studio"
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
        <Button size="sm" disabled={busy || !prompt.trim() || prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars} loading={busy} title={`⌘Enter / Ctrl+Enter${prompt.trim() ? `\nУйдёт модели:\n${prompt.trim()}${style && !selected ? `\nСтиль: ${style}.` : ''}${size && !selected ? `\nРазмер изображения: ${size.replace('×', 'x')}` : ''}${noText ? '\nНе добавляй на изображение никакой текст…' : ''}` : ''}`} onClick={generate}>
          {selected ? 'Изменить выбранную' : 'Нарисовать'}
        </Button>
        {!selected && <select aria-label="Стиль изображения" value={style} disabled={busy} onChange={(event) => { setStyle(event.target.value); try { localStorage.setItem(IMAGE_STUDIO_STYLE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {STYLE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Стиль: авто' : preset}</option>)}
        </select>}
        {!selected && <select aria-label="Размер изображения" value={size} disabled={busy} onChange={(event) => { setSize(event.target.value); try { localStorage.setItem(IMAGE_STUDIO_SIZE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {SIZE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Размер: авто' : preset === '1200×630' ? '1200×630 (OG-превью)' : preset === '1080×1080' ? '1080×1080 (пост)' : preset === '1280×720' ? '1280×720 (обложка)' : preset}</option>)}
        </select>}
        <label className="image-studio-check" title="Дописывает к промпту запрет на надписи">
          <input type="checkbox" checked={noText} onChange={(event) => { setNoText(event.target.checked); try { localStorage.setItem(IMAGE_STUDIO_NO_TEXT_KEY, event.target.checked ? '1' : '0') } catch { /* приватный режим */ } }} />
          без текста
        </label>
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
      </p>}
      <span className="vc-sr-only" role="status">{announce}</span>
      {lastCreated && !busy && <p className="image-studio-progress" role="status">
        Создано: {lastCreated}{' '}
        <button type="button" className="image-studio-cancel" onClick={() => {
          const path = lastCreated
          setLastCreated(null)
          void run(() => api['imgstudio:delete']({ conversationId, path }), `«${path}» отменён (лежит в корзине)`)
        }}>Отменить</button>
      </p>}
      {lastError && !busy && <ErrorState compact message={lastError} {...(lastAttempt ? { onRetry: () => { setLastError(null); lastAttempt() } } : {})} />}
    </div>

    {files.length >= 2 && <div className="image-studio-filter">
      {files.length >= FILTER_THRESHOLD && <input aria-label="Фильтр по имени файла" placeholder="Найти по имени…" value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(PAGE_SIZE) }} />}
      {filter.trim() && <span className="image-studio-dim">Найдено: {shown.length}</span>}
      <Button size="sm" variant="ghost" onClick={() => { const next = order === 'new' ? 'name' : order === 'name' ? 'size' : 'new'; setOrder(next); try { localStorage.setItem(IMAGE_STUDIO_ORDER_KEY, next) } catch { /* приватный режим */ } }}>
        {order === 'new' ? 'Сначала новые' : order === 'name' ? 'По имени' : 'По размеру'}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy || !shown.length} onClick={() => downloadAll(shown)}>Скачать архивом</Button>
      {shown.some((file) => file.prompt) && <Button size="sm" variant="ghost" onClick={() => {
        const text = shown.filter((file) => file.prompt).map((file) => `${file.path}: ${file.prompt}`).join('\n')
        void navigator.clipboard?.writeText(text).then(() => toast.success('Промпты скопированы')).catch(() => toast.error('Буфер обмена недоступен'))
      }}>Промпты в буфер</Button>}
      <IconButton size="sm" aria-label={dense ? 'Крупные карточки' : 'Мелкие карточки'} title={dense ? 'Крупнее' : 'Мельче'} onClick={() => setDense((prev) => { const next = !prev; try { localStorage.setItem(IMAGE_STUDIO_DENSE_KEY, next ? '1' : '0') } catch { /* приватный режим */ } return next })}>{dense ? '▦' : '▤'}</IconButton>
      {shareUrl === null && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void api['imgstudio:publish']({ conversationId }).then(({ url }) => {
        setShareUrl(url)
        const absolute = `${location.origin}${url}`
        void navigator.clipboard?.writeText(absolute).then(() => toast.success('Опубликовано — ссылка в буфере')).catch(() => toast.success(`Опубликовано: ${absolute}`))
      }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}>Поделиться</Button>}
      {typeof shareUrl === 'string' && <>
        <Button size="sm" variant="ghost" title={shareViews !== null ? `Просмотров всего: ${shareViews}${shareViews7 !== null ? ` · за 7 дней: ${shareViews7}` : ''}` : 'Скопировать ссылку'} onClick={() => {
          const absolute = `${location.origin}${shareUrl}`
          void navigator.clipboard?.writeText(absolute).then(() => toast.success('Ссылка в буфере')).catch(() => toast.info(absolute))
        }}>Ссылка на галерею{shareViews ? ` · ${shareViews} 👁` : ''}</Button>
        <Button size="sm" variant="ghost" onClick={() => window.open(shareUrl!, '_blank', 'noopener')}>Открыть страницу</Button>
        <Button size="sm" variant="ghost" title={shareProtected ? 'Пароль установлен — изменить или снять' : 'Закрыть галерею паролем для зрителей'} onClick={() => { setViewerPassword(''); setPasswordDialog(true) }}>{shareProtected ? 'Пароль 🔒' : 'Пароль…'}</Button>
        <Button size="sm" variant="ghost" onClick={() => void (async () => {
          if (!(await confirm({ title: 'Снять публикацию галереи?', message: 'Публичная ссылка перестанет открываться.', confirmLabel: 'Снять' }))) return
          await api['imgstudio:unpublish']({ conversationId }).then(() => { setShareUrl(null); toast.success('Публикация снята') }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
        })()}>Снять публикацию</Button>
      </>}
      <IconButton size="sm" aria-label="Обновить галерею" title="Обновить" onClick={() => void reload()}>↻</IconButton>
      <Button size="sm" variant="ghost" aria-expanded={trashOpen} onClick={() => {
        const next = !trashOpen
        setTrashOpen(next)
        if (next) void api['imgstudio:trash']({ conversationId }).then(({ items }) => setTrash(items)).catch(() => setTrash([]))
      }}>Корзина…</Button>
      <Button size="sm" variant="ghost" onClick={() => setMulti(multi ? null : new Set())}>{multi ? 'Готово' : 'Выбрать несколько'}</Button>
      {multi && <Button size="sm" variant="ghost" onClick={() => setMulti(new Set(shown.map((file) => file.path)))}>Выбрать все</Button>}
      {multi && <Button size="sm" variant="ghost" onClick={() => setMulti(new Set(shown.filter((file) => !multi.has(file.path)).map((file) => file.path)))}>Инвертировать</Button>}
      {multi && <span className="image-studio-dim" role="status">Выбрано {multi.size} из {shown.length}</span>}
      {multi && multi.size > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => downloadAll(shown.filter((file) => multi.has(file.path)))}>Скачать выбранные ({multi.size})</Button>}
      {multi && multi.size > 0 && <select aria-label="Обработать выбранные" disabled={busy} value="" onChange={(event) => {
        const kind = IMAGE_TRANSFORMS.find((item) => item.kind === event.target.value)
        if (!kind) return
        const targets = shown.filter((file) => multi.has(file.path))
        void run(async () => {
          for (const file of targets) {
            const blob = await blobOf(file.path)
            const result = await applyImageTransform(blob, kind.kind)
            const name = transformName(file.path, kind.suffix, new Set((files ?? []).map((item) => item.path).concat(targets.map((item) => item.path))), kind.ext ?? 'png')
            const buffer = new Uint8Array(await result.arrayBuffer())
            let binary = ''
            for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]!)
            await api['imgstudio:upload']({ conversationId, path: name, dataBase64: btoa(binary), source: file.path })
          }
          setMulti(new Set())
        }, `Обработано файлов: ${targets.length} (${kind.label.toLowerCase()})`)
      }}>
        <option value="">Обработать выбранные…</option>
        {IMAGE_TRANSFORMS.map((kind) => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
      </select>}
      {multi && multi.size > 0 && multi.size <= 4 && <Button size="sm" variant="ghost" disabled={busy} title="Нарисовать новую картинку по промпту, используя выбранные как образцы стиля" onClick={() => {
        const cleaned = prompt.trim()
        if (!cleaned) { toast.info('Сначала опишите в поле промпта, что нарисовать'); promptRef.current?.focus(); return }
        const refs = [...multi]
        rememberPrompt(cleaned)
        const launch = (): Promise<void> => run(async () => {
          await api['imgstudio:generate']({ conversationId, prompt: cleaned, references: refs, ...(nameFromPrompt(cleaned) ? { name: nameFromPrompt(cleaned) } : {}) })
          setPrompt('')
          try { localStorage.removeItem(imageStudioDraftKey(conversationId)) } catch { /* приватный режим */ }
          setMulti(null)
        }, 'Изображение готово', `Модель рисует по ${refs.length} референс(ам)`)
        setLastAttempt(() => launch)
        void launch()
      }}>Нарисовать с референсами ({multi.size})</Button>}
      {multi && multi.size === 2 && <Button size="sm" variant="ghost" onClick={() => {
        const [a, b] = [...multi]
        setCompareWith(a!)
        setViewing(b!)
        setCompare(true)
      }}>Сравнить выбранные</Button>}
      {multi && multi.size > 0 && (otherChats ?? []).length > 0 && <select aria-label="Перенести выбранные в другой чат" disabled={busy} value="" onChange={(event) => {
        const target = event.target.value
        if (!target) return
        const moved = [...multi]
        void run(async () => {
          for (const path of moved) await api['imgstudio:transfer']({ conversationId, path, to: target, copy: false })
          if (selected && multi.has(selected)) setSelected(null)
          setMulti(new Set())
        }, `Перенесено файлов: ${moved.length}`)
      }}>
        <option value="">Перенести выбранные в…</option>
        {(otherChats ?? []).map((chatItem) => <option key={chatItem.id} value={chatItem.id}>{chatItem.title}</option>)}
      </select>}
      {multi && multi.size > 0 && <Button size="sm" variant="danger" disabled={busy} onClick={() => void (async () => {
        if (!(await confirm({ title: `Удалить ${multi.size} файл(ов)?`, message: 'Восстановить изображения будет нельзя.', confirmLabel: 'Удалить' }))) return
        await run(async () => {
          for (const path of multi) await api['imgstudio:delete']({ conversationId, path })
        }, `Удалено файлов: ${multi.size}`)
        setMulti(new Set())
        if (selected && multi.has(selected)) setSelected(null)
      })()}>Удалить выбранные ({multi.size})</Button>}
    </div>}

    {trashOpen && <div className="image-studio-trash" role="group" aria-label="Корзина галереи">
      {trash.length === 0
        ? <span className="image-studio-dim">Корзина пуста — удалённое хранится здесь 7 дней.</span>
        : trash.map((item) => <span key={`${item.name}-${item.deletedAt}`} className="image-studio-chip">
            <span className="image-studio-chip-text">{item.name}</span>
            <button type="button" className="image-studio-chip-pin" aria-label={`Восстановить ${item.name}`} title="Восстановить" onClick={() => void run(async () => {
              await api['imgstudio:restore']({ conversationId, name: item.name })
              const { items } = await api['imgstudio:trash']({ conversationId })
              setTrash(items)
            }, `«${item.name}» восстановлен`)}>↩</button>
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
          <div className={`image-studio-grid${dense ? ' image-studio-grid--dense' : ''}`} role="list" aria-label="Галерея изображений" aria-busy={busy || undefined}>
            {progress && <div role="listitem" className="image-studio-card image-studio-card--ghost" aria-hidden="true">
              <div className="image-studio-thumb image-studio-thumb--ghost"><Skeleton item="block" height={120} /></div>
              <span className="image-studio-name">{progress.label}…</span>
            </div>}
            {paged.map((file) => <div role="listitem" key={file.path} data-path={file.path} className={`image-studio-card${selected === file.path ? ' image-studio-card--selected' : ''}`}>
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
              <input type="checkbox" aria-label={`Выбрать ${file.path}`} checked={multi.has(file.path)} onChange={(event) => {
                setMulti((prev) => { const next = new Set(prev); if (event.target.checked) next.add(file.path); else next.delete(file.path); return next })
              }} />
              выбрать
            </label>}
            {broken.has(file.path) && <Button size="sm" variant="ghost" onClick={() => void reload()}>Перечитать превью</Button>}
            {renaming?.from === file.path
              ? <div className="image-studio-rename">
                  <input
                    ref={renameRef}
                    aria-label="Новое имя файла"
                    value={renaming.to}
                    onChange={(event) => setRenaming({ from: file.path, to: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenaming(null)
                      if (event.key === 'Enter' && renaming.to.trim()) {
                        event.preventDefault()
                        const typed = renaming.to.trim()
                        const to = isImageStudioPath(typed) ? typed : `${typed}${file.path.slice(file.path.lastIndexOf('.'))}`
                        void run(async () => {
                          await api['imgstudio:rename']({ conversationId, from: file.path, to })
                          setRenaming(null)
                          if (selected === file.path) setSelected(to)
                        }, 'Переименовано')
                      }
                    }}
                  />
                  <Button size="sm" disabled={busy || !renaming.to.trim()}
                    title="Переименовать"
                    onClick={() => void run(async () => {
                      // Пользователь стёр расширение — дописываем исходное, а не
                      // заставляем вспоминать, что имя должно быть картинкой.
                      const typed = renaming.to.trim()
                      const to = isImageStudioPath(typed) ? typed : `${typed}${file.path.slice(file.path.lastIndexOf('.'))}`
                      await api['imgstudio:rename']({ conversationId, from: file.path, to })
                      setRenaming(null)
                      if (selected === file.path) setSelected(to)
                    }, 'Переименовано')}>Ок</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Отмена</Button>
                </div>
              : <div className="image-studio-meta">
                  <span role="button" tabIndex={0} aria-label={`Скопировать имя ${file.path}`} className="image-studio-name" title={`${file.path} · ${formatBytes(file.size)}${dimensions[file.path] ? ` · ${dimensions[file.path]}` : ''}\nОбновлён: ${new Date(file.updatedAt).toLocaleString('ru-RU')}${file.tookMs ? `\nСгенерировано за ${Math.round(file.tookMs / 1000)} с` : ''}${file.prompt ? `\nПромпт: ${file.prompt}` : ''}${file.source ? `\nИз: ${file.source}` : ''}\nКлик — скопировать имя`}
                    onClick={() => { void navigator.clipboard?.writeText(file.path).then(() => toast.success('Имя скопировано')).catch(() => undefined) }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { void navigator.clipboard?.writeText(file.path).then(() => toast.success('Имя скопировано')).catch(() => undefined) } }}>
                    {file.path}
                    {dimensions[file.path] && <small className="image-studio-dim"> {dimensions[file.path]}</small>}
                    {file.source && <small className="image-studio-dim image-studio-source"> из {file.source}</small>}
                  </span>
                  <span className="image-studio-card-actions">
                    <IconButton size="sm" aria-label={`Открыть ${file.path} в полный размер`} title="В полный размер" onClick={() => setViewing(file.path)}>⛶</IconButton>
                    <IconButton size="sm" aria-label={`Нарисовать вариацию ${file.path}`} title="Вариация" disabled={busy} onClick={() => variate(file)}>✦</IconButton>

                    {onAttachToChat && <IconButton size="sm" aria-label={`Прикрепить ${file.path} к сообщению`} title="В сообщение чата" onClick={() => void blobOf(file.path).then((blob) => { onAttachToChat(new File([blob], file.path, { type: blob.type })); toast.success(`«${file.path}» прикреплена к сообщению`) }).catch(() => toast.error('Не удалось прочитать файл'))}>📎</IconButton>}
                    <IconButton size="sm" aria-label={`Инструменты обработки ${file.path}`} title="Обработка (поворот, зеркало…)" aria-expanded={toolsFor === file.path} onClick={() => setToolsFor(toolsFor === file.path ? null : file.path)}>🛠</IconButton>
                    <IconButton size="sm" aria-label={`Переименовать ${file.path}`} title="Переименовать" onClick={() => setRenaming({ from: file.path, to: file.path })}>✎</IconButton>
                    <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void (async () => {
                      if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
                      await run(() => api['imgstudio:delete']({ conversationId, path: file.path }), 'Удалено')
                      if (selected === file.path) setSelected(null)
                    })()}>✕</IconButton>
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
              onTransfer={(item, to, copyMode) => void run(async () => {
                await api['imgstudio:transfer']({ conversationId, path: item.path, to, copy: copyMode })
                if (!copyMode && selected === item.path) setSelected(null)
                setToolsFor(null)
              }, copyMode ? 'Скопировано в другой чат' : 'Перенесено в другой чат')}
            />}
            </div>)}
          </div>
          {shown.length > visibleCount && <Button size="sm" variant="ghost" onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}>
            Показать ещё ({shown.length - visibleCount})
          </Button>}
          <div className="image-studio-quota-bar" role="presentation" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round(usedBytes / IMAGE_STUDIO_LIMITS.maxConversationBytes * 100))}%` }} className={usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? 'image-studio-quota-bar--warn' : undefined} />
          </div>
          <p className={`image-studio-quota${usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? ' image-studio-quota--warn' : ''}`}>
            {files.length === 1 ? '1 файл' : `Файлов: ${files.length}`} · занято {formatBytes(usedBytes)} из {formatBytes(IMAGE_STUDIO_LIMITS.maxConversationBytes)}
            {usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 && ' — место кончается, удалите ненужное'}
          </p>
        </>}

    {passwordDialog && <Dialog title="Пароль для зрителей" onClose={() => setPasswordDialog(false)} size="sm" actions={<>
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
      formatBytes={formatBytes}
      canStep={shown.length > 1}
      onCompareChange={setCompare}
      onView={setViewing}
      onStep={viewStep}
      onUsePrompt={(text) => { setPrompt(text); setViewing(null); promptRef.current?.focus() }}
      onPickForEdit={(path) => { setSelected(path); setViewing(null); setCompare(false); promptRef.current?.focus() }}
      onVariate={(path) => { setViewing(null); setCompare(false); variate(files.find((file) => file.path === path) ?? { path, size: 0, updatedAt: 0 }) }}
      onDownload={(path) => void download(path)}
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
      onClose={() => { setViewing(null); setCompare(false); setCompareWith(null) }}
    />}
  </div>
}
