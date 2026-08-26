import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, EmptyState, IconButton, useConfirm, useToast } from '@voicechat/ui-kit'
import type { RendererApi, RendererMakeBridge } from '@shared/ipc'
import { REST } from '@shared/protocol'
import { MAKE_TEMPLATES, isMakeTextPath, normalizeMakePath, type MakeCheckIssue, type MakeFileInfo, type MakeProjectState } from '@shared/make'

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
}

export interface MakePaneProps {
  conversationId: string
  api: Pick<RendererApi, 'make:state' | 'make:read' | 'make:write' | 'make:delete' | 'make:rename' | 'make:snapshot' | 'make:restore' | 'make:reset' | 'make:publish' | 'make:unpublish' | 'make:check' | 'make:template' | 'make:upload'>
  make?: RendererMakeBridge
  /** Вставить текст в поле ввода чата (просьба ассистенту про выбранный элемент). */
  onInsertToChat?: (text: string) => void
  /** База превью; по умолчанию — REST.makePreview (тест подменяет). */
  previewBase?: string
  /**
   * Cookie-гейт превью: iframe не умеет слать Bearer, поэтому перед первой загрузкой
   * сервер выпускает preview-cookie (`session:ensurePreview`, как у Web Reader).
   */
  ensurePreview?: () => Promise<boolean>
}

type Mode = 'preview' | 'code' | 'history'
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

export function MakePane({ conversationId, api, make, onInsertToChat, previewBase, ensurePreview }: MakePaneProps): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>('preview')
  const [state, setState] = useState<MakeProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<Device>('desktop')
  const [fullscreen, setFullscreen] = useState(false)
  const [inspect, setInspect] = useState(false)
  const [selected, setSelected] = useState<MakeSelectedElement | null>(null)
  const [previewRev, setPreviewRev] = useState(0)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  /** Превью готово к загрузке: cookie выпущена (или гейта нет). */
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  /** Диалог ввода имени (новый файл / переименование / подпись снимка) — вместо window.prompt. */
  const [ask, setAsk] = useState<{ title: string; label: string; initial: string; submit: string; onSubmit: (value: string) => void } | null>(null)
  const [askValue, setAskValue] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [issues, setIssues] = useState<MakeCheckIssue[] | null>(null)
  const [checking, setChecking] = useState(false)
  const openAsk = (title: string, label: string, initial: string, submit: string, onSubmit: (value: string) => void): void => { setAskValue(initial); setAsk({ title, label, initial, submit, onSubmit }) }
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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
      const data = event.data as { type?: string; selector?: string; tag?: string; text?: string; html?: string } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'vc-make.ready') {
        frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
      } else if (data.type === 'vc-make.selected' && data.selector) {
        setSelected({ selector: data.selector, tag: data.tag ?? '', text: data.text ?? '', html: data.html ?? '' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [inspect])

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
  }, [inspect, previewRev])

  const save = useCallback(async (): Promise<void> => {
    if (!selectedPath || !dirty || saving) return
    setSaving(true)
    try {
      const next = await api['make:write']({ conversationId, path: selectedPath, content })
      setSavedContent(content)
      setState(next)
      setPreviewRev(next.rev)
      toast.success('Сохранено')
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setSaving(false)
    }
  }, [api, conversationId, selectedPath, content, dirty, saving, toast])

  // Ctrl/Cmd+S в редакторе — сохранить; Tab — отступ, а не переход фокуса.
  const onEditorKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const el = event.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = `${content.slice(0, start)}  ${content.slice(end)}`
      setContent(next)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
    }
  }

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

  const sendSelectedToChat = (): void => {
    if (!selected || !onInsertToChat) return
    const text = `Измени элемент ${selected.selector}${selected.text ? ` («${selected.text.slice(0, 80)}»)` : ''}: `
    onInsertToChat(text)
    setInspect(false)
  }

  const groups = useMemo(() => groupFiles(state?.files ?? []), [state])
  const frameWidth = DEVICE_WIDTH[device]
  const previewSrc = `${base}index.html?rev=${previewRev}`

  const header = (
    <div className="make-head" role="toolbar" aria-label="Панель проекта">
      <div className="make-tabs" role="tablist" aria-label="Режим панели">
        {(['preview', 'code', 'history'] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'make-tab on' : 'make-tab'} onClick={() => setMode(m)}>
            {m === 'preview' ? 'Превью' : m === 'code' ? 'Код' : 'История'}
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
          <input ref={uploadInputRef} type="file" multiple hidden aria-label="Загрузить файлы в проект" data-testid="make-upload-input" onChange={(e) => void uploadFiles(e.target.files)} />
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()} title="Сохранить (Ctrl/Cmd+S)">{saving ? 'Сохраняю…' : 'Сохранить'}</Button>
        </>
      )}
      {mode === 'history' && <Button size="sm" variant="secondary" onClick={takeSnapshot}>+ Снимок</Button>}
      <IconButton size="sm" aria-label="Шаблоны проекта" title="Начать с шаблона" onClick={() => setTemplatesOpen(true)}>▤</IconButton>
      <Button size="sm" variant={state?.published ? 'secondary' : 'ghost'} onClick={() => setPublishOpen(true)} >{state?.published ? 'Опубликован' : 'Опубликовать'}</Button>
      <IconButton size="sm" aria-label="Скачать проект (ZIP)" title="Скачать проект (ZIP)" onClick={() => window.open(REST.makeExport(conversationId), '_blank', 'noopener')}>⇩</IconButton>
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
                {onInsertToChat && <Button size="sm" variant="primary" onClick={sendSelectedToChat}>В чат</Button>}
                <IconButton size="sm" aria-label="Снять выбор" title="Снять выбор" onClick={() => setSelected(null)}>✕</IconButton>
              </span>
            </div>
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
        </div>
      )}

      {mode === 'code' && (
        <div className="make-code">
          <nav className="make-tree" aria-label="Файлы проекта">
            {groups.length === 0 && <EmptyState title="Файлов пока нет" description="Создайте файл или попросите ассистента." />}
            {groups.map((group) => (
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
                  <span className={dirty ? 'make-editor-state dirty' : 'make-editor-state'}>{dirty ? 'не сохранено' : 'сохранено'}</span>
                </div>
                <textarea
                  ref={textareaRef}
                  className="make-textarea"
                  aria-label={`Содержимое ${selectedPath}`}
                  value={content}
                  spellCheck={false}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={onEditorKey}
                />
              </>
            ) : (
              <EmptyState title="Выберите файл" description="Слева — файлы проекта. Правки сохраняются кнопкой или Ctrl/Cmd+S и сразу видны в превью." />
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
                  <Button size="sm" variant="secondary" onClick={() => void restoreSnapshot(snap.id, snap.label)}>Вернуть</Button>
                </li>
              ))}
            </ul>
          )}
          <div className="make-history-foot">
            <Button size="sm" variant="danger" onClick={() => void resetProject()}>Сбросить проект</Button>
          </div>
        </div>
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
