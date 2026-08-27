import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Button, Dialog, EmptyState, IconButton, useConfirm, useToast } from '@voicechat/ui-kit'
import type { RendererApi, RendererMakeBridge } from '@shared/ipc'
import { REST } from '@shared/protocol'
import { CodeEditor } from './CodeEditor'
import { CodeDiff } from './CodeDiff'
import { MakeStylePanel, cssRule, type StyleValues } from './MakeStylePanel'
import { copyText } from '../lib/clipboard'
import { MAKE_STARTER_GROUPS, MAKE_STARTER_PROMPTS, MAKE_SCAFFOLD, MAKE_TEMPLATES, isMakeTextPath, normalizeMakePath, type MakeCheckIssue, type MakeFileInfo, type MakeProjectState, type MakeSearchMatch, type MakeStoryFile, type MakeConsoleLine, type MakeSnapshotDiff, type MakeImportMode } from '@shared/make'

// Правая панель инструмента Make (аналог Figma Make): проект разговора — статический
// сайт в рабочей папке сервера. Три режима: «Превью» (same-origin iframe поверх
// /api/preview/make/<conv>/, пресеты ширины, выбор элемента для правки через чат),
// «Код» (дерево файлов + редактор с сохранением) и «История» (снимки/откат/сброс).
// Ассистент меняет файлы MCP-инструментами; сервер шлёт `make.changed` — панель
// перезагружает превью и, если редактор не грязный, содержимое открытого файла.

export interface MakeSelectedElement {
  selector: string
  tag: string
  text: string
  html: string
  id?: string
  className?: string
  styles?: StyleValues
}

export interface MakePaneProps {
  conversationId: string
  api: Pick<RendererApi, 'make:state' | 'make:read' | 'make:write' | 'make:delete' | 'make:rename' | 'make:snapshot' | 'make:restore' | 'make:reset' | 'make:publish' | 'make:unpublish' | 'make:check' | 'make:template' | 'make:upload' | 'make:search' | 'make:stories' | 'make:snapshotDiff' | 'make:restoreFile' | 'make:import' | 'make:importUrl' | 'make:snapshotFile'>
  make?: RendererMakeBridge
  /** Вставить текст в поле ввода чата (просьба ассистенту про выбранный элемент). */
  onInsertToChat?: (text: string) => void
  /** Отправить сообщение ассистенту сразу (кнопка «Исправить» в баннере ошибок). */
  onAskAssistant?: (text: string) => void
  /** База превью; по умолчанию — REST.makePreview (тест подменяет). */
  previewBase?: string
  /**
   * Cookie-гейт превью: iframe не умеет слать Bearer, поэтому перед первой загрузкой
   * сервер выпускает preview-cookie (`session:ensurePreview`, как у Web Reader).
   */
  ensurePreview?: () => Promise<boolean>
  /** Задержка автосохранения; тесты уменьшают. */
  autosaveDelayMs?: number
}

type Mode = 'preview' | 'code' | 'stories' | 'history'
const MODE_LABEL: Record<Mode, string> = { preview: 'Превью', code: 'Код', stories: 'Компоненты', history: 'История' }
type Device = 'desktop' | 'tablet' | 'mobile'
const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 }
const DEVICE_LABEL: Record<Device, string> = { desktop: 'Десктоп', tablet: 'Планшет', mobile: 'Телефон' }

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} КБ` : `${bytes} Б`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Дерево: файлы группируются по первому каталогу, корневые — первыми. */
function groupFiles(files: MakeFileInfo[]): Array<{ dir: string; files: MakeFileInfo[] }> {
  const groups = new Map<string, MakeFileInfo[]>()
  for (const file of files) {
    const slash = file.path.indexOf('/')
    const dir = slash >= 0 ? file.path.slice(0, slash) : ''
    groups.set(dir, [...(groups.get(dir) ?? []), file])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'ru'))).map(([dir, list]) => ({ dir, files: list }))
}

export function MakePane({ conversationId, api, make, onInsertToChat, onAskAssistant, previewBase, ensurePreview, autosaveDelayMs = 1500 }: MakePaneProps): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>('preview')
  const [state, setState] = useState<MakeProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<Device>('desktop')
  const [fullscreen, setFullscreen] = useState(false)
  const [inspect, setInspect] = useState(false)
  const [selected, setSelected] = useState<MakeSelectedElement | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const previewStyles = (values: StyleValues): void => { frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.style', values }, '*') }
  /** Дописать правило в главную таблицу стилей проекта (первый <link rel=stylesheet> из index.html, иначе styles.css). */
  const writeStyles = async (rule: string, values: StyleValues): Promise<void> => {
    try {
      let target = 'styles.css'
      try {
        const index = await api['make:read']({ conversationId, path: 'index.html' })
        const m = index.content.match(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"'#?]+)["']/i) ?? index.content.match(/<link[^>]*href=["']([^"'#?]+\.css)["'][^>]*rel=["']stylesheet["']/i)
        if (m?.[1] && !/^https?:/i.test(m[1])) target = m[1].replace(/^\.\//, '')
      } catch { /* нет index.html — пишем в styles.css */ }
      let css = ''
      try { css = (await api['make:read']({ conversationId, path: target })).content } catch { css = '' }
      const block = `\n/* Правка из панели стилей Make */\n${cssRule(rule, values)}`
      const next = await api['make:write']({ conversationId, path: target, content: css.replace(/\s*$/, '\n') + block })
      setState(next); setPreviewRev(next.rev)
      toast.success(`Правило ${rule} записано в ${target}`)
    } catch (e) { toast.error(describeError(e)) }
  }
  const [previewRev, setPreviewRev] = useState(0)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  // Вкладки открытых файлов (как в VS Code) и автосохранение с паузой — правки не теряются при переключении.
  const [tabs, setTabs] = useState<string[]>([])
  // Содержимое всех текстовых файлов — для моделей Monaco (резолв импортов). Перечитываем по rev.
  const [projectFiles, setProjectFiles] = useState<Array<{ path: string; content: string }>>([])
  useEffect(() => {
    if (mode !== 'code' || !state) return
    let cancelled = false
    const texts = state.files.filter((f) => isMakeTextPath(f.path) && f.size <= 512 * 1024)
    void Promise.all(texts.map((f) => api['make:read']({ conversationId, path: f.path }).then((r) => ({ path: f.path, content: r.content })).catch(() => null)))
      .then((list) => { if (!cancelled) setProjectFiles(list.filter((x): x is { path: string; content: string } => x !== null)) })
    return () => { cancelled = true }
  }, [mode, state?.rev, conversationId, api, state])
  const [autosave, setAutosave] = useState<boolean>(() => { try { return localStorage.getItem('vc.make.autosave') !== 'off' } catch { return true } })
  const toggleAutosave = (): void => { setAutosave((v) => { const next = !v; try { localStorage.setItem('vc.make.autosave', next ? 'on' : 'off') } catch { /* приватный режим */ } return next }) }
  const [saving, setSaving] = useState(false)
  /** Превью готово к загрузке: cookie выпущена (или гейта нет). */
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  /** Диалог ввода имени (новый файл / переименование / подпись снимка) — вместо window.prompt. */
  const [ask, setAsk] = useState<{ title: string; label: string; initial: string; submit: string; onSubmit: (value: string) => void } | null>(null)
  const [askValue, setAskValue] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [issues, setIssues] = useState<MakeCheckIssue[] | null>(null)
  // Поиск: фильтр дерева по пути — мгновенно; по содержимому — запросом на Enter.
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<MakeSearchMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  // Сториз: список файлов *.stories.* и выбранная стори; раннер — отдельная страница превью.
  const [storyFiles, setStoryFiles] = useState<MakeStoryFile[] | null>(null)
  const [story, setStory] = useState<{ file: string; name: string } | null>(null)
  // Controls: args, которые раннер разрешил для стори, и переопределения из панели (в файл не пишутся).
  const [storyArgs, setStoryArgs] = useState<Record<string, unknown> | null>(null)
  const [argOverrides, setArgOverrides] = useState<Record<string, unknown>>({})
  const [argOptions, setArgOptions] = useState<Record<string, string[]>>({})
  const [ideasOpen, setIdeasOpen] = useState(false)
  // Консоль превью: строки из iframe (console.* и ошибки), сбрасываются при перезагрузке превью.
  const [consoleLines, setConsoleLines] = useState<MakeConsoleLine[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importMode, setImportMode] = useState<MakeImportMode>('replace')
  const [importing, setImporting] = useState(false)
  const importZipRef = useRef<HTMLInputElement>(null)
  const [diffs, setDiffs] = useState<Record<string, MakeSnapshotDiff | 'loading'>>({})
  // Diff-вью одного файла: снимок ↔ текущее.
  const [fileDiff, setFileDiff] = useState<{ snapshotId: string; label: string; path: string; original: string; modified: string } | null>(null)
  const openFileDiff = async (snapshotId: string, label: string, path: string): Promise<void> => {
    try {
      const [orig, cur] = await Promise.all([
        api['make:snapshotFile']({ conversationId, snapshotId, path }).then((f) => f.content).catch(() => ''),
        api['make:read']({ conversationId, path }).then((f) => f.content).catch(() => '')
      ])
      setFileDiff({ snapshotId, label, path, original: orig, modified: cur })
    } catch (e) { toast.error(describeError(e)) }
  }
  const storyFrameRef = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const d = e.data as { type?: string; args?: Record<string, unknown>; options?: Record<string, string[]> } | null
      if (d?.type === 'vc-make.story' && e.source === storyFrameRef.current?.contentWindow) { setStoryArgs(d.args ?? {}); setArgOptions(d.options ?? {}); setArgOverrides({}) }
      if (d?.type === 'vc-make.console' && (e.source === frameRef.current?.contentWindow || e.source === storyFrameRef.current?.contentWindow)) {
        const line = d as unknown as MakeConsoleLine
        setConsoleLines((prev) => [...prev.slice(-199), { level: line.level, text: line.text, at: line.at }])
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  const setArg = (key: string, value: unknown): void => {
    const next = { ...argOverrides, [key]: value }
    setArgOverrides(next)
    storyFrameRef.current?.contentWindow?.postMessage({ type: 'vc-make.args', args: next }, '*')
  }
  const resetArgs = (): void => {
    setArgOverrides({})
    storyFrameRef.current?.contentWindow?.postMessage({ type: 'vc-make.args', args: {} }, '*')
  }
  const sendArgsToChat = (): void => {
    if (!story || !onInsertToChat || Object.keys(argOverrides).length === 0) return
    onInsertToChat(`В стори «${story.name}» (${story.file}) сделай args по умолчанию такими: ${JSON.stringify(argOverrides)}. `)
  }
  const [checking, setChecking] = useState(false)
  const openAsk = (title: string, label: string, initial: string, submit: string, onSubmit: (value: string) => void): void => { setAskValue(initial); setAsk({ title, label, initial, submit, onSubmit }) }
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  // Перетаскивание файлов с рабочего стола в дерево — та же загрузка, что и кнопкой.
  const [dropActive, setDropActive] = useState(false)
  const onDragOver = (e: DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }
  const onDrop = (e: DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault(); setDropActive(false)
    void uploadFiles(e.dataTransfer.files)
  }
  const dirty = content !== savedContent
  const base = previewBase ?? REST.makePreview(conversationId)

  const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  const refresh = useCallback(async (): Promise<MakeProjectState | null> => {
    try {
      const next = await api['make:state']({ conversationId })
      setState(next)
      setError(null)
      return next
    } catch (e) {
      setError(describeError(e))
      return null
    }
  }, [api, conversationId])

  const openFile = useCallback(async (path: string): Promise<void> => {
    // Бинарник (картинка, шрифт) редактировать нельзя — показываем его просмотр вместо текста.
    setTabs((list) => (list.includes(path) ? list : [...list, path]))
    if (!isMakeTextPath(path)) { setSelectedPath(path); setContent(''); setSavedContent(''); return }
    try {
      const file = await api['make:read']({ conversationId, path })
      setSelectedPath(path)
      setContent(file.content)
      setSavedContent(file.content)
    } catch (e) {
      toast.error(describeError(e))
    }
  }, [api, conversationId, toast])

  // Cookie-гейт превью — один раз на монтирование панели.
  useEffect(() => {
    if (!ensurePreview) return
    let cancelled = false
    void ensurePreview().then((ok) => { if (!cancelled) { setPreviewReady(true); if (!ok) setError('Не удалось подготовить превью: нет cookie сессии') } })
    return () => { cancelled = true }
  }, [ensurePreview])

  // Первая загрузка: состояние проекта и index.html в редакторе.
  useEffect(() => {
    let cancelled = false
    void refresh().then((next) => {
      if (cancelled || !next) return
      const entry = next.files.find((f) => f.path === 'index.html') ?? next.files.find((f) => isMakeTextPath(f.path))
      if (entry) void openFile(entry.path)
    })
    return () => { cancelled = true }
  }, [refresh, openFile])

  // Изменения от ассистента/другой вкладки: перезагрузить превью и дерево;
  // открытый файл обновляем только если пользователь его не правил.
  useEffect(() => {
    if (!make) return
    return make.onChanged((m) => {
      if (m.conversationId !== conversationId) return
      setPreviewRev(m.rev)
      void refresh()
      if (selectedPath && m.paths.includes(selectedPath) && !dirty) void openFile(selectedPath)
    })
  }, [make, conversationId, refresh, openFile, selectedPath, dirty])

  // Сообщения из превью: выбранный элемент (режим «Выбрать элемент»).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { type?: string; selector?: string; tag?: string; text?: string; html?: string; id?: string; className?: string; styles?: StyleValues } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'vc-make.ready') {
        frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
      } else if (data.type === 'vc-make.selected' && data.selector) {
        setSelected({ selector: data.selector, tag: data.tag ?? '', text: data.text ?? '', html: data.html ?? '', id: data.id, className: data.className, styles: data.styles })
        setStyleOpen(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [inspect])

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
  }, [inspect, previewRev])

  const save = useCallback(async (silent = false): Promise<void> => {
    if (!selectedPath || !dirty || saving) return
    setSaving(true)
    try {
      const next = await api['make:write']({ conversationId, path: selectedPath, content })
      setSavedContent(content)
      setState(next)
      setPreviewRev(next.rev)
      if (!silent) toast.success('Сохранено')
      // Ошибки компиляции jsx/tsx — маркерами в редакторе; баннер не трогаем, если всё чисто.
      if (/\.(jsx|tsx|ts)$/i.test(selectedPath)) {
        const { issues: found } = await api['make:check']({ conversationId })
        setIssues((prev) => (found.length > 0 ? found : prev === null ? null : found))
      }
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setSaving(false)
    }
  }, [api, conversationId, selectedPath, content, dirty, saving, toast])
  // Автосохранение: пауза после последней правки.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!autosave || !dirty || !selectedPath) return
    const timer = setTimeout(() => { void saveRef.current(true) }, autosaveDelayMs)
    return () => clearTimeout(timer)
  }, [autosave, dirty, content, selectedPath, autosaveDelayMs])
  const closeTab = (path: string): void => {
    const next = tabs.filter((t) => t !== path)
    setTabs(next)
    if (selectedPath === path) {
      const idx = tabs.indexOf(path)
      const neighbour = next[Math.min(idx, next.length - 1)]
      if (neighbour) void openFile(neighbour)
      else { setSelectedPath(null); setContent(''); setSavedContent('') }
    }
  }
  const markers = useMemo(() => (issues ?? []).filter((i) => i.path === selectedPath && i.line).map((i) => ({ line: i.line!, column: i.column, message: i.message })), [issues, selectedPath])

  // Ctrl/Cmd+S в редакторе — сохранить; Tab — отступ, а не переход фокуса.
  const createFile = (): void => openAsk('Новый файл', 'Путь файла (например, about.html или css/theme.css)', '', 'Создать', (raw) => void createFileAt(raw))
  const createFileAt = async (raw: string): Promise<void> => {
    const path = normalizeMakePath(raw)
    if (!path) { toast.error('Недопустимый путь файла'); return }
    if (state?.files.some((f) => f.path === path)) { toast.error('Такой файл уже есть'); return }
    try {
      const next = await api['make:write']({ conversationId, path, content: '' })
      setState(next)
      setPreviewRev(next.rev)
      await openFile(path)
      setMode('code')
    } catch (e) { toast.error(describeError(e)) }
  }

  // Загрузка файлов с диска: текст пишем как текст (его можно править в редакторе),
  // остальное — бинарно в base64. Картинки складываем в img/, чтобы корень не засорялся.
  const uploadInputRef = useRef<HTMLInputElement>(null)
  // FileReader, а не Blob.text()/arrayBuffer(): их нет в jsdom, а поведение одно.
  const readAs = <T extends string | ArrayBuffer>(file: File, mode: 'text' | 'buffer'): Promise<T> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as T)
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'))
    if (mode === 'text') reader.readAsText(file); else reader.readAsArrayBuffer(file)
  })
  const uploadFiles = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return
    let last: MakeProjectState | null = null
    let uploaded = 0
    for (const file of Array.from(list)) {
      const name = file.name.replace(/\s+/g, '-')
      const isText = isMakeTextPath(name)
      const path = normalizeMakePath(isText || !/^image\//.test(file.type) ? name : `img/${name}`)
      if (!path) { toast.error(`Недопустимое имя файла: ${file.name}`); continue }
      try {
        if (isText) {
          last = await api['make:write']({ conversationId, path, content: await readAs<string>(file, 'text') })
        } else {
          const bytes = new Uint8Array(await readAs<ArrayBuffer>(file, 'buffer'))
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          last = await api['make:upload']({ conversationId, path, dataBase64: btoa(binary) })
        }
        uploaded += 1
      } catch (e) { toast.error(`${file.name}: ${describeError(e)}`) }
    }
    if (last) { setState(last); setPreviewRev(last.rev) }
    if (uploaded > 0) toast.success(uploaded === 1 ? 'Файл загружен' : `Загружено файлов: ${uploaded}`)
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  const renameFile = (path: string): void => openAsk('Переименовать файл', 'Новый путь файла', path, 'Переименовать', (raw) => void renameFileTo(path, raw))
  const renameFileTo = async (path: string, raw: string): Promise<void> => {
    if (raw === path) return
    const to = normalizeMakePath(raw)
    if (!to) { toast.error('Недопустимый путь файла'); return }
    try {
      const next = await api['make:rename']({ conversationId, from: path, to })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath === path) setSelectedPath(to)
      setTabs((list) => list.map((t) => (t === path ? to : t)))
    } catch (e) { toast.error(describeError(e)) }
  }

  const deleteFile = async (path: string): Promise<void> => {
    const ok = await confirm({ title: `Удалить файл «${path}»?`, message: 'Состояние проекта можно вернуть из «Истории», если снимок был сохранён.', variant: 'danger', confirmLabel: 'Удалить' })
    if (!ok) return
    try {
      const next = await api['make:delete']({ conversationId, path })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath === path) { setSelectedPath(null); setContent(''); setSavedContent('') }
      setTabs((list) => list.filter((t) => t !== path))
    } catch (e) { toast.error(describeError(e)) }
  }

  const takeSnapshot = (): void => openAsk('Новый снимок', 'Название снимка', 'Снимок пользователя', 'Сохранить', (label) => void takeSnapshotNamed(label))
  const takeSnapshotNamed = async (label: string): Promise<void> => {
    try {
      setState(await api['make:snapshot']({ conversationId, label }))
      toast.success('Снимок сохранён')
    } catch (e) { toast.error(describeError(e)) }
  }

  const restoreSnapshot = async (snapshotId: string, label: string): Promise<void> => {
    const ok = await confirm({ title: `Вернуть проект к снимку «${label}»?`, message: 'Текущее состояние сохранится отдельным снимком.', confirmLabel: 'Вернуть' })
    if (!ok) return
    try {
      const next = await api['make:restore']({ conversationId, snapshotId })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath) void openFile(selectedPath)
      toast.success('Проект восстановлен')
    } catch (e) { toast.error(describeError(e)) }
  }

  const resetProject = async (): Promise<void> => {
    const ok = await confirm({ title: 'Сбросить проект к заготовке?', message: 'Все файлы заменятся стартовой страницей; текущее состояние сохранится снимком.', variant: 'danger', confirmLabel: 'Сбросить' })
    if (!ok) return
    try {
      const next = await api['make:reset']({ conversationId })
      setState(next)
      setPreviewRev(next.rev)
      await openFile('index.html')
    } catch (e) { toast.error(describeError(e)) }
  }

  const publish = async (): Promise<void> => {
    try { setState(await api['make:publish']({ conversationId })); toast.success('Проект опубликован') } catch (e) { toast.error(describeError(e)) }
  }
  const unpublish = async (): Promise<void> => {
    const ok = await confirm({ title: 'Снять проект с публикации?', message: 'Ссылка перестанет открываться.', variant: 'danger', confirmLabel: 'Снять' })
    if (!ok) return
    try { setState(await api['make:unpublish']({ conversationId })); toast.success('Публикация снята') } catch (e) { toast.error(describeError(e)) }
  }
  const copyPublicLink = async (): Promise<void> => {
    if (!state?.published) return
    try { await navigator.clipboard.writeText(new URL(state.published.url, window.location.origin).toString()); toast.success('Ссылка скопирована') } catch { toast.error('Не удалось скопировать') }
  }
  const runCheck = async (): Promise<void> => {
    setChecking(true)
    try { setIssues((await api['make:check']({ conversationId })).issues) } catch (e) { toast.error(describeError(e)) } finally { setChecking(false) }
  }
  const applyTemplate = async (templateId: string, title: string): Promise<void> => {
    const ok = await confirm({ title: `Применить шаблон «${title}»?`, message: 'Файлы проекта заменятся файлами шаблона; текущее состояние сохранится снимком.', confirmLabel: 'Применить' })
    if (!ok) return
    try {
      const next = await api['make:template']({ conversationId, templateId })
      setState(next)
      setPreviewRev(next.rev)
      setTemplatesOpen(false)
      await openFile('index.html')
      toast.success(`Шаблон «${title}» применён`)
    } catch (e) { toast.error(describeError(e)) }
  }

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q) { setMatches(null); return }
    setSearching(true)
    try { setMatches((await api['make:search']({ conversationId, query: q })).matches) } catch (e) { toast.error(describeError(e)) } finally { setSearching(false) }
  }
  const loadStories = useCallback(async (): Promise<void> => {
    try {
      const { files } = await api['make:stories']({ conversationId })
      setStoryFiles(files)
      setStory((current) => {
        if (current && files.some((f) => f.path === current.file && f.stories.includes(current.name))) return current
        const first = files.find((f) => f.stories.length > 0)
        return first ? { file: first.path, name: first.stories[0]! } : null
      })
    } catch (e) { toast.error(describeError(e)) }
  }, [api, conversationId, toast])
  useEffect(() => { if (mode === 'stories') void loadStories() }, [mode, loadStories, state?.rev])
  const sendStoryToChat = (): void => {
    if (!story || !onInsertToChat) return
    const component = story.file.slice(story.file.lastIndexOf('/') + 1).replace(/\.stories\.(jsx|tsx)$/i, '')
    onInsertToChat(`Работаем только над компонентом ${component} (${story.file.replace(/\.stories\./, '.')}, стори «${story.name}» в ${story.file}); другие файлы не трогай. `)
  }

  const sendSelectedToChat = (): void => {
    if (!selected || !onInsertToChat) return
    const text = `Измени элемент ${selected.selector}${selected.text ? ` («${selected.text.slice(0, 80)}»)` : ''}: `
    onInsertToChat(text)
    setInspect(false)
  }

  const groups = useMemo(() => groupFiles(state?.files ?? []), [state])
  // «Свежий» проект — только файлы заготовки без правок: показываем стартовые идеи, как главная Figma Make.
  const isFresh = useMemo(() => {
    const files = state?.files
    if (!files || files.length === 0) return false
    const enc = new TextEncoder()
    return files.every((f) => f.path in MAKE_SCAFFOLD && f.size === enc.encode(MAKE_SCAFFOLD[f.path]!).length)
  }, [state])
  const useStarter = (prompt: string): void => { onInsertToChat?.(prompt); setIdeasOpen(false) }
  useEffect(() => { setConsoleLines([]) }, [previewRev])
  // Итеративная правка: после перезагрузки превью (правка ассистента или своя) 8 секунд слушаем консоль;
  // появились ошибки — предлагаем «Исправить» одной кнопкой, текст ошибок уходит ассистенту сразу.
  const [autofix, setAutofix] = useState<{ rev: number; dismissed: boolean }>({ rev: 0, dismissed: false })
  const watchUntil = useRef(0)
  useEffect(() => { watchUntil.current = Date.now() + 8_000; setAutofix({ rev: previewRev, dismissed: false }) }, [previewRev])
  const recentErrors = consoleLines.filter((l) => l.level === 'error' && l.at <= watchUntil.current)
  const showAutofix = !autofix.dismissed && recentErrors.length > 0
  const askFix = (): void => {
    const text = `После последней правки в консоли превью ошибки:\n${recentErrors.slice(-5).map((l) => `- ${l.text.slice(0, 300)}`).join('\n')}\nНайди причину и исправь. `
    if (onAskAssistant) onAskAssistant(text); else onInsertToChat?.(text)
    setAutofix((a) => ({ ...a, dismissed: true }))
  }
  const consoleErrors = consoleLines.filter((l) => l.level === 'error').length
  const sendConsoleToChat = (): void => {
    const errors = consoleLines.filter((l) => l.level === 'error' || l.level === 'warn').slice(-5)
    if (!onInsertToChat || errors.length === 0) return
    onInsertToChat(`В консоли превью ошибки:\n${errors.map((l) => `- [${l.level}] ${l.text.slice(0, 300)}`).join('\n')}\nИсправь. `)
  }
  const assets = useMemo(() => (state?.files ?? []).filter((f) => !isMakeTextPath(f.path)), [state])
  const copyAsset = async (text: string, what: string): Promise<void> => { toast[(await copyText(text)) ? 'success' : 'error'](`${what} скопирован`) }
  const loadDiff = async (snapshotId: string): Promise<void> => {
    if (diffs[snapshotId]) { setDiffs((d) => { const next = { ...d }; delete next[snapshotId]; return next }); return }
    setDiffs((d) => ({ ...d, [snapshotId]: 'loading' }))
    try { const diff = await api['make:snapshotDiff']({ conversationId, snapshotId }); setDiffs((d) => ({ ...d, [snapshotId]: diff })) }
    catch (e) { toast.error(describeError(e)); setDiffs((d) => { const next = { ...d }; delete next[snapshotId]; return next }) }
  }
  const restoreFile = async (snapshotId: string, path: string): Promise<void> => {
    try {
      const next = await api['make:restoreFile']({ conversationId, snapshotId, path })
      setState(next); setPreviewRev(next.rev)
      if (selectedPath === path) await openFile(path)
      setDiffs((d) => { const n = { ...d }; delete n[snapshotId]; return n })
      toast.success(`Файл ${path} восстановлен`)
    } catch (e) { toast.error(describeError(e)) }
  }
  const runImport = async (kind: 'zip' | 'url', file?: File): Promise<void> => {
    setImporting(true)
    try {
      let next: MakeProjectState
      if (kind === 'zip') {
        if (!file) return
        const bytes = new Uint8Array(await new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file) }))
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        next = await api['make:import']({ conversationId, dataBase64: btoa(binary), mode: importMode })
      } else {
        if (!importUrl.trim()) return
        next = await api['make:importUrl']({ conversationId, url: importUrl.trim(), mode: importMode })
      }
      setState(next); setPreviewRev(next.rev); setImportOpen(false); setMode('preview')
      toast.success(`Импортировано файлов: ${next.files.length}`)
    } catch (e) { toast.error(describeError(e)) } finally { setImporting(false); if (importZipRef.current) importZipRef.current.value = '' }
  }
  const frameWidth = DEVICE_WIDTH[device]
  const previewSrc = `${base}index.html?rev=${previewRev}`

  const header = (
    <div className="make-head" role="toolbar" aria-label="Панель проекта">
      <div className="make-tabs" role="tablist" aria-label="Режим панели">
        {(['preview', 'code', 'stories', 'history'] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'make-tab on' : 'make-tab'} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <span className="make-head-spacer" />
      {mode === 'preview' && (
        <>
          <div className="make-devices" role="group" aria-label="Ширина превью">
            {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} className={device === d ? 'make-device on' : 'make-device'} title={DEVICE_LABEL[d]} aria-label={DEVICE_LABEL[d]} onClick={() => setDevice(d)}>
                {d === 'desktop' ? 'ПК' : d === 'tablet' ? 'Планшет' : 'Телефон'}
              </button>
            ))}
          </div>
          <IconButton size="sm" aria-label="Выбрать элемент" title="Выбрать элемент на странице и попросить ассистента его изменить" aria-pressed={inspect} className={inspect ? 'make-inspect on' : undefined} onClick={() => setInspect((v) => !v)}>⌖</IconButton>
          <IconButton size="sm" aria-label="Обновить превью" title="Обновить превью" onClick={() => setPreviewRev((r) => r + 1)}>⟳</IconButton>
          <IconButton size="sm" aria-label="Открыть в новой вкладке" title="Открыть в новой вкладке" onClick={() => window.open(`${base}index.html`, '_blank', 'noopener')}>↗</IconButton>
        </>
      )}
      {mode === 'code' && (
        <>
          <Button size="sm" variant="ghost" onClick={() => void runCheck()} loading={checking}>Проверить</Button>
          <Button size="sm" variant="secondary" onClick={createFile}>+ Файл</Button>
          <Button size="sm" variant="ghost" onClick={() => uploadInputRef.current?.click()}>Загрузить</Button>
          <Button size="sm" variant="ghost" onClick={() => setAssetsOpen(true)}>Ассеты{assets.length > 0 ? ` (${assets.length})` : ''}</Button>
          <input ref={uploadInputRef} type="file" multiple hidden aria-label="Загрузить файлы в проект" data-testid="make-upload-input" onChange={(e) => void uploadFiles(e.target.files)} />
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()} title="Сохранить (Ctrl/Cmd+S)">{saving ? 'Сохраняю…' : 'Сохранить'}</Button>
        </>
      )}
      {mode === 'history' && <Button size="sm" variant="secondary" onClick={takeSnapshot}>+ Снимок</Button>}
      {mode === 'stories' && story && onInsertToChat && <Button size="sm" variant="primary" onClick={sendStoryToChat}>Работать над компонентом</Button>}
      {onInsertToChat && <IconButton size="sm" aria-label="Идеи для старта" title="Идеи: готовые промпты для приложений и сайтов" onClick={() => setIdeasOpen(true)}>✦</IconButton>}
      <IconButton size="sm" aria-label="Шаблоны проекта" title="Начать с шаблона" onClick={() => setTemplatesOpen(true)}>▤</IconButton>
      <Button size="sm" variant={state?.published ? 'secondary' : 'ghost'} onClick={() => setPublishOpen(true)} >{state?.published ? 'Опубликован' : 'Опубликовать'}</Button>
      <IconButton size="sm" aria-label="Импорт проекта" title="Импорт: ZIP или страница по URL" onClick={() => setImportOpen(true)}>⇪</IconButton>
      <IconButton size="sm" aria-label="Скачать проект (ZIP)" title="Скачать: статика или Vite-проект" onClick={() => setExportOpen(true)}>⇩</IconButton>
      <IconButton size="sm" aria-label={fullscreen ? 'Свернуть панель' : 'На весь экран'} title={fullscreen ? 'Свернуть панель' : 'На весь экран'} aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)}>⛶</IconButton>
    </div>
  )

  return (
    <section className={fullscreen ? 'make-pane make-pane--fs' : 'make-pane'} aria-label="Проект Make" data-testid="make-pane">
      {header}
      {error && <p className="make-error" role="alert">{error}</p>}

      {mode === 'preview' && (
        <div className="make-preview" data-testid="make-preview">
          {selected && (
            <div className="make-selected" data-testid="make-selected">
              <code className="make-selected-sel" title={selected.selector}>&lt;{selected.tag}&gt; {selected.selector}</code>
              {selected.text && <span className="make-selected-text">«{selected.text.slice(0, 80)}»</span>}
              <span className="make-selected-actions">
                <Button size="sm" variant={styleOpen ? 'secondary' : 'ghost'} aria-expanded={styleOpen} onClick={() => setStyleOpen((v) => !v)}>Стили</Button>
                {onInsertToChat && <Button size="sm" variant="primary" onClick={sendSelectedToChat}>В чат</Button>}
                <IconButton size="sm" aria-label="Снять выбор" title="Снять выбор" onClick={() => { previewStyles({}); setSelected(null) }}>✕</IconButton>
              </span>
            </div>
          )}
          {selected && styleOpen && (
            <MakeStylePanel selector={selected.selector} id={selected.id} className={selected.className} computed={selected.styles ?? {}} onPreview={previewStyles} onWrite={writeStyles} onReset={() => previewStyles({})} />
          )}
          {isFresh && onInsertToChat && (
            <section className="make-starters" aria-label="Идеи для старта" data-testid="make-starters">
              <div className="make-starters-head">
                <strong>С чего начать</strong>
                <Button size="sm" variant="ghost" onClick={() => setIdeasOpen(true)}>Все идеи</Button>
              </div>
              <div className="make-starters-grid">
                {MAKE_STARTER_PROMPTS.slice(0, 6).map((item) => (
                  <button key={item.id} type="button" className="make-starter" onClick={() => useStarter(item.prompt)} title={item.prompt}>
                    <span className="make-starter-title">{item.title}</span>
                    <span className="make-starter-group">{MAKE_STARTER_GROUPS[item.group]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className={`make-frame-host make-frame-host--${device}`}>
            {previewReady && <iframe
              ref={frameRef}
              key={previewRev}
              className="make-frame"
              title="Превью проекта"
              src={previewSrc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              style={frameWidth ? { width: `${frameWidth}px` } : undefined}
            />}
          </div>
          {showAutofix && (
            <div className="make-autofix" role="alert" data-testid="make-autofix">
              <span>После правки в консоли {recentErrors.length === 1 ? 'ошибка' : `ошибок: ${recentErrors.length}`} — <code>{recentErrors[recentErrors.length - 1]!.text.slice(0, 120)}</code></span>
              <span className="make-autofix-actions">
                {(onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={askFix}>Исправить</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setAutofix((a) => ({ ...a, dismissed: true })); setConsoleOpen(true) }}>Показать консоль</Button>
                <IconButton size="sm" aria-label="Скрыть предложение исправить" title="Скрыть" onClick={() => setAutofix((a) => ({ ...a, dismissed: true }))}>✕</IconButton>
              </span>
            </div>
          )}
          <section className={consoleOpen ? 'make-console make-console--open' : 'make-console'} aria-label="Консоль превью" data-testid="make-console">
            <div className="make-console-head">
              <button type="button" className="make-console-toggle" aria-expanded={consoleOpen} onClick={() => setConsoleOpen((v) => !v)}>
                {consoleOpen ? '▾' : '▸'} Консоль <span className="make-console-count">{consoleLines.length}</span>
                {consoleErrors > 0 && <span className="make-console-errors" data-testid="make-console-errors">{consoleErrors} ошибок</span>}
              </button>
              <span className="make-console-actions">
                {onInsertToChat && consoleErrors > 0 && <Button size="sm" variant="secondary" onClick={sendConsoleToChat}>В чат</Button>}
                {consoleLines.length > 0 && <Button size="sm" variant="ghost" onClick={() => setConsoleLines([])}>Очистить</Button>}
              </span>
            </div>
            {consoleOpen && (
              <ol className="make-console-lines">
                {consoleLines.length === 0 && <li className="make-console-empty">Пусто — console.log и ошибки страницы появятся здесь.</li>}
                {consoleLines.map((l, i) => <li key={`${l.at}-${i}`} className={`make-console-line make-console-line--${l.level}`}><span className="make-console-level">{l.level}</span><code>{l.text}</code></li>)}
              </ol>
            )}
          </section>
        </div>
      )}

      {mode === 'code' && (
        <div className={dropActive ? 'make-code make-code--drop' : 'make-code'} onDragOver={onDragOver} onDragLeave={() => setDropActive(false)} onDrop={onDrop} data-testid="make-code">
          <nav className="make-tree" aria-label="Файлы проекта">
            <div className="make-search">
              <input
                type="search"
                className="make-search-input"
                aria-label="Поиск по файлам проекта"
                placeholder="Имя файла или текст… (Enter — по содержимому)"
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setMatches(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch() } if (e.key === 'Escape') { setQuery(''); setMatches(null) } }}
              />
              {searching && <span className="make-search-state">ищу…</span>}
            </div>
            {matches !== null && (
              <div className="make-matches" role="region" aria-label="Результаты поиска" data-testid="make-matches">
                <p className="make-tree-dir">{matches.length === 0 ? 'Ничего не найдено' : `Найдено: ${matches.length}`}</p>
                {matches.map((m, i) => (
                  <button key={`${m.path}:${m.line}:${i}`} type="button" className="make-match" onClick={() => void openFile(m.path)} title={`${m.path}:${m.line}`}>
                    <span className="make-match-path">{m.path}<span className="make-match-line">:{m.line}</span></span>
                    <code className="make-match-text">{m.text}</code>
                  </button>
                ))}
              </div>
            )}
            {dropActive && <p className="make-drop-hint" role="status">Отпустите, чтобы загрузить файлы в проект</p>}
            {groups.length === 0 && <EmptyState title="Файлов пока нет" description="Создайте файл, перетащите его сюда или попросите ассистента." />}
            {groups.map((group) => ({ ...group, files: group.files.filter((f) => !query.trim() || f.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter((g) => g.files.length > 0).map((group) => (
              <div className="make-tree-group" key={group.dir || '/'}>
                {group.dir && <p className="make-tree-dir">📁 {group.dir}</p>}
                {group.files.map((file) => (
                  <div key={file.path} className={file.path === selectedPath ? 'make-tree-item on' : 'make-tree-item'}>
                    <button type="button" className="make-tree-file" onClick={() => void openFile(file.path)} title={`${file.path} · ${formatSize(file.size)}`}>
                      {group.dir ? file.path.slice(group.dir.length + 1) : file.path}
                    </button>
                    <span className="make-tree-actions">
                      <IconButton size="sm" aria-label={`Переименовать ${file.path}`} title="Переименовать" onClick={() => renameFile(file.path)}>✎</IconButton>
                      <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void deleteFile(file.path)}>✕</IconButton>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="make-editor">
            {issues !== null && (
              <div className={issues.length ? 'make-issues make-issues--bad' : 'make-issues'} role="status" data-testid="make-issues">
                {issues.length === 0 ? <span>✓ Проверка пройдена: index.html есть, ссылки на файлы проекта разрешаются.</span> : (
                  <ul>{issues.map((issue, i) => <li key={i}><button type="button" className="make-issue-path" onClick={() => void openFile(issue.path)}>{issue.path}</button> — {issue.message}</li>)}</ul>
                )}
                <IconButton size="sm" aria-label="Скрыть результат проверки" title="Скрыть" onClick={() => setIssues(null)}>✕</IconButton>
              </div>
            )}
            {tabs.length > 0 && (
              <div className="make-tabs-bar" role="tablist" aria-label="Открытые файлы">
                {tabs.map((t) => (
                  <div key={t} className={t === selectedPath ? 'make-file-tab on' : 'make-file-tab'}>
                    <button type="button" role="tab" aria-selected={t === selectedPath} className="make-file-tab-name" onClick={() => void openFile(t)} title={t}>
                      {t.slice(t.lastIndexOf('/') + 1)}{t === selectedPath && dirty ? <span className="make-file-tab-dirty" aria-label="не сохранено">●</span> : null}
                    </button>
                    <IconButton size="sm" aria-label={`Закрыть ${t}`} title="Закрыть" onClick={() => closeTab(t)}>✕</IconButton>
                  </div>
                ))}
              </div>
            )}
            {selectedPath && !isMakeTextPath(selectedPath) ? (
              <>
                <div className="make-editor-head">
                  <code>{selectedPath}</code>
                  <span className="make-editor-state">{formatSize(state?.files.find((f) => f.path === selectedPath)?.size ?? 0)} · бинарный файл</span>
                </div>
                <div className="make-binary" data-testid="make-binary">
                  {/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(selectedPath)
                    ? <img src={`${base}${selectedPath}?rev=${previewRev}`} alt={`Просмотр ${selectedPath}`} />
                    : <EmptyState title="Файл не текстовый" description="Его нельзя править в редакторе, но он доступен в превью и в ZIP." />}
                  <code className="make-binary-ref">{selectedPath}</code>
                </div>
              </>
            ) : selectedPath ? (
              <>
                <div className="make-editor-head">
                  <code>{selectedPath}</code>
                  <span className="make-editor-tools">
                    <label className="make-autosave"><input type="checkbox" checked={autosave} onChange={toggleAutosave} /> автосохранение</label>
                    <span className={dirty ? 'make-editor-state dirty' : 'make-editor-state'}>{dirty ? 'не сохранено' : 'сохранено'}</span>
                  </span>
                </div>
                <CodeEditor path={selectedPath} value={content} onChange={setContent} onSave={() => void save()} ariaLabel={`Содержимое ${selectedPath}`} markers={markers} projectFiles={projectFiles} />
              </>
            ) : (
              <EmptyState title="Выберите файл" description="Слева — файлы проекта. Правки сохраняются кнопкой или Ctrl/Cmd+S и сразу видны в превью." />
            )}
          </div>
        </div>
      )}

      {mode === 'stories' && (
        <div className="make-stories" data-testid="make-stories">
          <nav className="make-tree make-stories-list" aria-label="Компоненты и стори">
            {storyFiles === null && <p className="make-tree-dir">Загружаю…</p>}
            {storyFiles !== null && storyFiles.length === 0 && (
              <EmptyState
                title="Сториз пока нет"
                description="Добавьте рядом с компонентом файл <Имя>.stories.jsx (CSF: default { title, component, args } и именованные экспорты) или начните с шаблона «React-приложение + Storybook»."
                actionLabel="Шаблоны"
                onAction={() => setTemplatesOpen(true)}
              />
            )}
            {storyFiles?.map((file) => (
              <div className="make-tree-group" key={file.path}>
                <p className="make-tree-dir" title={file.path}>▣ {file.title}</p>
                {file.stories.map((name) => {
                  const on = story?.file === file.path && story.name === name
                  return (
                    <div className={on ? 'make-tree-item on' : 'make-tree-item'} key={name}>
                      <button type="button" className="make-tree-file" aria-current={on ? 'true' : undefined} onClick={() => setStory({ file: file.path, name })}>{name}</button>
                    </div>
                  )
                })}
                <div className="make-tree-item">
                  <button type="button" className="make-tree-file make-tree-file--dim" onClick={() => { void openFile(file.path); setMode('code') }}>✎ открыть сториз</button>
                </div>
              </div>
            ))}
          </nav>
          <div className="make-story-host">
            {story && previewReady ? (
              <iframe
                ref={storyFrameRef}
                key={`${story.file}:${story.name}:${previewRev}`}
                className="make-story-frame"
                title={`Стори ${story.name}`}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
                src={`${base}__stories__?file=${encodeURIComponent(story.file)}&story=${encodeURIComponent(story.name)}&rev=${previewRev}`}
              />
            ) : storyFiles && storyFiles.length > 0 ? (
              <EmptyState title="Выберите стори" description="Слева — компоненты проекта и их состояния." />
            ) : null}
            {story && storyArgs && (
              <section className="make-controls" aria-label="Controls: args стори" data-testid="make-controls">
                <div className="make-controls-head">
                  <strong>Controls</strong>
                  <span className="make-controls-actions">
                    {Object.keys(argOverrides).length > 0 && <Button size="sm" variant="ghost" onClick={resetArgs}>Сбросить</Button>}
                    {onInsertToChat && Object.keys(argOverrides).length > 0 && <Button size="sm" variant="secondary" onClick={sendArgsToChat}>Сохранить через ассистента</Button>}
                  </span>
                </div>
                {Object.keys(storyArgs).length === 0 ? (
                  <p className="make-controls-empty">У стори нет args — добавьте их в default-экспорт или в саму стори.</p>
                ) : (
                  <div className="make-controls-grid">
                    {Object.entries(storyArgs).map(([key, base]) => {
                      const value = key in argOverrides ? argOverrides[key] : base
                      const id = `make-arg-${key}`
                      if (typeof base === 'boolean') {
                        return <label key={key} className="make-control" htmlFor={id}><span>{key}</span><input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => setArg(key, e.target.checked)} /></label>
                      }
                      if (typeof base === 'number') {
                        return <label key={key} className="make-control" htmlFor={id}><span>{key}</span><input id={id} type="number" value={Number(value)} onChange={(e) => setArg(key, Number(e.target.value))} /></label>
                      }
                      if (typeof base === 'string' && argOptions[key] && argOptions[key]!.length >= 2) {
                        const opts = argOptions[key]!
                        const current = String(value)
                        return (
                          <label key={key} className="make-control" htmlFor={id}><span>{key}</span>
                            <select id={id} value={current} onChange={(e) => setArg(key, e.target.value)}>
                              {!opts.includes(current) && <option value={current}>{current}</option>}
                              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </label>
                        )
                      }
                      if (typeof base === 'string' && !/^\[(function|element)\]$/.test(base)) {
                        return <label key={key} className="make-control" htmlFor={id}><span>{key}</span><input id={id} type="text" value={String(value)} onChange={(e) => setArg(key, e.target.value)} /></label>
                      }
                      return <div key={key} className="make-control make-control--ro"><span>{key}</span><code>{typeof base === 'string' ? base : JSON.stringify(base)}</code></div>
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {mode === 'history' && (
        <div className="make-history">
          {(state?.snapshots.length ?? 0) === 0 ? (
            <EmptyState title="Снимков пока нет" description="Ассистент сохраняет снимок перед каждой правкой; свой снимок — кнопкой «+ Снимок»." />
          ) : (
            <ul className="make-snapshots" aria-label="Снимки проекта">
              {state!.snapshots.map((snap) => (
                <li key={snap.id} className="make-snapshot">
                  <span className="make-snapshot-meta">
                    <strong>{snap.label}</strong>
                    <small>{formatTime(snap.createdAt)} · файлов: {snap.files}</small>
                  </span>
                  <span className="make-snapshot-actions">
                    <Button size="sm" variant="ghost" onClick={() => void loadDiff(snap.id)} aria-expanded={Boolean(diffs[snap.id])}>{diffs[snap.id] ? 'Скрыть' : 'Сравнить'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => void restoreSnapshot(snap.id, snap.label)}>Вернуть</Button>
                  </span>
                  {diffs[snap.id] === 'loading' && <p className="make-diff-note">Сравниваю…</p>}
                  {diffs[snap.id] && diffs[snap.id] !== 'loading' && (
                    <ul className="make-diff" aria-label={`Отличия от снимка ${snap.label}`} data-testid="make-diff">
                      {(diffs[snap.id] as MakeSnapshotDiff).files.filter((f) => f.status !== 'same').length === 0 && <li className="make-diff-note">Файлы совпадают с текущими.</li>}
                      {(diffs[snap.id] as MakeSnapshotDiff).files.filter((f) => f.status !== 'same').map((f) => (
                        <li key={f.path} className={`make-diff-row make-diff-row--${f.status}`}>
                          <span className="make-diff-status">{f.status === 'added' ? 'новый' : f.status === 'removed' ? 'удалён' : 'изменён'}</span>
                          {isMakeTextPath(f.path)
                            ? <button type="button" className="make-diff-file" onClick={() => void openFileDiff(snap.id, snap.label, f.path)} title="Показать сравнение"><code>{f.path}</code></button>
                            : <code>{f.path}</code>}
                          <small>{f.before !== null ? formatSize(f.before) : '—'} → {f.after !== null ? formatSize(f.after) : '—'}</small>
                          {f.status !== 'added' && <Button size="sm" variant="ghost" onClick={() => void restoreFile(snap.id, f.path)}>Вернуть файл</Button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="make-history-foot">
            <Button size="sm" variant="danger" onClick={() => void resetProject()}>Сбросить проект</Button>
          </div>
        </div>
      )}

      {fileDiff && (
        <Dialog title={`Сравнение: ${fileDiff.path}`} ariaLabel={`Сравнение ${fileDiff.path}`} size="lg" onClose={() => setFileDiff(null)} testId="make-file-diff"
          actions={<Button size="sm" variant="secondary" onClick={() => { void restoreFile(fileDiff.snapshotId, fileDiff.path); setFileDiff(null) }}>Вернуть файл из снимка</Button>}>
          <p className="make-ideas-lead">Слева — снимок «{fileDiff.label}», справа — текущая версия.</p>
          <CodeDiff path={fileDiff.path} original={fileDiff.original} modified={fileDiff.modified} />
        </Dialog>
      )}
      {assetsOpen && (
        <Dialog title="Ассеты проекта" ariaLabel="Ассеты проекта" size="md" onClose={() => setAssetsOpen(false)} testId="make-assets">
          <p className="make-ideas-lead">Картинки и другие бинарные файлы проекта. Путь или тег вставляются в буфер — дальше в код или в просьбу ассистенту.</p>
          {assets.length === 0 ? (
            <EmptyState title="Ассетов пока нет" description="Загрузите картинки кнопкой «Загрузить» или перетащите их в дерево файлов." actionLabel="Загрузить" onAction={() => { setAssetsOpen(false); uploadInputRef.current?.click() }} />
          ) : (
            <ul className="make-assets" aria-label="Список ассетов">
              {assets.map((f) => (
                <li key={f.path} className="make-asset">
                  <div className="make-asset-thumb">
                    {/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(f.path) ? <img src={`${base}${f.path}?rev=${previewRev}`} alt="" /> : <span>{f.path.split('.').pop()?.toUpperCase()}</span>}
                  </div>
                  <div className="make-asset-meta">
                    <code title={f.path}>{f.path}</code>
                    <small>{formatSize(f.size)}</small>
                  </div>
                  <span className="make-asset-actions">
                    <Button size="sm" variant="ghost" onClick={() => void copyAsset(f.path, 'Путь')}>Путь</Button>
                    <Button size="sm" variant="ghost" onClick={() => void copyAsset(`<img src="${f.path}" alt="">`, 'Тег')}>&lt;img&gt;</Button>
                    <IconButton size="sm" aria-label={`Удалить ${f.path}`} title="Удалить" onClick={() => void deleteFile(f.path)}>✕</IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {exportOpen && (
        <Dialog title="Скачать проект" ariaLabel="Скачать проект" size="sm" onClose={() => setExportOpen(false)} testId="make-export">
          <div className="make-export-options">
            <button type="button" className="make-idea" onClick={() => { window.open(REST.makeExport(conversationId), '_blank', 'noopener'); setExportOpen(false) }}>
              <strong>Статика как есть</strong>
              <span>ZIP с файлами проекта — открывается двойным кликом по index.html или кладётся на любой хостинг.</span>
            </button>
            <button type="button" className="make-idea" onClick={() => { window.open(`${REST.makeExport(conversationId)}?vite=1`, '_blank', 'noopener'); setExportOpen(false) }}>
              <strong>Vite-проект</strong>
              <span>Плюс package.json, vite.config и README: распаковать, <code>npm install</code>, <code>npm run dev</code> — и продолжать в своём редакторе.</span>
            </button>
          </div>
        </Dialog>
      )}
      {importOpen && (
        <Dialog title="Импорт проекта" ariaLabel="Импорт проекта" size="sm" onClose={() => setImportOpen(false)} testId="make-import" closeOnOverlay={false}>
          <p className="make-ideas-lead">Перед импортом сохранится снимок — откатиться можно во вкладке «История».</p>
          <fieldset className="make-import-mode">
            <legend>Как применить</legend>
            <label><input type="radio" name="make-import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> заменить проект</label>
            <label><input type="radio" name="make-import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> добавить к текущим файлам</label>
          </fieldset>
          <section className="make-import-block">
            <h3>ZIP-архив</h3>
            <p>Файлы проекта в корне архива или в одной общей папке; до 400 файлов по 2 МБ.</p>
            <input ref={importZipRef} type="file" accept=".zip,application/zip" aria-label="ZIP-архив проекта" data-testid="make-import-zip" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) void runImport('zip', f) }} />
          </section>
          <section className="make-import-block">
            <h3>Страница по адресу</h3>
            <p>Скачаем HTML и её стили/скрипты/картинки с того же домена — как стартовую точку для редизайна.</p>
            <div className="make-import-url">
              <input type="url" aria-label="Адрес страницы" placeholder="https://example.com/" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runImport('url') }} disabled={importing} />
              <Button size="sm" variant="primary" onClick={() => void runImport('url')} loading={importing} disabled={!importUrl.trim()}>Импортировать</Button>
            </div>
          </section>
        </Dialog>
      )}
      {ideasOpen && (
        <Dialog title="Идеи для старта" ariaLabel="Идеи для старта" size="md" onClose={() => setIdeasOpen(false)} testId="make-ideas">
          <p className="make-ideas-lead">Готовые промпты в духе Figma Make: клик вставляет текст в композер, дальше можно отредактировать и отправить.</p>
          {(Object.keys(MAKE_STARTER_GROUPS) as Array<keyof typeof MAKE_STARTER_GROUPS>).map((group) => (
            <section key={group} className="make-ideas-group">
              <h3>{MAKE_STARTER_GROUPS[group]}</h3>
              {MAKE_STARTER_PROMPTS.filter((i) => i.group === group).map((item) => (
                <button key={item.id} type="button" className="make-idea" onClick={() => useStarter(item.prompt)}>
                  <strong>{item.title}</strong>
                  <span>{item.prompt}</span>
                </button>
              ))}
            </section>
          ))}
        </Dialog>
      )}
      {publishOpen && (
        <Dialog title="Публикация проекта" ariaLabel="Публикация проекта" size="sm" onClose={() => setPublishOpen(false)} testId="make-publish">
          {state?.published ? (
            <div className="make-publish">
              <p className="fsub">Ссылка открывается без входа — у всех, кто её знает. Файлы отдаются текущие: изменения видны сразу.</p>
              <div className="make-publish-link">
                <code data-testid="make-public-url">{typeof window !== 'undefined' ? new URL(state.published.url, window.location.origin).toString() : state.published.url}</code>
                <Button size="sm" variant="secondary" onClick={() => void copyPublicLink()}>Копировать</Button>
                <Button size="sm" variant="ghost" onClick={() => window.open(state.published!.url, '_blank', 'noopener')}>Открыть</Button>
              </div>
              <div className="make-ask-actions"><Button size="sm" variant="danger" onClick={() => void unpublish()}>Снять с публикации</Button></div>
            </div>
          ) : (
            <div className="make-publish">
              <p className="fsub">Проект получит непубличную ссылку вида <code>/p/&lt;токен&gt;/</code>: открывается без входа, поисковикам не индексируется, снять можно в любой момент.</p>
              <div className="make-ask-actions"><Button size="sm" variant="primary" onClick={() => void publish()}>Опубликовать</Button></div>
            </div>
          )}
        </Dialog>
      )}

      {templatesOpen && (
        <Dialog title="Шаблоны проекта" ariaLabel="Шаблоны проекта" size="md" onClose={() => setTemplatesOpen(false)} testId="make-templates">
          <ul className="make-templates" aria-label="Шаблоны">
            {MAKE_TEMPLATES.map((t) => (
              <li key={t.id} className="make-template">
                <span className="make-template-meta"><strong>{t.title}</strong><small>{t.description}</small></span>
                <Button size="sm" variant="secondary" onClick={() => void applyTemplate(t.id, t.title)}>Применить</Button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {ask && (
        <Dialog title={ask.title} ariaLabel={ask.title} size="sm" onClose={() => setAsk(null)} testId="make-ask">
          <form className="make-ask" onSubmit={(e) => { e.preventDefault(); const value = askValue.trim(); setAsk(null); if (value) ask.onSubmit(value) }}>
            <label className="make-ask-field"><span>{ask.label}</span><input className="tin" autoFocus value={askValue} aria-label={ask.label} onChange={(e) => setAskValue(e.target.value)} /></label>
            <div className="make-ask-actions">
              <Button size="sm" variant="secondary" type="button" onClick={() => setAsk(null)}>Отмена</Button>
              <Button size="sm" variant="primary" type="submit" disabled={!askValue.trim()}>{ask.submit}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}
