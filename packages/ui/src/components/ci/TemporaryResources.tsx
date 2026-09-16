import { useCallback, useEffect, useRef, useState } from 'react'
import type { CleanupSnapshot } from '@shared/temporaryResources'
import { Button, EmptyState, ErrorState, Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'

const reasons: Record<string, string> = {
  owner_not_terminal: 'Владелец ещё не завершён', active_consumer: 'Ресурс используется',
  active_process: 'Процесс ещё работает', preview_consumer: 'Ресурс занят preview',
  diagnostic_retention: 'Срок хранения диагностики не истёк', git_changes: 'Есть несохранённые изменения',
  ignored_data_unconfirmed: 'Назначение игнорируемых Git файлов не подтверждено',
  unpublished_commits: 'Есть неопубликованные коммиты', machine_offline: 'Машина недоступна',
  ownership_unconfirmed: 'Владение не подтверждено', identity_changed: 'Каталог был заменён',
  results_not_saved: 'Сохранение результатов не подтверждено', excluded_data: 'Содержит исключённые данные',
  agent_cleanup_admission_unavailable: 'Нужно обновить агент машины', already_absent: 'Каталог уже отсутствует'
}
const label = (value: string): string => reasons[value] ?? value
const bytes = (value: number | null): string => value === null ? 'Размер неизвестен' : value.toLocaleString() + ' Б'
const outcomes: Record<string, string> = { deleted: 'Удалено', absent: 'Уже отсутствует', skipped: 'Пропущено', deferred: 'Отложено', error: 'Ошибка', partial: 'Частично выполнено' }
export function TemporaryResources({ projectId, taskId }: { projectId: string; taskId: string }): JSX.Element {
  const [data, setData] = useState<CleanupSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const read = useCallback(async (): Promise<void> => {
    const request = ++generation.current
    setLoading(true)
    try {
      if (!window.ci?.getTemporaryResources) throw new Error('Просмотр временных ресурсов недоступен')
      const value = await window.ci.getTemporaryResources(projectId, taskId)
      if (generation.current === request) { setData(value); setError(null) }
    } catch (e) { if (generation.current === request) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (generation.current === request) setLoading(false) }
  }, [projectId, taskId])
  useEffect(() => {
    setData(null)
    void read()
    const off = window.board?.onReconnect?.(() => void read())
    const changed = window.board?.onTaskRepositoriesUpdated?.(event => {
      if (event.projectId === projectId && event.taskId === taskId) void read()
    })
    return () => { generation.current++; off?.(); changed?.() }
  }, [read, projectId, taskId])
  return <section aria-label="Временные ресурсы" aria-busy={loading}>
    <h3>Временные ресурсы</h3>
    <p>Предварительный просмотр ничего не удаляет. Результаты запусков остаются в истории.</p>
    <Button size="sm" variant="ghost" onClick={() => void read()} loading={loading}>Обновить</Button>
    {loading && !data && <Skeleton width="100%" height={80} />}
    {loading && data && <RefreshIndicator />}
    {error && <ErrorState message={`Не удалось загрузить ресурсы: ${error}`} onRetry={() => void read()} compact />}
    {data && data.candidates.length === 0 && <EmptyState title="Нет временных ресурсов для очистки" />}
    {data && data.candidates.length > 0 && <table>
      <thead><tr><th>Машина / путь</th><th>Владелец / категория</th><th>Размер</th><th>Допуск</th></tr></thead>
      <tbody>{data.candidates.map(candidate => <tr key={candidate.resource.id}>
        <td>{candidate.resource.machineName}<br /><code>{candidate.resource.path}</code></td>
        <td>{candidate.resource.taskId} / {candidate.resource.runId ?? 'задача'}<br />{candidate.resource.category}</td>
        <td>{bytes(candidate.bytes)}{candidate.sizeReason && <div>{label(candidate.sizeReason)}</div>}</td>
        <td>{candidate.eligible ? 'Готов к очистке' : candidate.reasons.map(label).join('; ')}
          {candidate.retainUntil !== null && <div>Хранить до {formatDateTime(candidate.retainUntil)}</div>}</td>
      </tr>)}</tbody>
    </table>}
    {data && <><h4>Журнал очистки</h4>
      {data.attempts.length === 0 ? <EmptyState title="Попыток очистки пока нет" /> : <ul>{data.attempts.map(attempt => <li key={attempt.id}>
        {formatDateTime(attempt.at)} — {outcomes[attempt.outcome]} — {attempt.resource.machineName} — <code>{attempt.resource.path}</code>
        <div>{attempt.resource.taskId} / {attempt.resource.runId ?? 'задача'}: {label(attempt.reason)}</div>
        <div>Освобождено: {attempt.freedBytes === null ? 'неизвестно' : bytes(attempt.freedBytes)}</div>
        {attempt.resource.resultsPath && <div>Архив артефактов: <code>{attempt.resource.resultsPath}</code></div>}
        {attempt.error && <div>{attempt.error}</div>}
      </li>)}</ul>}
    </>}
  </section>
}
