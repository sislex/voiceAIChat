// Студия картинок: правая панель чата вида images — галерея разговора.
// Ассистент рисует в чате (его картинки сервер сам складывает сюда), панель
// добавляет прямые действия: загрузить свои (кнопкой или перетаскиванием),
// сгенерировать по промпту, поправить выбранную по промпту, переименовать,
// удалить, скачать, скопировать в буфер и рассмотреть в полный размер.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { ImageStudioFile } from '@shared/imageStudio'
import { IMAGE_STUDIO_LIMITS, imageStudioMime, isImageStudioPath } from '@shared/imageStudio'
import { Button, EmptyState, ErrorState, IconButton, Skeleton, useConfirm, useToast } from '@voicechat/ui-kit'
import { usePolling } from '../lib/usePolling'
import { copyImage } from '../lib/clipboard'
import { ToolFrame } from './ToolFrame'
import { IMAGE_STUDIO_DENSE_KEY, IMAGE_STUDIO_SIZE_KEY, imageStudioPromptsKey } from '../store/contracts'

type StudioApi = Pick<RendererApi,
  'imgstudio:list' | 'imgstudio:read' | 'imgstudio:upload' | 'imgstudio:delete' |
  'imgstudio:rename' | 'imgstudio:generate' | 'imgstudio:edit' | 'imgstudio:cancel'>

interface Props {
  conversationId: string
  api: StudioApi
  /** Ход ассистента идёт — после него в галерее могут появиться картинки. */
  turnActive?: boolean
}

/** Пресеты размера: пустой — модель решает сама. */
const SIZE_PRESETS = ['', '512×512', '1024×1024', '1920×1080'] as const
/** Сколько последних промптов помним на разговор. */
const RECENT_LIMIT = 4
/** Фильтр по имени появляется, когда глазами искать уже неудобно. */
const FILTER_THRESHOLD = 7
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

/** Свободное имя копии: «кот.png» → «кот-копия.png», дальше с номером. */
function copyName(path: string, taken: Set<string>): string {
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  let candidate = `${stem}-копия${ext}`
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${stem}-копия-${index}${ext}`
  return candidate
}

export function ImageStudioPane({ conversationId, api, turnActive }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [files, setFiles] = useState<ImageStudioFile[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
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
  const [viewing, setViewing] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [filter, setFilter] = useState('')
  const [order, setOrder] = useState<'new' | 'name'>('new')
  const [recent, setRecent] = useState<string[]>(() => loadRecent(conversationId))
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
        void api['imgstudio:read']({ conversationId, path: file.path }).then(({ dataBase64 }) => {
          const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: imageStudioMime(file.path) }))
          setPreviews((prev) => {
            if (prev[file.path]) URL.revokeObjectURL(prev[file.path]!)
            const next = { ...prev, [file.path]: url }
            previewsRef.current = next
            return next
          })
          setBroken((prev) => { if (!prev.has(file.path)) return prev; const next = new Set(prev); next.delete(file.path); return next })
        }).catch(() => {
          // Пометить битым и забыть ключ, чтобы ретрай перечитал файл заново.
          delete previewKeys.current[file.path]
          setBroken((prev) => new Set(prev).add(file.path))
        })
      }
    } catch {
      setFailed(true)
    }
  }, [api, conversationId])

  useEffect(() => { void reload() }, [reload])
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

  const generate = (): void => {
    if (busy || !prompt.trim()) return
    const cleaned = prompt.trim()
    // Пресет размера — просто добавка к промпту: модель рисует скриптом и
    // размер для неё такой же текст, как и всё остальное.
    const fullPrompt = size && !selected ? `${cleaned}\nРазмер изображения: ${size.replace('×', 'x')}` : cleaned
    rememberPrompt(cleaned)
    void run(async () => {
      // Выбрана картинка — правим её; нет — рисуем новую. Один промпт на
      // оба действия: так работает голова пользователя, а не наша схема.
      if (selected) await api['imgstudio:edit']({ conversationId, path: selected, prompt: fullPrompt })
      else {
        // Пользователь ввёл «арт» — дописываем .png, а не возвращаем bad_name.
        const typedName = fileName.trim()
        const name = typedName && !isImageStudioPath(typedName) ? `${typedName}.png` : typedName
        await api['imgstudio:generate']({ conversationId, prompt: fullPrompt, ...(name ? { name } : {}) })
      }
      setPrompt('')
      setFileName('')
      promptRef.current?.focus()
    }, selected ? 'Правка готова — результат рядом с оригиналом' : 'Изображение готово',
      selected ? `Модель правит «${selected}»` : 'Модель рисует')
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
    }, items.length === 1 ? `Загружено: ${items[0]!.name}` : `Загружено файлов: ${items.length}`)
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
      if (list.length > 10 && !(await confirm({ title: `Скачать ${list.length} файлов?`, message: 'Браузер запустит скачивание каждого файла по очереди.', confirmLabel: 'Скачать' }))) return
      for (const file of list) await download(file.path)
    })()
  }

  const copy = (file: ImageStudioFile): void => {
    void blobOf(file.path)
      .then((blob) => copyImage(blob))
      .catch(() => false)
      .then((ok) => (ok ? toast.success('Скопировано в буфер') : toast.error('Не удалось скопировать — браузер не разрешил доступ к буферу')))
  }

  const duplicate = (file: ImageStudioFile): void => {
    void run(async () => {
      const dataBase64 = await readBase64(file.path)
      const name = copyName(file.path, new Set((files ?? []).map((item) => item.path)))
      await api['imgstudio:upload']({ conversationId, path: name, dataBase64 })
    }, 'Копия создана')
  }

  if (failed) return <div className="image-studio"><ErrorState message="Не удалось загрузить галерею" onRetry={() => void reload()} /></div>
  if (!files) return <div className="image-studio"><Skeleton variant="list" count={3} item="block" height={96} gap={10} /></div>

  const usedBytes = files.reduce((sum, file) => sum + file.size, 0)
  const shown = files
    .filter((file) => !filter.trim() || file.path.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((left, right) => order === 'name' ? left.path.localeCompare(right.path, 'ru') : right.updatedAt - left.updatedAt)
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
  >
    <div className="image-studio-toolbar">
      <textarea
        ref={promptRef}
        aria-label="Промпт для изображения"
        rows={2}
        placeholder={selected ? `Что изменить в «${selected}»…` : 'Что нарисовать…'}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); generate() }
          // Esc — «выйти из режима правки», не покидая поля.
          if (event.key === 'Escape' && selected) { event.preventDefault(); setSelected(null) }
        }}
      />
      {recent.length > 0 && !prompt && <div className="image-studio-recent" aria-label="Недавние промпты">
        {recent.map((text) => <button key={text} type="button" className="image-studio-chip" title={text} onClick={() => { setPrompt(text); promptRef.current?.focus() }}>{text.length > 42 ? `${text.slice(0, 42)}…` : text}</button>)}
      </div>}
      <div className="image-studio-actions">
        <Button size="sm" disabled={busy || !prompt.trim()} loading={busy} title="⌘Enter / Ctrl+Enter" onClick={generate}>
          {selected ? 'Изменить выбранную' : 'Нарисовать'}
        </Button>
        {!selected && <select aria-label="Размер изображения" value={size} disabled={busy} onChange={(event) => { setSize(event.target.value); try { localStorage.setItem(IMAGE_STUDIO_SIZE_KEY, event.target.value) } catch { /* приватный режим */ } }}>
          {SIZE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Размер: авто' : preset}</option>)}
        </select>}
        {!selected && <input className="image-studio-filename" aria-label="Имя нового файла" placeholder="имя.png (не обязательно)" value={fileName} disabled={busy} onChange={(event) => setFileName(event.target.value)} />}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>Загрузить…</Button>
        {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Снять выбор</Button>}
        <input ref={uploadRef} type="file" accept="image/*,.svg" multiple hidden aria-label="Файл изображения" onChange={(event) => { if (event.target.files?.length) upload(event.target.files); event.target.value = '' }} />
      </div>
      {progress && <p className="image-studio-progress" role="status">
        {progress.label}… {progress.seconds} с. Обычно это занимает до минуты.
        {' '}
        <button type="button" className="image-studio-cancel" onClick={() => void api['imgstudio:cancel']({ conversationId }).catch(() => undefined)}>Отменить</button>
      </p>}
      <span className="vc-sr-only" role="status">{announce}</span>
      {lastError && !busy && <ErrorState compact message={lastError} />}
    </div>

    {files.length >= FILTER_THRESHOLD && <div className="image-studio-filter">
      <input aria-label="Фильтр по имени файла" placeholder="Найти по имени…" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <Button size="sm" variant="ghost" onClick={() => setOrder(order === 'new' ? 'name' : 'new')}>
        {order === 'new' ? 'Сначала новые' : 'По имени'}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy || !shown.length} onClick={() => downloadAll(shown)}>Скачать все</Button>
      <IconButton size="sm" aria-label={dense ? 'Крупные карточки' : 'Мелкие карточки'} title={dense ? 'Крупнее' : 'Мельче'} onClick={() => setDense((prev) => { const next = !prev; try { localStorage.setItem(IMAGE_STUDIO_DENSE_KEY, next ? '1' : '0') } catch { /* приватный режим */ } return next })}>{dense ? '▦' : '▤'}</IconButton>
    </div>}

    {files.length === 0
      ? <div>
          <EmptyState title="Галерея пуста — нарисуйте первую картинку" description="Опишите её в поле выше, перетащите файлы сюда или попросите ассистента в чате слева: всё нарисованное попадает сюда." />
          <div className="image-studio-recent image-studio-examples" aria-label="Примеры промптов">
            {PROMPT_EXAMPLES.map((example) => <button key={example} type="button" className="image-studio-chip" onClick={() => { setPrompt(example); promptRef.current?.focus() }}>{example}</button>)}
          </div>
        </div>
      : shown.length === 0
        ? <EmptyState compact title="Ничего не нашлось" description="Уточните фильтр или очистите его, чтобы увидеть всю галерею." />
        : <>
          <div className={`image-studio-grid${dense ? ' image-studio-grid--dense' : ''}`} role="list" aria-label="Галерея изображений">
            {shown.map((file) => <div role="listitem" key={file.path} className={`image-studio-card${selected === file.path ? ' image-studio-card--selected' : ''}`}>
            <button type="button" className="image-studio-thumb" aria-label={file.path} aria-pressed={selected === file.path} onClick={() => setSelected(selected === file.path ? null : file.path)} onDoubleClick={() => setViewing(file.path)} title={selected === file.path ? 'Снять выбор (двойной клик — на весь экран)' : 'Выбрать для правки (двойной клик — на весь экран)'}>
              {previews[file.path]
                ? <img src={previews[file.path]} alt="" onLoad={(event) => {
                    const img = event.currentTarget
                    if (img.naturalWidth) setDimensions((prev) => prev[file.path] === `${img.naturalWidth}×${img.naturalHeight}` ? prev : { ...prev, [file.path]: `${img.naturalWidth}×${img.naturalHeight}` })
                  }} />
                : broken.has(file.path)
                  ? <span className="image-studio-thumb-loading" role="status">превью не загрузилось</span>
                  : <span className="image-studio-thumb-loading" role="status">…</span>}
              {fresh.has(file.path) && <span className="image-studio-fresh" aria-label="Новая картинка">новое</span>}
            </button>
            {broken.has(file.path) && <Button size="sm" variant="ghost" onClick={() => void reload()}>Перечитать превью</Button>}
            {renaming?.from === file.path
              ? <div className="image-studio-rename">
                  <input
                    ref={renameRef}
                    aria-label="Новое имя файла"
                    value={renaming.to}
                    onChange={(event) => setRenaming({ from: file.path, to: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }}
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
                  <span className="image-studio-name" title={`${file.path} · ${formatBytes(file.size)}${dimensions[file.path] ? ` · ${dimensions[file.path]}` : ''}${file.prompt ? `\nПромпт: ${file.prompt}` : ''}${file.source ? `\nИз: ${file.source}` : ''}`}>
                    {file.path}
                    {dimensions[file.path] && <small className="image-studio-dim"> {dimensions[file.path]}</small>}
                  </span>
                  <span className="image-studio-card-actions">
                    <IconButton size="sm" aria-label={`Открыть ${file.path} в полный размер`} title="В полный размер" onClick={() => setViewing(file.path)}>⛶</IconButton>
                    <IconButton size="sm" aria-label={`Нарисовать вариацию ${file.path}`} title="Вариация" disabled={busy} onClick={() => variate(file)}>✦</IconButton>
                    <IconButton size="sm" aria-label={`Дублировать ${file.path}`} title="Дубликат" disabled={busy} onClick={() => duplicate(file)}>⎘</IconButton>
                    <IconButton size="sm" aria-label={`Копировать ${file.path} в буфер`} title="Копировать" onClick={() => copy(file)}>⧉</IconButton>
                    <IconButton size="sm" aria-label={`Переименовать ${file.path}`} title="Переименовать" onClick={() => setRenaming({ from: file.path, to: file.path })}>✎</IconButton>
                    <IconButton size="sm" aria-label={`Скачать ${file.path}`} title="Скачать" onClick={() => void download(file.path)}>⇩</IconButton>
                    <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void (async () => {
                      if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
                      await run(() => api['imgstudio:delete']({ conversationId, path: file.path }), 'Удалено')
                      if (selected === file.path) setSelected(null)
                    })()}>✕</IconButton>
                  </span>
                </div>}
            </div>)}
          </div>
          <p className={`image-studio-quota${usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 ? ' image-studio-quota--warn' : ''}`}>
            {files.length === 1 ? '1 файл' : `Файлов: ${files.length}`} · занято {formatBytes(usedBytes)} из {formatBytes(IMAGE_STUDIO_LIMITS.maxConversationBytes)}
            {usedBytes > IMAGE_STUDIO_LIMITS.maxConversationBytes * 0.8 && ' — место кончается, удалите ненужное'}
          </p>
        </>}

    {viewing && <ToolFrame title={viewing} onClose={() => setViewing(null)} className="util-embed--img" testId="image-studio-viewer"
      actions={shown.length > 1 ? <>
        <IconButton size="sm" aria-label="Предыдущая картинка" title="Предыдущая (←)" onClick={() => viewStep(-1)}>‹</IconButton>
        <IconButton size="sm" aria-label="Следующая картинка" title="Следующая (→)" onClick={() => viewStep(1)}>›</IconButton>
      </> : undefined}>
      <div className="imgbody" onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') viewStep(-1)
        if (event.key === 'ArrowRight') viewStep(1)
      }} tabIndex={-1}>
        {previews[viewing]
          ? <img className="image-studio-full" src={previews[viewing]} alt={viewing} />
          : <p className="imgerr" role="alert">Превью ещё не загрузилось</p>}
        {(() => {
          const meta = files.find((file) => file.path === viewing)
          if (!meta?.prompt && !meta?.source) return null
          return <p className="imgcap image-studio-origin">
            {meta.source ? `Из «${meta.source}» · ` : ''}{meta.prompt ? `промпт: ${meta.prompt}` : ''}
            {meta.prompt && <>
              {' '}
              <button type="button" className="image-studio-cancel" onClick={() => { setPrompt(meta.prompt!); setViewing(null); promptRef.current?.focus() }}>Использовать промпт</button>
            </>}
          </p>
        })()}
      </div>
    </ToolFrame>}
  </div>
}
