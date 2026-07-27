import { useEffect, useRef, useState } from 'react'
import type { AgentInfo, FsEntry } from '@shared/agentProtocol'
import type { MachineOps, UtilityVariant } from './machine'
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
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState(() => initialFilePath ? nameOf(initialFilePath) : '')
  const selectedRow = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const writable = agents.find((a) => a.id === agentId)?.policy.allowWrite ?? false

  const load = async (path: string): Promise<void> => {
    if (!agentId) return
    try {
      const res = await ops.list(agentId, path)
      setRoot(res.root)
      setCwd(res.cwd)
      setEntries(res.entries ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        <button className="fsbtn" title="Вверх" disabled={!agentId} onClick={() => void load(parentOf(cwd))}>
          ⬆
        </button>
        <span className="fspath" title={cwd}>
          {cwd || '—'}
        </span>
        {onOpenTerminal && agentId && cwd && (
          <button className="fsbtn" title="Открыть терминал в этой папке" onClick={() => onOpenTerminal(agentId, cwd)}>
            &gt;_ Терминал
          </button>
        )}
        {writable && (
          <>
            <button className="fsbtn" disabled={!agentId} onClick={doMkdir}>
              ＋ Папка
            </button>
            <button className="fsbtn" disabled={!agentId} onClick={() => fileInput.current?.click()}>
              ⬆ Загрузить
            </button>
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
      {error && (
        <p className="fserror" role="alert">
          {error}
        </p>
      )}
      <div className="fslist" data-testid="fs-list">
        {agents.length === 0 && <p className="cc-empty">Нет машин. Добавьте машину в настройках.</p>}
        {agentId && entries.length === 0 && !error && <p className="cc-empty">Пусто</p>}
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
                  <button
                    className="msgbtn"
                    title="Скачать"
                    onClick={() => agentId && void ops.download(agentId, abs, entry.name)}
                  >
                    ⬇
                  </button>
                )}
                {writable && (
                  <button className="msgbtn" title="Переименовать" onClick={() => doRename(entry)}>
                    ✎
                  </button>
                )}
                {writable &&
                  (confirmDel === abs ? (
                    <>
                      <button
                        className="delyes"
                        onClick={() => {
                          setConfirmDel(null)
                          if (agentId) void run(ops.remove(agentId, abs))
                        }}
                      >
                        Удалить
                      </button>
                      <button className="delno" onClick={() => setConfirmDel(null)}>
                        Отмена
                      </button>
                    </>
                  ) : (
                    <button className="msgbtn" title="Удалить" onClick={() => setConfirmDel(abs)}>
                      🗑
                    </button>
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
