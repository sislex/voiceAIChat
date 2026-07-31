import { useEffect, useRef, useState } from 'react'
import type { AgentInfo, FsEntry } from '@shared/agentProtocol'
import type { MachineOps, UtilityVariant } from './machine'
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
  onOpenTerminal?: (agentId: string, cwd: string) => void
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

/** Самодостаточный проводник по машине: своё состояние, операции — через ops. */
export function FileExplorer({
  agents,
  initialAgentId,
  initialFilePath,
  initialDir,
  ops,
  variant = 'modal',
  onClose,
  onOpenTerminal
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
  const selectedRow = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const writable = agents.find((a) => a.id === agentId)?.policy.allowWrite ?? false
  const view = loadView(status, entries.length > 0)

  const load = async (path: string): Promise<void> => {
    if (!agentId) return
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
  }, [entries, selectedName])

  const run = async (op: Promise<unknown>): Promise<void> => {
    try {
      await op
      await load(cwd) // всегда перечитываем текущий каталог
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
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
      <div className="fsbar">
        {agents.length > 1 && (
          <select
            className="sel"
            aria-label="Машина"
            value={agentId ?? ''}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.online}>
                💻 {a.name}
                {a.online ? '' : ' (офлайн)'}
              </option>
            ))}
          </select>
        )}
        <IconButton size="sm" title="Вверх" aria-label="На уровень выше" disabled={!agentId} onClick={() => void load(parentOf(cwd))}>
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
            disabled={!agentId}
            onChange={(e) => setAddress(e.target.value)}
          />
        </form>
        {onOpenTerminal && agentId && cwd && (
          <Button size="sm" title="Открыть терминал в этой папке" onClick={() => onOpenTerminal(agentId, cwd)}>
            &gt;_ Терминал
          </Button>
        )}
        {writable && (
          <>
            <Button size="sm" disabled={!agentId} onClick={doMkdir}>
              ＋ Папка
            </Button>
            <Button size="sm" disabled={!agentId} onClick={() => fileInput.current?.click()}>
              ⬆ Загрузить
            </Button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Загрузить файл"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f && agentId) void run(ops.upload(agentId, cwd, f))
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
      {view.staleError && (
        <ErrorState
          compact
          className="fserror"
          message="Последнее действие не удалось"
          detail={error}
          onRetry={() => void load(cwd)}
        />
      )}
      <div className="fslist" data-testid="fs-list">
        {agents.length === 0 && (
          <EmptyState
            icon="💻"
            title="Нет машин — добавьте первую"
            description="Машина подключается в настройках: там выдаётся команда установки агента."
          />
        )}
        {agentId && view.state === 'skeleton' && (
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
        {view.refreshing && (
          <p className="fsrefresh">
            <RefreshIndicator label="Читаем папку…" />
          </p>
        )}
        {entries.map((entry) => {
          const abs = joinPath(cwd, entry.name)
          return (
            <div
              ref={entry.name === selectedName ? selectedRow : undefined}
              className={entry.name === selectedName ? 'fsrow fsrow--selected' : 'fsrow'}
              key={entry.name}
              data-testid="fs-row"
              data-selected={entry.name === selectedName ? 'true' : undefined}
            >
              <button
                className="fsname"
                disabled={entry.kind !== 'dir'}
                onClick={() => entry.kind === 'dir' && void load(abs)}
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
      {root && <p className="fsroot">Корень: {root}</p>}
    </ToolFrame>
  )
}
