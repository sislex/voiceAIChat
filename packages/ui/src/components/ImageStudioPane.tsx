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

type StudioApi = Pick<RendererApi,
  'imgstudio:list' | 'imgstudio:read' | 'imgstudio:upload' | 'imgstudio:delete' |
  'imgstudio:rename' | 'imgstudio:generate' | 'imgstudio:edit'>

interface Props {
  conversationId: string
  api: StudioApi
  /** Ход ассистента идёт — после него в галерее могут появиться картинки. */
  turnActive?: boolean
}

/** Пресеты размера: пустой — модель решает сама. */
const SIZE_PRESETS = ['', '512×512', '1024×1024', '1920×1080'] as const

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',').replace(',0', '')} МБ`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${bytes} Б`
}

export function ImageStudioPane({ conversationId, api, turnActive }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [files, setFiles] = useState<ImageStudioFile[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<string>('')
  const [busy, setBusy] = useState(false)
  /** Пока модель рисует/правит — что именно и сколько секунд уже идёт. */
  const [progress, setProgress] = useState<{ label: string; seconds: number } | null>(null)
  /** Последняя ошибка операции — баннером в панели, тост живёт только момент. */
  const [lastError, setLastError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
  /** blob-URL превью по имени файла; пересоздаются при смене updatedAt. */
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewKeys = useRef<Record<string, number>>({})

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await api['imgstudio:list']({ conversationId })
      setFiles(list)
      setFailed(false)
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
            return { ...prev, [file.path]: url }
          })
        }).catch(() => undefined)
      }
    } catch {
      setFailed(true)
    }
  }, [api, conversationId])

  useEffect(() => { void reload() }, [reload])
  // Во время хода ассистента картинки появляются без действий панели.
  usePolling(() => void reload(), { enabled: Boolean(turnActive), intervalMs: 4000 })
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
      if (success) toast.success(success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      toast.error(message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const generate = (): void => {
    if (busy || !prompt.trim()) return
    // Пресет размера — просто добавка к промпту: модель рисует скриптом и
    // размер для неё такой же текст, как и всё остальное.
    const fullPrompt = size ? `${prompt}\nРазмер изображения: ${size.replace('×', 'x')}` : prompt
    void run(async () => {
      // Выбрана картинка — правим её; нет — рисуем новую. Один промпт на
      // оба действия: так работает голова пользователя, а не наша схема.
      if (selected) await api['imgstudio:edit']({ conversationId, path: selected, prompt: fullPrompt })
      else await api['imgstudio:generate']({ conversationId, prompt: fullPrompt })
      setPrompt('')
      promptRef.current?.focus()
    }, selected ? 'Правка готова — результат рядом с оригиналом' : 'Изображение готово',
      selected ? `Модель правит «${selected}»` : 'Модель рисует')
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
        const buffer = await file.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
        await api['imgstudio:upload']({ conversationId, path: file.name, dataBase64: btoa(binary) })
      }
    }, items.length === 1 ? `Загружено: ${items[0]!.name}` : `Загружено файлов: ${items.length}`)
  }

  const blobOf = (file: ImageStudioFile): Promise<Blob> =>
    api['imgstudio:read']({ conversationId, path: file.path }).then(({ dataBase64 }) => {
      const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
      return new Blob([bytes], { type: imageStudioMime(file.path) })
    })

  const download = (file: ImageStudioFile): void => {
    void blobOf(file).then((blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.path
      link.click()
      URL.revokeObjectURL(url)
    }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
  }

  const copy = (file: ImageStudioFile): void => {
    void blobOf(file)
      .then((blob) => copyImage(blob))
      .catch(() => false)
      .then((ok) => (ok ? toast.success('Скопировано в буфер') : toast.error('Не удалось скопировать — браузер не разрешил доступ к буферу')))
  }

  if (failed) return <div className="image-studio"><ErrorState message="Не удалось загрузить галерею" onRetry={() => void reload()} /></div>
  if (!files) return <div className="image-studio"><Skeleton variant="list" count={3} item="block" height={96} gap={10} /></div>

  const usedBytes = files.reduce((sum, file) => sum + file.size, 0)

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
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); generate() } }}
      />
      <div className="image-studio-actions">
        <Button size="sm" disabled={busy || !prompt.trim()} loading={busy} title="⌘Enter / Ctrl+Enter" onClick={generate}>
          {selected ? 'Изменить выбранную' : 'Нарисовать'}
        </Button>
        {!selected && <select aria-label="Размер изображения" value={size} disabled={busy} onChange={(event) => setSize(event.target.value)}>
          {SIZE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset === '' ? 'Размер: авто' : preset}</option>)}
        </select>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>Загрузить…</Button>
        {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Снять выбор</Button>}
        <input ref={uploadRef} type="file" accept="image/*,.svg" multiple hidden aria-label="Файл изображения" onChange={(event) => { if (event.target.files?.length) upload(event.target.files); event.target.value = '' }} />
      </div>
      {progress && <p className="image-studio-progress" role="status">
        {progress.label}… {progress.seconds} с. Обычно это занимает до минуты.
      </p>}
      {lastError && !busy && <ErrorState compact message={lastError} />}
    </div>

    {files.length === 0
      ? <EmptyState title="Галерея пуста — нарисуйте первую картинку" description="Опишите её в поле выше, перетащите файлы сюда или попросите ассистента в чате слева: всё нарисованное попадает сюда." />
      : <>
          <div className="image-studio-grid" role="list" aria-label="Галерея изображений">
            {files.map((file) => <div role="listitem" key={file.path} className={`image-studio-card${selected === file.path ? ' image-studio-card--selected' : ''}`}>
            <button type="button" className="image-studio-thumb" aria-label={file.path} aria-pressed={selected === file.path} onClick={() => setSelected(selected === file.path ? null : file.path)} title={selected === file.path ? 'Снять выбор' : 'Выбрать для правки'}>
              {previews[file.path]
                ? <img src={previews[file.path]} alt="" />
                : <span className="image-studio-thumb-loading" role="status">…</span>}
            </button>
            {renaming?.from === file.path
              ? <div className="image-studio-rename">
                  <input
                    ref={renameRef}
                    aria-label="Новое имя файла"
                    value={renaming.to}
                    onChange={(event) => setRenaming({ from: file.path, to: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }}
                  />
                  <Button size="sm" disabled={busy || !renaming.to.trim()} onClick={() => void run(async () => {
                    await api['imgstudio:rename']({ conversationId, from: file.path, to: renaming.to.trim() })
                    setRenaming(null)
                    if (selected === file.path) setSelected(renaming.to.trim())
                  }, 'Переименовано')}>Ок</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Отмена</Button>
                </div>
              : <div className="image-studio-meta">
                  <span className="image-studio-name" title={`${file.path} · ${formatBytes(file.size)}`}>{file.path}</span>
                  <span className="image-studio-card-actions">
                    <IconButton size="sm" aria-label={`Открыть ${file.path} в полный размер`} title="В полный размер" onClick={() => setViewing(file.path)}>⛶</IconButton>
                    <IconButton size="sm" aria-label={`Копировать ${file.path} в буфер`} title="Копировать" onClick={() => copy(file)}>⧉</IconButton>
                    <IconButton size="sm" aria-label={`Переименовать ${file.path}`} title="Переименовать" onClick={() => setRenaming({ from: file.path, to: file.path })}>✎</IconButton>
                    <IconButton size="sm" aria-label={`Скачать ${file.path}`} title="Скачать" onClick={() => download(file)}>⇩</IconButton>
                    <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void (async () => {
                      if (!(await confirm({ title: `Удалить «${file.path}»?`, message: 'Восстановить изображение будет нельзя.', confirmLabel: 'Удалить' }))) return
                      await run(() => api['imgstudio:delete']({ conversationId, path: file.path }), 'Удалено')
                      if (selected === file.path) setSelected(null)
                    })()}>✕</IconButton>
                  </span>
                </div>}
            </div>)}
          </div>
          <p className="image-studio-quota">
            {files.length === 1 ? '1 файл' : `Файлов: ${files.length}`} · занято {formatBytes(usedBytes)} из {formatBytes(IMAGE_STUDIO_LIMITS.maxConversationBytes)}
          </p>
        </>}

    {viewing && <ToolFrame title={viewing} onClose={() => setViewing(null)} className="util-embed--img" testId="image-studio-viewer">
      <div className="imgbody">
        {previews[viewing]
          ? <img className="image-studio-full" src={previews[viewing]} alt={viewing} />
          : <p className="imgerr" role="alert">Превью ещё не загрузилось</p>}
      </div>
    </ToolFrame>}
  </div>
}
