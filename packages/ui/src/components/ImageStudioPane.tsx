// Студия картинок: правая панель чата вида images — галерея разговора.
// Ассистент рисует в чате (его картинки сервер сам складывает сюда), панель
// добавляет прямые действия: загрузить свои, сгенерировать по промпту,
// поправить выбранную по промпту, переименовать, удалить, скачать.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { ImageStudioFile } from '@shared/imageStudio'
import { imageStudioMime, isImageStudioPath } from '@shared/imageStudio'
import { Button, EmptyState, ErrorState, IconButton, Skeleton, useConfirm, useToast } from '@voicechat/ui-kit'
import { usePolling } from '../lib/usePolling'

type StudioApi = Pick<RendererApi,
  'imgstudio:list' | 'imgstudio:read' | 'imgstudio:upload' | 'imgstudio:delete' |
  'imgstudio:rename' | 'imgstudio:generate' | 'imgstudio:edit'>

interface Props {
  conversationId: string
  api: StudioApi
  /** Ход ассистента идёт — после него в галерее могут появиться картинки. */
  turnActive?: boolean
}

export function ImageStudioPane({ conversationId, api, turnActive }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [files, setFiles] = useState<ImageStudioFile[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)
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

  const run = async (action: () => Promise<unknown>, success?: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await reload()
      if (success) toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const upload = (file: File): void => {
    if (!isImageStudioPath(file.name)) {
      toast.error('Студия принимает только изображения (png, jpg, webp, gif, svg)')
      return
    }
    void run(async () => {
      const buffer = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buffer)
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
      await api['imgstudio:upload']({ conversationId, path: file.name, dataBase64: btoa(binary) })
    }, `Загружено: ${file.name}`)
  }

  const download = (file: ImageStudioFile): void => {
    void api['imgstudio:read']({ conversationId, path: file.path }).then(({ dataBase64 }) => {
      const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: imageStudioMime(file.path) }))
      const link = document.createElement('a')
      link.href = url
      link.download = file.path
      link.click()
      URL.revokeObjectURL(url)
    }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
  }

  if (failed) return <div className="image-studio"><ErrorState message="Не удалось загрузить галерею" onRetry={() => void reload()} /></div>
  if (!files) return <div className="image-studio"><Skeleton variant="list" count={3} item="block" height={96} gap={10} /></div>

  return <div className="image-studio" data-testid="image-studio">
    <div className="image-studio-toolbar">
      <textarea
        aria-label="Промпт для изображения"
        rows={2}
        placeholder={selected ? `Что изменить в «${selected}»…` : 'Что нарисовать…'}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="image-studio-actions">
        <Button size="sm" disabled={busy || !prompt.trim()} loading={busy} onClick={() => void run(async () => {
          // Выбрана картинка — правим её; нет — рисуем новую. Один промпт на
          // оба действия: так работает голова пользователя, а не наша схема.
          if (selected) await api['imgstudio:edit']({ conversationId, path: selected, prompt })
          else await api['imgstudio:generate']({ conversationId, prompt })
          setPrompt('')
        }, selected ? 'Правка готова — результат рядом с оригиналом' : 'Изображение готово')}>
          {selected ? 'Изменить выбранную' : 'Нарисовать'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>Загрузить…</Button>
        {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Снять выбор</Button>}
        <input ref={uploadRef} type="file" accept="image/*,.svg" hidden aria-label="Файл изображения" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      </div>
    </div>

    {files.length === 0
      ? <EmptyState title="Галерея пуста — нарисуйте первую картинку" description="Опишите её в поле выше или попросите ассистента в чате слева: всё нарисованное попадает сюда." />
      : <div className="image-studio-grid" role="list" aria-label="Галерея изображений">
          {files.map((file) => <div role="listitem" key={file.path} className={`image-studio-card${selected === file.path ? ' image-studio-card--selected' : ''}`}>
            <button type="button" className="image-studio-thumb" aria-label={file.path} aria-pressed={selected === file.path} onClick={() => setSelected(selected === file.path ? null : file.path)} title={selected === file.path ? 'Снять выбор' : 'Выбрать для правки'}>
              {previews[file.path]
                ? <img src={previews[file.path]} alt="" />
                : <span className="image-studio-thumb-loading" role="status">…</span>}
            </button>
            {renaming?.from === file.path
              ? <div className="image-studio-rename">
                  <input aria-label="Новое имя файла" value={renaming.to} onChange={(event) => setRenaming({ from: file.path, to: event.target.value })} />
                  <Button size="sm" disabled={busy || !renaming.to.trim()} onClick={() => void run(async () => {
                    await api['imgstudio:rename']({ conversationId, from: file.path, to: renaming.to.trim() })
                    setRenaming(null)
                    if (selected === file.path) setSelected(renaming.to.trim())
                  }, 'Переименовано')}>Ок</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Отмена</Button>
                </div>
              : <div className="image-studio-meta">
                  <span className="image-studio-name" title={file.path}>{file.path}</span>
                  <span className="image-studio-card-actions">
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
        </div>}
  </div>
}
