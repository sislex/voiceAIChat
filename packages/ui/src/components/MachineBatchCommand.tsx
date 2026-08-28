// Групповая команда (machines-roadmap п.15): одна команда на несколько машин и сводная таблица результатов.
// Транспорт — через колбэк родителя (`agents:execBatch`); компонент только выбирает машины и показывает сводку.
import { useState } from 'react'
import type { AgentInfo, BatchExecResult } from '@shared/agentProtocol'
import { Button } from '@voicechat/ui-kit'

export interface MachineBatchCommandProps {
  agents: AgentInfo[]
  /** Выполнить команду на выбранных машинах; ошибка (403 политики и т.п.) пробрасывается исключением. */
  onRun: (machineIds: string[], command: string) => Promise<BatchExecResult>
}

export function MachineBatchCommand({ agents, onRun }: MachineBatchCommandProps): JSX.Element {
  const online = agents.filter((a) => a.online)
  const [selected, setSelected] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BatchExecResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openOutput, setOpenOutput] = useState<string | null>(null)

  const toggle = (id: string): void => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const run = async (): Promise<void> => {
    const cmd = command.trim()
    if (!cmd || selected.length === 0) return
    setRunning(true)
    setError(null)
    try { setResult(await onRun(selected, cmd)) } catch (err) { setError(err instanceof Error ? err.message : String(err)); setResult(null) } finally { setRunning(false) }
  }

  return (
    <section className="mbatch" aria-label="Групповая команда" data-testid="machine-batch">
      <h3 className="mbatch-h">Групповая команда</h3>
      {online.length === 0
        ? <p className="mbatch-note">Нет машин в сети — групповой запуск недоступен.</p>
        : <>
            <div className="mbatch-machines">
              {online.map((a) => (
                <label key={a.id} className="mbatch-machine">
                  <input type="checkbox" aria-label={`Машина ${a.name}`} checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
                  {a.name}
                </label>
              ))}
              <Button size="sm" onClick={() => setSelected(selected.length === online.length ? [] : online.map((a) => a.id))}>
                {selected.length === online.length ? 'Снять все' : 'Выбрать все'}
              </Button>
            </div>
            <form className="mbatch-form" onSubmit={(e) => { e.preventDefault(); void run() }}>
              <input aria-label="Команда для группы машин" placeholder="uptime" value={command} onChange={(e) => setCommand(e.target.value)} />
              <Button size="sm" variant="primary" type="submit" disabled={running || !command.trim() || selected.length === 0}>
                {running ? 'Выполняем…' : `Выполнить на ${selected.length}`}
              </Button>
            </form>
          </>}
      {error && <p className="mbatch-err" role="alert">{error}</p>}
      {result && (
        <>
          <p className="mbatch-note" role="status">
            <code>{result.command}</code>: успешно {result.totals.ok}, с ошибкой {result.totals.failed}, не выполнено {result.totals.skipped} из {result.totals.requested}
          </p>
          <table className="mbatch-table" data-testid="machine-batch-results">
            <thead><tr><th>Машина</th><th>Код</th><th>Длительность</th><th>Вывод</th></tr></thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.machineId} className={!item.ran || item.exitCode !== 0 || item.timedOut ? 'mbatch-row mbatch-row--bad' : 'mbatch-row'} data-testid={`batch-row-${item.machineId}`}>
                  <td>{item.machineName}</td>
                  <td>{!item.ran ? '—' : item.timedOut ? 'таймаут' : item.exitCode ?? '—'}</td>
                  <td>{item.durationMs >= 1000 ? `${(item.durationMs / 1000).toFixed(1)} с` : `${item.durationMs} мс`}</td>
                  <td>
                    {item.error
                      ? <span role="alert">{item.error}</span>
                      : <>
                          <button type="button" className="mbatch-link" aria-expanded={openOutput === item.machineId} onClick={() => setOpenOutput((cur) => (cur === item.machineId ? null : item.machineId))}>
                            {openOutput === item.machineId ? 'скрыть' : 'показать'}
                          </button>
                          {openOutput === item.machineId && <pre className="mbatch-out">{item.output.trim() || '(пусто)'}</pre>}
                        </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
