import { useCallback, useEffect, useRef, useState } from 'react'
import { usePolling } from '../../lib/usePolling'
import type { PreviewEnvironment, PreviewAccessResult, PreviewOperation, PreviewServiceKind } from '@shared/preview'
import type { ProjectMachine } from '@shared/projects'
import { isPreviewBusy, previewActions } from '@shared/preview'
import { Button } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { browserId } from '@shared/browserId'
import { CopyCommand } from './CopyCommand'

export const previewIdempotencyKey = browserId

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
  const [machines, setMachines] = useState<ProjectMachine[]>([])
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const selectionTouched = useRef(false)
  const [opening, setOpening] = useState<PreviewServiceKind | null>(null)
  const [readerOpening, setReaderOpening] = useState(false)
  const [connection, setConnection] = useState<PreviewAccessResult | null>(null)
  const [launching, setLaunching] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [launchStartedAt, setLaunchStartedAt] = useState<number | null>(null)
  const load = useCallback(async () => {
    if (!api) return
    try {
      const value = await api.get(props.projectId, props.taskId)
      setEnvironment(value)
      if (value) setSelectedAgentId(value.agentId)
      setError(null)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [api, props.projectId, props.taskId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false
    void (window.api?.['projects:get']({ id: props.projectId }) ?? Promise.resolve(null)).then((project) => {
      if (!cancelled && project) {
        setMachines(project.machines)
        setDefaultAgentId(project.defaultAgentId)
      }
    })
    return () => { cancelled = true }
  }, [props.projectId])
  useEffect(() => {
    if (environment) {
      setSelectedAgentId(environment.agentId)
      return
    }
    if (!selectionTouched.current) {
      setSelectedAgentId(defaultAgentId && machines.some((machine) => machine.agentId === defaultAgentId) ? defaultAgentId : '')
    }
  }, [defaultAgentId, environment, machines])
  // Опрос и часы встают вместе со вкладкой браузера: превью собирается минуты,
  // и карточка, оставленная открытой в фоне, продолжала опрашивать сервер.
  usePolling(() => void load(), { enabled: Boolean(environment && isPreviewBusy(environment.state)), intervalMs: 1500 })
  const clockRunning = launching || Boolean(environment && isPreviewBusy(environment.state))
  usePolling(() => setNow(Date.now()), { enabled: clockRunning, intervalMs: 1000 })
  if (!api) return null
  const state = environment?.state ?? 'not_created'
  const actions = previewActions(state)
  const operate = async (operation: PreviewOperation): Promise<void> => {
    if (launching || isPreviewBusy(state)) return
    if (operation === 'start' && !environment && !machines.some((machine) => machine.agentId === selectedAgentId)) return
    if ((operation === 'remove' || operation === 'reset' || operation === 'docker_install') && !(await confirm({
      title: operation === 'remove' ? 'Удалить тестовое окружение?' : operation === 'docker_install' ? 'Установить Docker на выбранной машине?' : 'Сбросить тестовые данные?',
      confirmLabel: operation === 'remove' ? 'Удалить' : operation === 'docker_install' ? 'Установить Docker' : 'Сбросить',
      variant: 'danger'
    }))) return
    setError(null)
    if (operation === 'start' || operation === 'rebuild') { const started = Date.now(); setLaunching(true); setLaunchStartedAt(started); setNow(started) }
    try {
      setEnvironment(await api.operate(props.projectId, props.taskId, operation, {
        idempotencyKey: previewIdempotencyKey(),
        ...(operation === 'seed' || operation === 'reset' ? { scenario } : {}),
        ...(selectedAgentId ? { agentId: selectedAgentId } : {})
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLaunching(false) }
  }
  const openService = async (service: PreviewServiceKind): Promise<void> => {
    setOpening(service); setConnection(null); setError(null)
    try {
      const result = await api.open(props.projectId, props.taskId, service)
      setConnection(result)
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setOpening(null) }
  }
  const closeConnection = async (): Promise<void> => {
    if (!connection?.tunnelId) return
    await api.closeTunnel(props.projectId, props.taskId, connection.tunnelId)
    setConnection({ ...connection, state: 'closed', url: null })
  }
  // «Тестировать в Web Reader»: создаёт Reader-чат с адресом окружения через
  // loopback-мост машины и открывает его в новой вкладке — модель и пользователь
  // сразу тестируют фичу задачи инструментами браузера.
  const openInWebReader = async (): Promise<void> => {
    const chatApi = window.api
    if (!chatApi || !environment?.appUrl) return
    setReaderOpening(true)
    try {
      const parsed = new URL(environment.appUrl, 'http://127.0.0.1/')
      parsed.hostname = environment.agentId + '.machine.internal'
      const conversation = await chatApi['conversations:create']({ title: `Reader: ${environment.branch}`, scope: 'web-reader', assistantKind: 'web-recorder' })
      await chatApi['conversations:setPreviewUrl']({ id: conversation.id, previewUrl: parsed.toString() })
      const target = new URL(window.location.href)
      target.hash = `#/web-reader/${conversation.id}`
      window.open(target.toString(), '_blank', 'noopener,noreferrer')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setReaderOpening(false)
    }
  }
  const run = environment?.runs.at(-1)
  const activeRun = !!run && ['queued','running','cancelling'].includes(run.status)
  const currentStep = run?.steps?.find((step) => step.id === run.currentStepId) ?? run?.steps?.find((step) => step.status === 'running')
  const completedSteps = run?.steps?.filter((step) => step.status === 'succeeded' || step.status === 'skipped').length ?? 0
  const progress = run?.steps?.length ? Math.round(completedSteps / run.steps.length * 100) : null
  const elapsedFrom = run?.startedAt ?? run?.createdAt ?? launchStartedAt
  const elapsedSeconds = elapsedFrom ? Math.max(0, Math.floor((now - elapsedFrom) / 1000)) : 0
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
  const current = environment?.expectedCommitSha && environment.expectedCommitSha === environment.currentCommitSha && environment.currentCommitSha === environment.builtCommitSha
  const canOpen = state === 'running' && environment?.healthStatus === 'healthy'
  const selectedMachineIsAvailable = machines.some((machine) => machine.agentId === selectedAgentId)
  const actualMachineLabel = environment ? machines.find((machine) => machine.agentId === environment.agentId)?.name?.trim() || environment.agentId : null
  return <section className={`feature-preview feature-preview--${state}`} data-testid="feature-preview">
    <div className="feature-preview__head">
      <div>
        <h3>Тестовое окружение</h3>
        <span className="feature-preview__state">{loading ? 'Загрузка…' : LABEL[state]}</span>
      </div>
      {isPreviewBusy(state) && <Button size="sm" variant="ghost" onClick={() => void api.cancel(props.projectId, props.taskId).then(load)}>Отменить</Button>}
    </div>
    {(launching || activeRun) && <div className="feature-preview__progress" role="status" aria-live="polite">
      <span className="feature-preview__loader" aria-hidden="true" />
      <div className="feature-preview__progress-copy">
        <strong>{launching && !activeRun ? 'Запускаем тестовый контейнер…' : currentStep?.name ?? 'Запускаем тестовый контейнер…'}</strong>
        <span>{currentStep?.message ?? 'Создаём серверную операцию запуска'} · {elapsed}</span>
      </div>
      <div className={`feature-preview__bar${progress === null ? ' feature-preview__bar--indeterminate' : ''}`} role="progressbar" aria-label="Прогресс запуска тестового контейнера" aria-valuemin={progress === null ? undefined : 0} aria-valuemax={progress === null ? undefined : 100} aria-valuenow={progress ?? undefined}>
        {progress !== null && <span style={{ width: `${progress}%` }} />}
      </div>
      <Button size="sm" variant="ghost" aria-expanded={logsOpen} onClick={() => setLogsOpen((value) => !value)}>Подробнее</Button>
    </div>}
    <label className="feature-preview__scenario">Машина для окружения
      <select aria-label="Машина для тестового окружения" value={selectedAgentId} disabled={isPreviewBusy(state) || state === 'running'} onChange={(event) => { selectionTouched.current = true; setSelectedAgentId(event.target.value) }}>
        <option value="">Выберите машину</option>
        {environment && !machines.some((machine) => machine.agentId === environment.agentId) && <option value={environment.agentId}>{environment.agentId}</option>}
        {machines.map((machine) => <option key={machine.agentId} value={machine.agentId}>{machine.name?.trim() || machine.agentId}</option>)}
      </select>
    </label>
    {environment && <>
      <dl className="feature-preview__meta">
        <div><dt>Ветка</dt><dd>{environment.branch || '—'}</dd></div>
        <div><dt>Workspace</dt><dd><code>{environment.workspacePath}</code></dd></div>
        <div><dt>Ожидаемый SHA</dt><dd><code>{environment.expectedCommitSha?.slice(0, 10) ?? '—'}</code></dd></div>
        <div><dt>Текущий SHA</dt><dd><code>{environment.currentCommitSha?.slice(0, 10) ?? '—'}</code></dd></div>
        <div><dt>Собранный SHA</dt><dd><code>{environment.builtCommitSha?.slice(0, 10) ?? '—'}</code></dd></div>
        <div><dt>Git</dt><dd>{environment.gitStatus}</dd></div>
        <div><dt>Машина</dt><dd>{actualMachineLabel}</dd></div>
        <div><dt>Health</dt><dd>{environment.healthStatus}</dd></div>
        <div><dt>Данные</dt><dd>{environment.selectedSeedScenario ?? 'не подготовлены'}</dd></div>
      </dl>
      {state === 'stale' || (environment.builtCommitSha && !current) ? <p className="feature-preview__warning">Окружение не соответствует зафиксированному SHA. Для QA требуется пересборка.</p> : null}
      {connection && <div className="feature-preview__connection" role="status">
        <span>{connection.state === 'connected' ? `Подключено · ${connection.connectionType === 'direct' ? 'прямой доступ' : 'защищённый туннель'}` : connection.error ?? 'Туннель закрыт'}</span>
        {connection.tunnelId && connection.state === 'connected' && <Button size="sm" variant="ghost" onClick={() => void closeConnection()}>Закрыть подключение</Button>}
        {!connection.url && connection.missingSshSettings?.length ? <div className="feature-preview__manual">
          <small>Заполните в настройках машины: {connection.missingSshSettings.includes('hostname') ? 'SSH hostname/IP' : ''}{connection.missingSshSettings.length === 2 ? ' и ' : ''}{connection.missingSshSettings.includes('user') ? 'SSH-пользователя' : ''}.</small>
        </div> : null}
        {connection.manualCommand && !connection.url && <div className="feature-preview__manual">
          <CopyCommand command={connection.manualCommand} />
          <small>Запустите команду в терминале рабочей машины. Пароли и SSH-ключи остаются на ней.</small>
        </div>}
      </div>}
      <details className="feature-preview__technical"><summary>Технические адреса</summary><dl>{environment.services.map((service) => <div key={service.name}><dt>{service.name}</dt><dd><code>{service.url}</code> · порт {service.hostPort}</dd></div>)}</dl></details>
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
      {actions.includes('start') && <Button variant="primary" size="sm" disabled={launching || (!environment && !selectedMachineIsAvailable)} aria-busy={launching} onClick={() => void operate('start')}>{launching ? 'Запускаем тестовый контейнер…' : state === 'stopped' ? 'Запустить снова' : 'Запустить тестовый контейнер'}</Button>}
      {actions.includes('rebuild') && <Button size="sm" onClick={() => void operate('rebuild')}>Пересобрать</Button>}
      {actions.includes('stop') && <Button size="sm" onClick={() => void operate('stop')}>Остановить</Button>}
      {canOpen && environment?.appUrl && <Button variant="primary" size="sm" disabled={opening !== null} onClick={() => void openService('app')}>{opening === 'app' ? 'Создаём подключение…' : 'Открыть проект'}</Button>}
      {canOpen && environment?.appUrl && <Button variant="secondary" size="sm" loading={readerOpening} onClick={() => void openInWebReader()}>Тестировать в Web Reader</Button>}
      {canOpen && environment?.storybookUrl && environment.storybookStatus === 'ready' && <Button size="sm" disabled={opening !== null} onClick={() => void openService('storybook')}>{opening === 'storybook' ? 'Создаём подключение…' : 'Открыть Storybook'}</Button>}
      {actions.includes('seed') && <Button size="sm" onClick={() => void operate('seed')}>Подготовить тестовые данные</Button>}
      {actions.includes('reset') && <Button size="sm" onClick={() => void operate('reset')}>Сбросить тестовые данные</Button>}
      {actions.includes('health_check') && <Button size="sm" onClick={() => void operate('health_check')}>Проверить состояние</Button>}
      {run && !activeRun && <Button size="sm" variant="ghost" aria-expanded={logsOpen} onClick={() => setLogsOpen((value) => !value)}>Просмотреть журнал</Button>}
      {(error?.includes('не запущен') || environment?.lastError?.message.includes('не запущен')) && <Button size="sm" onClick={() => void operate('docker_start')}>Запустить Docker</Button>}
      {(error?.includes('не установлен') || environment?.lastError?.message.includes('не установлен')) && <Button size="sm" onClick={() => void operate('docker_install')}>Установить и запустить Docker</Button>}
      {actions.includes('remove') && <Button size="sm" variant="danger" onClick={() => void operate('remove')}>Удалить окружение</Button>}
    </div>
    {logsOpen && run && <div className="feature-preview__details">
      <ol className="feature-preview__steps" aria-label="Этапы запуска">{run.steps?.map((step) => <li key={step.id} className={`feature-preview__step feature-preview__step--${step.status}`} aria-current={step.status === 'running' ? 'step' : undefined}>
        <span>{step.name}</span><small>{step.message}{step.startedAt && step.finishedAt ? ` · ${Math.max(0, Math.round((step.finishedAt - step.startedAt) / 1000))} с` : ''}</small>
      </li>)}</ol>
      <pre className="feature-preview__log" aria-label="Безопасный журнал preview">{run.log || 'Лог пока пуст'}</pre>
    </div>}
  </section>
}
