// Диагностическая консоль рана (US-6): полноэкранная панель. Просмотр лога с
// поиском/копированием, read-only по умолчанию (сервер режет запись по белому
// списку), режим редактирования — переключатель с постоянным индикатором и
// авто-возвратом в read-only по таймеру. Выполнение — через window.ci.consoleExec.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { CiLogLine } from '@shared/ci'
import { copyText } from '@voicechat/ui-foundation/lib/clipboard'
import { Button } from '@voicechat/ui-kit'
import { Dialog, useConfirm, useToast } from '@voicechat/ui-kit'
import { AnsiText } from './AnsiText'
import { stripAnsi } from '@shared/ansi'

const EDIT_LIMIT_MS = 5 * 60 * 1000

export function isDangerousConsoleCommand(command: string): boolean {
  return /\brm\s+(?:[^;&|]*\s)?-[a-z]*[rf][a-z]*/i.test(command)
    || /\brm\s+[^;&|]*--(?:recursive|force)/i.test(command)
    || /\bgit\s+[^;&|]*reset\s+[^;&|]*--hard\b/i.test(command)
}

export function CiConsole(props: { runId: string; onClose: () => void }): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const historyIndex = useRef(-1)
  const draft = useRef('')
  const [paths, setPaths] = useState<string[]>([])
  const completionVersion = useRef(0)
  const [log, setLog] = useState<CiLogLine[]>([])
  const [search, setSearch] = useState('')
  const [cmd, setCmd] = useState('')
  const [edit, setEdit] = useState(false)
  const [out, setOut] = useState<Array<{ cmd: string; text: string; rejected: boolean }>>([])
  const outRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLog([]); setOut([]); setCmd(''); setHistory([]); setPaths([])
    try {
      const saved = JSON.parse(sessionStorage.getItem(`ci-console-history:${props.runId}`) ?? '[]')
      if (Array.isArray(saved)) setHistory(saved.filter((item): item is string => typeof item === 'string').slice(0, 100))
    } catch { /* History is optional when storage is unavailable. */ }
    void window.ci?.getRunLog(props.runId).then(setLog).catch((error) => toast.error(String(error)))
  }, [props.runId])
  // Авто-возврат в read-only: сессия редактирования ограничена по времени.
  useEffect(() => {
    if (!edit) return
    const t = setTimeout(() => setEdit(false), EDIT_LIMIT_MS)
    return () => clearTimeout(t)
  }, [edit])
  useEffect(() => { outRef.current?.scrollTo(0, outRef.current.scrollHeight) }, [out])

  // Поиск и копирование работают по видимому тексту: строка `Test Files` в
  // логе vitest на самом деле начинается с `ESC[33m`, и подстрока, попавшая на
  // границу последовательности, не находилась.
  const filtered = search ? log.filter((l) => stripAnsi(l.chunk).includes(search)) : log
  const logText = (): string => log.map((l) => stripAnsi(l.chunk)).join('')
  // Кнопка «Копировать лог» ничем себя не выдавала — ни успехом, ни отказом.
  const copy = (): void => {
    void copyText(logText()).then((ok) => (ok ? toast.success('Скопировано') : toast.error('Не удалось скопировать лог')))
  }
  const exec = async (): Promise<void> => {
    const c = cmd.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      if (isDangerousConsoleCommand(c) && !(await confirm({
        title: 'Выполнить опасную команду?',
        message: `Команда может удалить файлы или несохранённые изменения:\n${c}`,
        variant: 'danger', confirmLabel: 'Выполнить команду'
      }))) return
      setCmd(''); setPaths([]); historyIndex.current = -1
      const nextHistory = [c, ...history.filter((item) => item !== c)].slice(0, 100)
      setHistory(nextHistory)
      try { sessionStorage.setItem(`ci-console-history:${props.runId}`, JSON.stringify(nextHistory)) }
      catch { /* Executing a command must not depend on browser storage. */ }
      const r = await window.ci?.consoleExec(props.runId, c, edit)
      setOut((o) => [...o, { cmd: c, text: r ? (r.rejected ? r.message : r.output || r.message || `[код ${r.exitCode ?? '?'}]`) : 'нет моста', rejected: r?.rejected ?? false }])
    } catch (error) { toast.error(String(error)) }
    finally { setBusy(false) }
  }

  const complete = async (): Promise<void> => {
    const token = cmd.split(/\s+/).at(-1) ?? ''
    const slash = token.lastIndexOf('/')
    const directory = slash < 0 ? './' : token.slice(0, slash + 1)
    const prefix = token.slice(slash + 1)
    // Only a conservative path alphabet reaches the read-only shell command.
    if (!/^[\w./-]*$/.test(token) || directory.startsWith('-')) return
    const version = ++completionVersion.current
    try {
      const result = await window.ci?.consoleExec(props.runId, `ls -1p '${directory}'`, false)
      if (version !== completionVersion.current) return
      if (!result || result.rejected || result.exitCode !== 0) { toast.error(result?.message || 'Не удалось прочитать пути'); return }
      const options = result.output.split('\n').filter((item) => item.startsWith(prefix) && /^[\w./-]+$/.test(item)).map((item) => (slash < 0 ? '' : directory) + item)
      setPaths(options)
      if (options.length === 1) setCmd(cmd.slice(0, cmd.length - token.length) + options[0])
    } catch (error) { toast.error(String(error)) }
  }

  return (
    <Dialog title="Консоль рана" onClose={props.onClose} className="ci-console-dialog">
    <div className="ci-console" data-testid="ci-console">
      <div className="ci-console-head">
        <span className="ci-console-title">Консоль рана</span>
        <span className={`lozenge ${edit ? 'lozenge-removed' : 'lozenge-neutral'}`}>{edit ? 'режим редактирования' : 'только чтение'}</span>
        <input className="login-input ci-console-search" aria-label="Поиск в консоли" placeholder="Поиск по логу" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button onClick={copy}>Копировать лог</Button>
        <Button onClick={() => setEdit((v) => !v)}>{edit ? 'Выйти из редактирования' : 'Режим редактирования'}</Button>
        <Button onClick={props.onClose}>Закрыть</Button>
      </div>
      <pre className="ci-console-log"><AnsiText>{filtered.map((l) => l.chunk).join('')}</AnsiText></pre>
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
        <input className="login-input" value={cmd} disabled={busy} onChange={(e) => { setCmd(e.target.value); setPaths([]); completionVersion.current++; historyIndex.current = -1 }} onKeyDown={(event) => {
          if (event.key === 'Tab' && !event.shiftKey && cmd) { event.preventDefault(); void complete() }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (historyIndex.current === -1) draft.current = cmd
            historyIndex.current = Math.max(-1, Math.min(history.length - 1, historyIndex.current + (event.key === 'ArrowUp' ? 1 : -1)))
            setCmd(historyIndex.current < 0 ? draft.current : history[historyIndex.current])
          }
        }} placeholder={edit ? 'команда (режим редактирования)' : 'ls, cat, git status…'} aria-label="Команда консоли" />
        <Button type="button" disabled={busy} onClick={() => void complete()}>Дополнить путь</Button>
        <Button type="submit" loading={busy}>Выполнить</Button>
      </form>
      {paths.length > 1 && <div role="group" aria-label="Подсказки путей">{paths.map((path) => <Button key={path} onClick={() => { setCmd(cmd.replace(/\S*$/, path)); setPaths([]) }}>{path}</Button>)}</div>}
      <details><summary>История команд ({history.length})</summary>{history.map((command) => <Button key={command} onClick={() => setCmd(command)}>{command}</Button>)}</details>
    </div>
    </Dialog>
  )
}
