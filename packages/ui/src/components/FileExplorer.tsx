import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentInfo, FsEntry } from '@shared/agentProtocol'
import type { MachineOps, SwitchUtility, UtilityVariant } from './machine'
import { MachineUtilityHeader, READ_ONLY_HINT } from './MachineUtilityHeader'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../lib/loadState'
import { ToolFrame } from './ToolFrame'
import { CodeEditor } from './CodeEditor'
import { CodeDiff } from './CodeDiff'
import { isToolAllowed } from '@shared/version'

export interface FileExplorerProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Файл, чью папку нужно открыть и чью строку выделить. */
  initialFilePath?: string
  /** Открыть проводник ВНУТРИ этой папки (а не в родителе файла). */
  initialDir?: string
  ops: MachineOps
  variant?: UtilityVariant
  onClose?: () => void
  /** Переключиться на консоль/терминал этой машины в текущей папке (шапка утилиты). */
  onSwitchUtility?: SwitchUtility
  /** Подпись консольной кнопки переключателя: «Терминал» (есть PTY) или «Консоль». */
  consoleLabel?: string
  /** Ссылка в раздел «Машины» из шапки утилиты. */
  onOpenMachines?: () => void
}

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} МБ`
  if (n >= 1000) return `${Math.round(n / 1000)} КБ`
  return `${n} Б`
}
function parentOf(p: string): string {
  const up = p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')
  return up || '/'
}
function nameOf(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, '')}/${name}`
}

const PREVIEW_MAX_BYTES = 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', ico: 'image/x-icon',
  jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp'
}

type Preview = { path: string; name: string; size: number; kind: 'text' | 'image' | 'unavailable' }

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}
function bytesFromBase64(dataBase64: string): Uint8Array {
  return Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0))
}
function decodeUtf8(dataBase64: string): string | null {
  try {
    const bytes = bytesFromBase64(dataBase64)
    if (bytes.includes(0)) return null
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
function encodeUtf8(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

type SortBy = 'name' | 'size' | 'type'
type SortDirection = 'asc' | 'desc'

function breadcrumbs(cwd: string, root: string): Array<{ name: string; path: string; root: boolean }> {
  if (!cwd) return []
  const normalizedRoot = root.replace(/[\\/]+$/, '') || '/'
  const normalizedCwd = cwd.replace(/[\\/]+$/, '') || normalizedRoot
  if (normalizedCwd !== normalizedRoot && !normalizedCwd.startsWith(`${normalizedRoot}/`)) {
    return [{ name: normalizedCwd, path: normalizedCwd, root: true }]
  }
  const parts = normalizedCwd.slice(normalizedRoot.length).split('/').filter(Boolean)
  return [
    { name: normalizedRoot, path: normalizedRoot, root: true },
    ...parts.map((name, index) => ({ name, path: `${normalizedRoot.replace(/\/$/, '')}/${parts.slice(0, index + 1).join('/')}`, root: false }))
  ]
}

function sortEntries(entries: FsEntry[], sortBy: SortBy, direction: SortDirection): FsEntry[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    const aValue = sortBy === 'size' ? a.size : sortBy === 'type' ? (a.kind === 'dir' ? 'folder' : a.name.split('.').pop() ?? '') : a.name
    const bValue = sortBy === 'size' ? b.size : sortBy === 'type' ? (b.kind === 'dir' ? 'folder' : b.name.split('.').pop() ?? '') : b.name
    return (typeof aValue === 'number' && typeof bValue === 'number' ? aValue - bValue : String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' })) * factor
  })
}

/** Самодостаточный проводник по машине: своё состояние, операции — через ops. */
export function FileExplorer({
  agents,
  initialAgentId,
  initialFilePath,
  initialDir,
  ops,
  variant = 'modal',
  onClose,
  onSwitchUtility,
  consoleLabel,
  onOpenMachines
}: FileExplorerProps): JSX.Element {
  const [agentId, setAgentId] = useState<string | null>(
    initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  )
  const [cwd, setCwd] = useState('')
  const [address, setAddress] = useState('')
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  // Состояние чтения каталога: скелетон только пока строк нет (см. lib/loadState.ts).
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState(() => initialFilePath ? nameOf(initialFilePath) : '')
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [uploading, setUploading] = useState<string[]>([])
  const [uploadErrors, setUploadErrors] = useState<Array<{ name: string; error: string }>>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewErrorKind, setPreviewErrorKind] = useState<'read' | 'save'>('read')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  // Текст файла на момент открытия — база для diff «что я поменял» перед сохранением.
  const [previewOriginal, setPreviewOriginal] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  // Последний элемент, отправленный в корзину машины: полоса «Вернуть» под списком.
  const [trashed, setTrashed] = useState<{ name: string; from: string; to: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const selectedRow = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = selectedAgent?.online ?? false
  const writable = agentOnline && (selectedAgent?.policy.allowWrite ?? false)
  // Корзина — только если мост её умеет и агент достаточно новый; иначе прежнее безвозвратное удаление.
  const canTrash = typeof ops.trash === 'function' && isToolAllowed(selectedAgent?.version ?? '0.0.0', 'fs-trash')
  const view = loadView(status, entries.length > 0)
  const visibleEntries = useMemo(
    () => sortEntries(entries.filter((entry) => entry.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())), sortBy, sortDirection),
    [entries, filter, sortBy, sortDirection]
  )
  const crumbs = useMemo(() => breadcrumbs(cwd, root), [cwd, root])
  const atRoot = Boolean(root) && cwd.replace(/[\\/]+$/, '') === root.replace(/[\\/]+$/, '')

  const load = async (path: string): Promise<void> => {
    if (!agentId || !agentOnline) return
    setStatus('loading')
    try {
      const res = await ops.list(agentId, path)
      setRoot(res.root)
      setCwd(res.cwd)
      setAddress(res.cwd)
      setEntries(res.entries ?? [])
      setError(null)
      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  // Путь файла открывает родительскую папку и выделяет нужную строку.
  useEffect(() => {
    setEntries([])
    setSelectedName(initialFilePath ? nameOf(initialFilePath) : '')
    void load(initialDir ? initialDir : initialFilePath ? parentOf(initialFilePath) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, initialFilePath, initialDir])

  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' })
  }, [visibleEntries, selectedName])

  const run = async (op: Promise<unknown>): Promise<void> => {
    try {
      await op
      await load(cwd) // всегда перечитываем текущий каталог
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const uploadFiles = async (files: File[]): Promise<void> => {
    if (!agentId) return
    if (!writable) {
      setUploadErrors(files.map((file) => ({ name: file.name, error: 'Загрузка запрещена политикой этой машины.' })))
      return
    }
    setUploadErrors([])
    setUploading(files.map((file) => file.name))
    const results = await Promise.all(
      files.map(async (file) => {
        try {
          await ops.upload(agentId, cwd, file)
          return null
        } catch (err) {
          return { name: file.name, error: err instanceof Error ? err.message : String(err) }
        }
      })
    )
    setUploading([])
    setUploadErrors(results.filter((result): result is { name: string; error: string } => result !== null))
    await load(cwd)
  }

  const selectRelative = (offset: number): void => {
    if (visibleEntries.length === 0) return
    const index = visibleEntries.findIndex((entry) => entry.name === selectedName)
    setSelectedName(visibleEntries[Math.max(0, Math.min(visibleEntries.length - 1, index + offset))]?.name ?? '')
  }

  const doRename = (entry: FsEntry): void => {
    if (!agentId) return
    const next = window.prompt('Новое имя', entry.name)
    if (next && next !== entry.name) void run(ops.rename(agentId, joinPath(cwd, entry.name), joinPath(cwd, next)))
  }
  const doMkdir = (): void => {
    if (!agentId) return
    const name = window.prompt('Имя новой папки')
    if (name) void run(ops.mkdir(agentId, joinPath(cwd, name)))
  }

  const openFile = async (entry: FsEntry): Promise<void> => {
    if (!agentId) return
    const path = joinPath(cwd, entry.name)
    setEditing(false)
    setConfirmSave(false)
    setPreviewText('')
    setPreviewError(null)
    setPreviewErrorKind('read')
    if (entry.size > PREVIEW_MAX_BYTES) {
      setPreview({ path, name: entry.name, size: entry.size, kind: 'unavailable' })
      return
    }
    setPreviewLoading(true)
    try {
      const result = await ops.read(agentId, path)
      const dataBase64 = result.dataBase64
      if (!dataBase64) throw new Error('машина не вернула содержимое файла')
      const imageType = IMAGE_TYPES[extensionOf(entry.name)]
      if (imageType) {
        setPreview({ path, name: entry.name, size: entry.size, kind: 'image' })
        setPreviewText(`data:${imageType};base64,${dataBase64}`)
      } else {
        const text = decodeUtf8(dataBase64)
        if (text === null) setPreview({ path, name: entry.name, size: entry.size, kind: 'unavailable' })
        else {
          setPreview({ path, name: entry.name, size: entry.size, kind: 'text' })
          setPreviewText(text)
          setPreviewOriginal(text)
          setShowDiff(false)
        }
      }
    } catch (err) {
      setPreview({ path, name: entry.name, size: entry.size, kind: 'unavailable' })
      setPreviewErrorKind('read')
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewLoading(false)
    }
  }

  const savePreview = async (): Promise<void> => {
    if (!agentId || !preview || preview.kind !== 'text' || !writable) return
    setSaving(true)
    setPreviewErrorKind('save')
    setPreviewError(null)
    try {
      await ops.write(agentId, preview.path, encodeUtf8(previewText))
      await load(cwd)
      setPreviewOriginal(previewText)
      setShowDiff(false)
      setEditing(false)
      setConfirmSave(false)
    } catch (err) {
      setPreviewErrorKind('save')
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ToolFrame
      title="Проводник по машине"
      variant={variant}
      onClose={onClose}
      testId={variant === 'modal' ? 'fs-overlay' : 'fs-embed'}
    >
      <MachineUtilityHeader
        agents={agents}
        agentId={agentId}
        onAgentChange={setAgentId}
        kind="explorer"
        consoleLabel={consoleLabel}
        dir={cwd || undefined}
        // Папку берём из прочитанного `cwd`, а не из аргумента открытия: агент мог
        // нормализовать путь, да и пользователь давно ушёл в другой каталог.
        onSwitch={onSwitchUtility && agentId ? (next) => onSwitchUtility(next, agentId, cwd || undefined) : undefined}
        onOpenMachines={onOpenMachines}
      />
      <div className="fsbar">
        <IconButton size="sm" title="Вверх" aria-label="На уровень выше" disabled={!agentOnline || atRoot} onClick={() => void load(parentOf(cwd))}>
          ⬆
        </IconButton>
        <form
          className="fspath-form"
          onSubmit={(e) => {
            e.preventDefault()
            void load(address.trim())
          }}
        >
          <input
            className="fspath"
            aria-label="Адрес папки"
            title="Введите или вставьте путь и нажмите Enter"
            value={address}
            placeholder="Введите путь к папке"
            disabled={!agentOnline}
            onChange={(e) => setAddress(e.target.value)}
          />
        </form>
        {/* Кнопок изменения файлов нет не «просто так»: скажем это на их месте,
            а полное объяснение — в подсказке (тот же текст, что у бейджа шапки). */}
        {agentOnline && !writable && (
          <span className="fsnote" title={READ_ONLY_HINT} data-testid="fs-readonly">
            Только чтение: изменять файлы на этой машине запрещено политикой
          </span>
        )}
        {writable && (
          <>
            <Button size="sm" disabled={!agentId} onClick={doMkdir}>
              ＋ Папка
            </Button>
            <Button size="sm" disabled={!agentId || uploading.length > 0} onClick={() => fileInput.current?.click()}>
              ⬆ Загрузить
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              aria-label="Загрузить файлы"
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length > 0) void uploadFiles(files)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
      {crumbs.length > 0 && (
        <nav className="fscrumbs" aria-label="Путь к папке">
          {crumbs.map((crumb, index) => (
            <span className="fscrumb" key={crumb.path}>
              {index > 0 && <span aria-hidden="true">/</span>}
              <button
                type="button"
                className={crumb.root ? 'fscrumb-link fscrumb-link--root' : 'fscrumb-link'}
                aria-current={crumb.path === cwd ? 'page' : undefined}
                onClick={() => void load(crumb.path)}
              >
                {crumb.root ? `Корень: ${crumb.name}` : crumb.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div className="fscontrols">
        <input
          className="fsfilter"
          aria-label="Фильтр по имени"
          placeholder="Фильтр по имени"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="fssort-label">
          Сортировка
          <select aria-label="Сортировать по" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="name">Имя</option>
            <option value="size">Размер</option>
            <option value="type">Тип</option>
          </select>
        </label>
        <IconButton
          size="sm"
          title={sortDirection === 'asc' ? 'По возрастанию' : 'По убыванию'}
          aria-label={sortDirection === 'asc' ? 'Сортировка по возрастанию' : 'Сортировка по убыванию'}
          onClick={() => setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')}
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </IconButton>
      </div>
      {uploading.length > 0 && <p className="fsuploading" role="status">Загружаем: {uploading.join(', ')}</p>}
      {uploadErrors.length > 0 && (
        <ul className="fsupload-errors" role="alert">
          {uploadErrors.map(({ name, error }, index) => <li key={`${name}-${index}`}>{name}: {error}</li>)}
        </ul>
      )}
      {view.staleError && (
        <ErrorState
          compact
          className="fserror"
          message="Последнее действие не удалось"
          detail={error}
          onRetry={() => void load(cwd)}
        />
      )}
      {(preview || previewLoading || previewError) && (
        <section className="fspreview" aria-label="Предпросмотр файла">
          <div className="fspreview-head">
            <strong>{preview?.name ?? 'Предпросмотр файла'}</strong>
            {preview && <span className="fssize">{fmtSize(preview.size)}</span>}
            <IconButton size="sm" title="Закрыть предпросмотр" aria-label="Закрыть предпросмотр" onClick={() => { setPreview(null); setPreviewError(null); setEditing(false); setConfirmSave(false) }}>×</IconButton>
          </div>
          {previewLoading && <p role="status">Читаем файл…</p>}
          {previewError && (
            <ErrorState
              compact
              message={previewErrorKind === 'save' ? 'Не удалось сохранить файл' : 'Не удалось прочитать файл'}
              detail={previewError}
              onRetry={() => {
                if (previewErrorKind === 'save') void savePreview()
                else if (preview) void openFile({ name: preview.name, kind: 'file', size: preview.size, mtime: 0 })
              }}
            />
          )}
          {!previewLoading && !previewError && preview?.kind === 'image' && <img className="fspreview-image" src={previewText} alt={`Предпросмотр ${preview.name}`} />}
          {!previewLoading && !previewError && preview?.kind === 'unavailable' && (
            <div className="fspreview-unavailable">
              <p>{preview.size > PREVIEW_MAX_BYTES ? `Файл больше ${fmtSize(PREVIEW_MAX_BYTES)}; предпросмотр не загружается.` : 'Предпросмотр недоступен: файл не является текстом UTF-8 или поддерживаемой картинкой.'}</p>
              <Button size="sm" onClick={() => agentId && void ops.download(agentId, preview.path, preview.name)}>⬇ Скачать</Button>
            </div>
          )}
          {!previewLoading && !previewError && preview?.kind === 'text' && (
            <>
              {editing
                ? (showDiff
                  ? <div className="fspreview-editor" data-testid="fs-diff"><CodeDiff path={preview.path} original={previewOriginal} modified={previewText} /></div>
                  : <div className="fspreview-editor"><CodeEditor path={preview.path} value={previewText} onChange={setPreviewText} ariaLabel="Содержимое файла" onSave={() => setConfirmSave(true)} /></div>)
                : <pre className="fspreview-text">{previewText}</pre>}
              {writable ? (
                <div className="fspreview-actions">
                  {editing && previewText !== previewOriginal && <Button size="sm" onClick={() => setShowDiff((v) => !v)}>{showDiff ? 'Скрыть изменения' : 'Показать изменения'}</Button>}
                  {editing ? (
                    confirmSave ? <><Button size="sm" disabled={saving} onClick={() => void savePreview()}>{saving ? 'Сохраняем…' : 'Подтвердить сохранение'}</Button><Button size="sm" disabled={saving} onClick={() => setConfirmSave(false)}>Отмена</Button></> : <Button size="sm" onClick={() => setConfirmSave(true)}>Сохранить</Button>
                  ) : <Button size="sm" onClick={() => setEditing(true)}>Редактировать</Button>}
                </div>
              ) : <p className="fsnote">Правка недоступна: изменять файлы на этой машине запрещено политикой.</p>}
            </>
          )}
        </section>
      )}
      {trashed && (
        <p className="fstrashed" role="status" data-testid="fs-trashed">
          «{trashed.name}» перемещён в корзину машины ({nameOf(parentOf(trashed.to))}).
          <Button size="sm" onClick={() => { const t = trashed; setTrashed(null); if (agentId) void run(ops.rename(agentId, t.to, t.from)) }}>Вернуть</Button>
          <IconButton size="sm" title="Скрыть" aria-label="Скрыть уведомление о корзине" onClick={() => setTrashed(null)}>×</IconButton>
        </p>
      )}
      <div
        className={uploading.length > 0 ? 'fslist fslist--uploading' : 'fslist'}
        data-testid="fs-list"
        tabIndex={0}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const files = Array.from(event.dataTransfer.files)
          if (files.length > 0) void uploadFiles(files)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            selectRelative(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            selectRelative(-1)
          } else if (event.key === 'Backspace' && !atRoot) {
            event.preventDefault()
            void load(parentOf(cwd))
          } else if (event.key === 'Enter') {
            const entry = visibleEntries.find((candidate) => candidate.name === selectedName)
            if (!entry || !agentId) return
            event.preventDefault()
            const path = joinPath(cwd, entry.name)
            if (entry.kind === 'dir') void load(path)
            else void openFile(entry)
          }
        }}
      >
        {agents.length === 0 && (
          <EmptyState
            icon="💻"
            title="Нет машин — добавьте первую"
            description="Машина подключается в настройках: там выдаётся команда установки агента."
          />
        )}
        {agentId && !agentOnline && (
          <EmptyState
            icon="⏳"
            title={'Машина «' + (selectedAgent?.name ?? agentId) + '» переподключается'}
            description="Проводник станет доступен после восстановления соединения. Попробуйте снова через несколько секунд."
          />
        )}
        {agentOnline && view.state === 'skeleton' && (
          <div className="fsskel" aria-busy="true">
            {/* Высота косточки — высота .fsrow, иначе список подпрыгивает. */}
            <Skeleton variant="list" item="block" count={8} height={30} gap={4} testId="fs-skeleton" />
          </div>
        )}
        {agentId && view.state === 'error' && (
          <ErrorState
            message="Не удалось прочитать папку"
            detail={error}
            onRetry={() => void load(address.trim() || cwd)}
          />
        )}
        {agentId && view.state === 'empty' && (
          <EmptyState
            icon="📁"
            title="Папка пуста"
            description={writable ? 'Создайте папку или загрузите файл кнопками выше.' : 'Ни файлов, ни папок — поднимитесь на уровень выше кнопкой ⬆.'}
          />
        )}
        {agentId && view.state === 'data' && visibleEntries.length === 0 && (
          <EmptyState
            icon="🔎"
            title="Ничего не найдено"
            description="Измените фильтр по имени, чтобы снова увидеть файлы и папки."
          />
        )}
        {view.refreshing && (
          <p className="fsrefresh">
            <RefreshIndicator label="Читаем папку…" />
          </p>
        )}
        <div role="list">
        {visibleEntries.map((entry) => {
          const abs = joinPath(cwd, entry.name)
          return (
            <div
              ref={entry.name === selectedName ? selectedRow : undefined}
              className={entry.name === selectedName ? 'fsrow fsrow--selected' : 'fsrow'}
              key={entry.name}
              role="listitem"
              data-testid="fs-row"
              data-selected={entry.name === selectedName ? 'true' : undefined}
              aria-current={entry.name === selectedName ? 'true' : undefined}
              onClick={() => setSelectedName(entry.name)}
            >
              <button
                className="fsname"
                onClick={() => {
                  setSelectedName(entry.name)
                  if (entry.kind === 'dir') void load(abs)
                  else void openFile(entry)
                }}
              >
                {entry.kind === 'dir' ? '📁' : '📄'} {entry.name}
              </button>
              <span className="fssize">{entry.kind === 'file' ? fmtSize(entry.size) : ''}</span>
              <span className="fsrow-actions">
                {entry.kind === 'file' && (
                  <IconButton
                    size="sm"
                    title="Скачать"
                    aria-label={`Скачать ${entry.name}`}
                    onClick={() => agentId && void ops.download(agentId, abs, entry.name)}
                  >
                    ⬇
                  </IconButton>
                )}
                {writable && (
                  <IconButton size="sm" title="Переименовать" aria-label={`Переименовать ${entry.name}`} onClick={() => doRename(entry)}>
                    ✎
                  </IconButton>
                )}
                {writable &&
                  (confirmDel === abs ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setConfirmDel(null)
                          if (!agentId) return
                          if (canTrash) {
                            void run(ops.trash!(agentId, abs).then((result) => {
                              if (result.trashedPath) setTrashed({ name: entry.name, from: abs, to: result.trashedPath })
                            }))
                          } else void run(ops.remove(agentId, abs))
                        }}
                      >
                        {canTrash ? 'В корзину' : 'Удалить'}
                      </Button>
                      <Button size="sm" onClick={() => setConfirmDel(null)}>
                        Отмена
                      </Button>
                    </>
                  ) : (
                    <IconButton size="sm" title="Удалить" aria-label={`Удалить ${entry.name}`} onClick={() => setConfirmDel(abs)}>
                      🗑
                    </IconButton>
                  ))}
              </span>
            </div>
          )
        })}
        </div>
      </div>
      {root && <p className="fsroot">Корень: {root}</p>}
    </ToolFrame>
  )
}
