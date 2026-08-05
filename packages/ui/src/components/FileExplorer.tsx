import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentInfo, FsEntry } from '@shared/agentProtocol'
import type { MachineOps, SwitchUtility, UtilityVariant } from './machine'
import { MachineUtilityHeader, READ_ONLY_HINT } from './MachineUtilityHeader'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Skeleton, RefreshIndicator } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { ErrorState } from './ui/ErrorState'
import { loadView, type LoadStatus } from '../lib/loadState'
import { ToolFrame } from './ToolFrame'

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
  const selectedRow = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = selectedAgent?.online ?? false
  const writable = agentOnline && (selectedAgent?.policy.allowWrite ?? false)
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
            else void ops.download(agentId, path, entry.name)
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
                  else if (agentId) void ops.download(agentId, abs, entry.name)
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
                          if (agentId) void run(ops.remove(agentId, abs))
                        }}
                      >
                        Удалить
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
