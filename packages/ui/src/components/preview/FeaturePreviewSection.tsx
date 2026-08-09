import { useCallback, useEffect, useState } from 'react'
import type { PreviewEnvironment, PreviewOperation } from '@shared/preview'
import { isPreviewBusy, previewActions } from '@shared/preview'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/useConfirm'

const LABEL: Record<string, string> = {
  not_created: 'Не создано', queued: 'В очереди', building: 'Сборка', starting: 'Запуск',
  seeding: 'Подготовка данных', health_checking: 'Проверка состояния', running: 'Работает',
  stale: 'Окружение устарело', stopping: 'Остановка', stopped: 'Остановлено',
  rebuilding: 'Пересборка', failed: 'Ошибка', cleaning: 'Удаление', removed: 'Удалено'
}

export function FeaturePreviewSection(props: { projectId: string; taskId: string }): JSX.Element | null {
  const api = window.featurePreview
  const confirm = useConfirm()
  const [environment, setEnvironment] = useState<PreviewEnvironment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [scenario, setScenario] = useState('basic-user')
  const load = useCallback(async () => {
    if (!api) return
    try { setEnvironment(await api.get(props.projectId, props.taskId)); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [api, props.projectId, props.taskId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!environment || !isPreviewBusy(environment.state)) return
    const timer = window.setInterval(() => void load(), 1500)
    return () => window.clearInterval(timer)
  }, [environment?.state, load])
  if (!api) return null
  const state = environment?.state ?? 'not_created'
  const actions = previewActions(state)
  const operate = async (operation: PreviewOperation): Promise<void> => {
    if ((operation === 'remove' || operation === 'reset') && !(await confirm({
      title: operation === 'remove' ? 'Удалить тестовое окружение?' : 'Сбросить тестовые данные?',
      confirmLabel: operation === 'remove' ? 'Удалить' : 'Сбросить',
      variant: 'danger'
    }))) return
    setError(null)
    try {
      setEnvironment(await api.operate(props.projectId, props.taskId, operation, {
        idempotencyKey: crypto.randomUUID(),
        ...(operation === 'seed' || operation === 'reset' ? { scenario } : {})
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const run = environment?.runs.at(-1)
  const current = environment?.builtCommitSha && environment.currentCommitSha === environment.builtCommitSha
  return <section className={`feature-preview feature-preview--${state}`} data-testid="feature-preview">
    <div className="feature-preview__head">
      <div>
        <h3>Тестовое окружение</h3>
        <span className="feature-preview__state">{loading ? 'Загрузка…' : LABEL[state]}</span>
      </div>
      {isPreviewBusy(state) && <Button size="sm" variant="ghost" onClick={() => void api.cancel(props.projectId, props.taskId).then(load)}>Отменить</Button>}
    </div>
    {environment && <>
      <dl className="feature-preview__meta">
        <div><dt>Ветка</dt><dd>{environment.branch || '—'}</dd></div>
        <div><dt>SHA preview</dt><dd><code>{environment.builtCommitSha?.slice(0, 10) ?? '—'}</code></dd></div>
        <div><dt>SHA workspace</dt><dd><code>{environment.currentCommitSha?.slice(0, 10) ?? '—'}</code></dd></div>
        <div><dt>Машина</dt><dd>{environment.agentId}</dd></div>
        <div><dt>Health</dt><dd>{environment.healthStatus}</dd></div>
        <div><dt>Данные</dt><dd>{environment.selectedSeedScenario ?? 'не подготовлены'}</dd></div>
      </dl>
      {state === 'stale' || (environment.builtCommitSha && !current) ? <p className="feature-preview__warning">Окружение устарело. Оно остаётся доступным, но Playwright требует пересборку.</p> : null}
      {environment.lastError && <p className="feature-preview__error">{environment.lastError.type}: {environment.lastError.message}</p>}
      <label className="feature-preview__scenario">Сценарий данных
        <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
          <option value="empty">Пустая система</option><option value="basic-user">Базовый пользователь</option>
          <option value="admin">Администратор</option><option value="project-with-tasks">Проект с задачами</option>
        </select>
      </label>
    </>}
    {error && <p className="feature-preview__error">{error}</p>}
    <div className="feature-preview__actions">
      {actions.includes('start') && <Button variant="primary" size="sm" onClick={() => void operate('start')}>{state === 'stopped' ? 'Запустить снова' : 'Запустить тестовый контейнер'}</Button>}
      {actions.includes('rebuild') && <Button size="sm" onClick={() => void operate('rebuild')}>Пересобрать</Button>}
      {actions.includes('stop') && <Button size="sm" onClick={() => void operate('stop')}>Остановить</Button>}
      {environment?.appUrl && <a className="btn btn--sm" href={environment.appUrl} target="_blank" rel="noreferrer">Открыть приложение</a>}
      {environment?.storybookUrl && <a className="btn btn--sm" href={environment.storybookUrl} target="_blank" rel="noreferrer">Открыть Storybook</a>}
      {actions.includes('seed') && <Button size="sm" onClick={() => void operate('seed')}>Подготовить тестовые данные</Button>}
      {actions.includes('reset') && <Button size="sm" onClick={() => void operate('reset')}>Сбросить тестовые данные</Button>}
      {actions.includes('health_check') && <Button size="sm" onClick={() => void operate('health_check')}>Проверить состояние</Button>}
      {run && <Button size="sm" variant="ghost" onClick={() => setLogsOpen((value) => !value)}>Показать логи</Button>}
      {actions.includes('remove') && <Button size="sm" variant="danger" onClick={() => void operate('remove')}>Удалить окружение</Button>}
    </div>
    {logsOpen && run && <pre className="feature-preview__log" aria-label="Лог preview">{run.log || 'Лог пока пуст'}</pre>}
  </section>
}
