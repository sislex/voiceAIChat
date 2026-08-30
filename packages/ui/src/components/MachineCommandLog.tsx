// Журнал команд машины (machines-roadmap п.4): кто/когда/что выполнял, код выхода, длительность.
// Данные приходят через колбэк — компонент транспорт-нейтрален; экспорт CSV собирается на клиенте
// из загруженных записей, чтобы не зависеть от REST-пути и заголовков авторизации.
import { useEffect, useState } from 'react'
import type { MachineCommandRecord, MachineCommandSource } from '@shared/agentProtocol'
import { Button } from '@voicechat/ui-kit'
import { saveTextFile } from '../lib/saveFile'

export interface MachineCommandLogProps {
  machineId: string
  machineName: string
  load: (filter: { q?: string; source?: MachineCommandSource; limit?: number }) => Promise<MachineCommandRecord[]>
  /** Открыть чат, из которого модель выполнила команду. */
  onOpenConversation?: (conversationId: string) => void
}

const SOURCE_LABEL: Record<MachineCommandSource, string> = { console: 'консоль', chat: 'чат', system: 'система' }

export function commandsToCsv(rows: MachineCommandRecord[]): string {
  const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = ['startedAt,user,source,command,exitCode,timedOut,durationMs,conversationId,error']
  for (const r of rows) lines.push([new Date(r.startedAt).toISOString(), r.userId, r.source, r.command, r.exitCode ?? '', r.timedOut, r.durationMs, r.conversationId ?? '', r.error ?? ''].map(cell).join(','))
  return lines.join('\n') + '\n'
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`
}

export function MachineCommandLog({ machineId, machineName, load, onOpenConversation }: MachineCommandLogProps): JSX.Element {
  const [q, setQ] = useState('')
  const [source, setSource] = useState<MachineCommandSource | ''>('')
  const [rows, setRows] = useState<MachineCommandRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    const timer = setTimeout(() => {
      load({ q: q.trim() || undefined, source: source || undefined, limit: 200 })
        .then((next) => { if (!cancelled) setRows(next) })
        .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [machineId, q, source, load])

  const exportCsv = (): void => {
    if (!rows?.length) return
    saveTextFile(`commands-${machineName}.csv`, commandsToCsv(rows))
  }

  return (
    <section className="mcmdlog" aria-label={`Журнал команд ${machineName}`} data-testid="machine-command-log">
      <div className="mcmdlog-toolbar">
        <input aria-label="Поиск по команде" placeholder="Поиск по команде" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Источник команды" value={source} onChange={(e) => setSource(e.target.value as MachineCommandSource | '')}>
          <option value="">Все источники</option>
          <option value="console">Консоль</option>
          <option value="chat">Чат (модель)</option>
          <option value="system">Система</option>
        </select>
        <Button size="sm" onClick={exportCsv} disabled={!rows?.length}>Экспорт CSV</Button>
        {rows && <span className="mcmdlog-count">{rows.length} записей</span>}
      </div>
      {error && <p role="alert" className="mcmdlog-error">Не удалось загрузить журнал: {error}</p>}
      {rows && rows.length === 0 && !error && <p className="mcmdlog-empty">Команд пока не было.</p>}
      {rows && rows.length > 0 && (
        <table className="mcmdlog-table">
          <thead><tr><th>Когда</th><th>Кто</th><th>Откуда</th><th>Команда</th><th>Код</th><th>Длительность</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.error || (r.exitCode !== null && r.exitCode !== 0) ? 'mcmdlog-row mcmdlog-row--failed' : 'mcmdlog-row'} onClick={() => setExpanded((cur) => (cur === r.id ? null : r.id))} data-testid={`command-row-${r.id}`}>
                <td title={new Date(r.startedAt).toISOString()}>{new Date(r.startedAt).toLocaleString('ru-RU')}</td>
                <td>{r.userId}</td>
                <td>
                  {SOURCE_LABEL[r.source]}
                  {r.conversationId && onOpenConversation && (
                    <button type="button" className="mcmdlog-link" onClick={(e) => { e.stopPropagation(); onOpenConversation(r.conversationId!) }} title="Открыть чат">↗ чат</button>
                  )}
                </td>
                <td className="mcmdlog-cmd"><code>{r.command}</code>{expanded === r.id && (r.outputExcerpt || r.error) && <pre className="mcmdlog-out">{r.error ?? r.outputExcerpt}</pre>}</td>
                <td>{r.error ? 'ошибка' : r.timedOut ? 'таймаут' : r.exitCode ?? '—'}</td>
                <td>{fmtDuration(r.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
