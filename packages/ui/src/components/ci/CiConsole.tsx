// Диагностическая консоль рана (US-6): полноэкранная панель. Просмотр лога с
// поиском/копированием, read-only по умолчанию (сервер режет запись по белому
// списку), режим редактирования — переключатель с постоянным индикатором и
// авто-возвратом в read-only по таймеру. Выполнение — через window.ci.consoleExec.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { CiLogLine } from '@shared/ci'

const EDIT_LIMIT_MS = 5 * 60 * 1000

export function CiConsole(props: { runId: string; onClose: () => void }): JSX.Element {
  const [log, setLog] = useState<CiLogLine[]>([])
  const [search, setSearch] = useState('')
  const [cmd, setCmd] = useState('')
  const [edit, setEdit] = useState(false)
  const [out, setOut] = useState<Array<{ cmd: string; text: string; rejected: boolean }>>([])
  const outRef = useRef<HTMLDivElement>(null)

  useEffect(() => { void window.ci?.getRunLog(props.runId).then(setLog) }, [props.runId])
  // Авто-возврат в read-only: сессия редактирования ограничена по времени.
  useEffect(() => {
    if (!edit) return
    const t = setTimeout(() => setEdit(false), EDIT_LIMIT_MS)
    return () => clearTimeout(t)
  }, [edit])
  useEffect(() => { outRef.current?.scrollTo(0, outRef.current.scrollHeight) }, [out])

  const filtered = search ? log.filter((l) => l.chunk.includes(search)) : log
  const logText = (): string => log.map((l) => l.chunk).join('')
  const copy = (): void => { void navigator.clipboard?.writeText(logText()) }
  const exec = async (): Promise<void> => {
    const c = cmd.trim()
    if (!c) return
    setCmd('')
    const r = await window.ci?.consoleExec(props.runId, c, edit)
    setOut((o) => [...o, { cmd: c, text: r ? (r.rejected ? r.message : r.output || `[код ${r.exitCode ?? '?'}]`) : 'нет моста', rejected: r?.rejected ?? false }])
  }

  return (
    <div className="ci-console" data-testid="ci-console">
      <div className="ci-console-head">
        <span className="ci-console-title">Консоль рана</span>
        <span className={`lozenge ${edit ? 'lozenge-removed' : 'lozenge-neutral'}`}>{edit ? 'режим редактирования' : 'только чтение'}</span>
        <input className="login-input ci-console-search" placeholder="Поиск по логу" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="ci-btn" onClick={copy}>Копировать лог</button>
        <button className="ci-btn" onClick={() => setEdit((v) => !v)}>{edit ? 'Выйти из редактирования' : 'Режим редактирования'}</button>
        <button className="ci-btn" onClick={props.onClose}>Закрыть</button>
      </div>
      <pre className="ci-console-log">{filtered.map((l) => l.chunk).join('')}</pre>
      <div className="ci-console-out" ref={outRef}>
        {out.map((o, i) => (
          <div key={i} className={`ci-console-entry${o.rejected ? ' rejected' : ''}`}>
            <div className="ci-console-cmd">$ {o.cmd}</div>
            <pre>{o.text}</pre>
          </div>
        ))}
      </div>
      <form className="ci-console-input" onSubmit={(e) => { e.preventDefault(); void exec() }}>
        <span className="ci-console-prompt">$</span>
        <input className="login-input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={edit ? 'команда (режим редактирования)' : 'ls, cat, git status…'} aria-label="Команда консоли" />
        <button type="submit" className="ci-btn">Выполнить</button>
      </form>
    </div>
  )
}
