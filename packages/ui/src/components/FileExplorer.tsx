import { useRef, useState, type MouseEvent } from 'react'
import type { FsEntry } from '@shared/agentProtocol'
import type { AgentInfo } from '@shared/agentProtocol'

export interface FileExplorerProps {
  /** Машины пользователя (для выбора цели проводника). */
  agents: AgentInfo[]
  agentId: string | null
  root: string
  cwd: string
  entries: FsEntry[]
  error: string | null
  /** Разрешены ли изменения (из политики выбранной машины). */
  writable: boolean
  onSelectAgent: (id: string) => void
  onNavigate: (path: string) => void
  onDownload: (path: string, name: string) => void
  onUpload: (file: File) => void
  onDelete: (path: string) => void
  onRename: (from: string, to: string) => void
  onMkdir: (name: string) => void
  onClose: () => void
}

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} МБ`
  if (n >= 1000) return `${Math.round(n / 1000)} КБ`
  return `${n} Б`
}

/** Родительский каталог абсолютного пути (posix). */
function parentOf(p: string): string {
  const up = p.replace(/\/+$/, '').replace(/\/[^/]*$/, '')
  return up || '/'
}
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, '')}/${name}`
}

export function FileExplorer({
  agents,
  agentId,
  root,
  cwd,
  entries,
  error,
  writable,
  onSelectAgent,
  onNavigate,
  onDownload,
  onUpload,
  onDelete,
  onRename,
  onMkdir,
  onClose
}: FileExplorerProps): JSX.Element {
  const stop = (e: MouseEvent): void => e.stopPropagation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const doRename = (entry: FsEntry): void => {
    const next = window.prompt('Новое имя', entry.name)
    if (next && next !== entry.name) onRename(joinPath(cwd, entry.name), joinPath(cwd, next))
  }
  const doMkdir = (): void => {
    const name = window.prompt('Имя новой папки')
    if (name) onMkdir(name)
  }

  return (
    <div className="ovl" onClick={onClose} data-testid="fs-overlay">
      <div className="ccobs" onClick={stop} role="dialog" aria-label="Проводник по машине">
        <div className="mdhead">
          <h2 className="mdh">Проводник по машине</h2>
          <button className="xbtn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="fsbar">
          {agents.length > 1 && (
            <select
              className="sel"
              aria-label="Машина"
              value={agentId ?? ''}
              onChange={(e) => onSelectAgent(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.online}>
                  💻 {a.name}
                  {a.online ? '' : ' (офлайн)'}
                </option>
              ))}
            </select>
          )}
          <button
            className="fsbtn"
            aria-label="Вверх"
            title="Вверх"
            disabled={!agentId}
            onClick={() => onNavigate(parentOf(cwd))}
          >
            ⬆
          </button>
          <span className="fspath" title={cwd}>
            {cwd || '—'}
          </span>
          {writable && (
            <>
              <button className="fsbtn" onClick={doMkdir} disabled={!agentId}>
                ＋ Папка
              </button>
              <button className="fsbtn" onClick={() => fileInput.current?.click()} disabled={!agentId}>
                ⬆ Загрузить
              </button>
              <input
                ref={fileInput}
                type="file"
                aria-label="Загрузить файл"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
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
          {agentId && entries.length === 0 && <p className="cc-empty">Пусто</p>}
          {entries.map((entry) => {
            const abs = joinPath(cwd, entry.name)
            return (
              <div className="fsrow" key={entry.name} data-testid="fs-row">
                <button
                  className="fsname"
                  onClick={() => entry.kind === 'dir' && onNavigate(abs)}
                  disabled={entry.kind !== 'dir'}
                  title={entry.kind === 'dir' ? 'Открыть папку' : entry.name}
                >
                  {entry.kind === 'dir' ? '📁' : '📄'} {entry.name}
                </button>
                <span className="fssize">{entry.kind === 'file' ? fmtSize(entry.size) : ''}</span>
                <span className="fsrow-actions">
                  {entry.kind === 'file' && (
                    <button className="msgbtn" title="Скачать" onClick={() => onDownload(abs, entry.name)}>
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
                            onDelete(abs)
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
      </div>
    </div>
  )
}
