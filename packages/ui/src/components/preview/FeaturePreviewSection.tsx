import { useCallback, useEffect, useState } from 'react'
import type { PreviewEnvironment, PreviewAccessResult, PreviewOperation, PreviewServiceKind } from '@shared/preview'
import type { ProjectMachine } from '@shared/projects'
import { isPreviewBusy, previewActions } from '@shared/preview'
import { Button } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { CopyCommand } from './CopyCommand'

export function previewIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

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
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [opening, setOpening] = useState<PreviewServiceKind | null>(null)
  const [connection, setConnection] = useState<PreviewAccessResult | null>(null)
  const load = useCallback(async () => {
    if (!api) return
    try {
      const value = await api.get(props.projectId, props.taskId)
      setEnvironment(value); setSelectedAgentId((current) => current || value?.agentId || ''); setError(null)
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
        setSelectedAgentId((current) => current || project.defaultAgentId || project.machines[0]?.agentId || '')
      }
    })
    return () => { cancelled = true }
  }, [props.projectId])
  useEffect(() => {
    if (!environment || !isPreviewBusy(environment.state)) return
    const timer = window.setInterval(() => void load(), 1500)
    return () => window.clearInterval(timer)
  }, [environment?.state, load])
  if (!api) return null
  const state = environment?.state ?? 'not_created'
  const actions = previewActions(state)
  const operate = async (operation: PreviewOperation): Promise<void> => {
    if ((operation === 'remove' || operation === 'reset' || operation === 'docker_install') && !(await confirm({
      title: operation === 'remove' ? 'Удалить тестовое окружение?' : operation === 'docker_install' ? 'Установить Docker на выбранной машине?' : 'Сбросить тестовые данные?',
      confirmLabel: operation === 'remove' ? 'Удалить' : operation === 'docker_install' ? 'Установить Docker' : 'Сбросить',
      variant: 'danger'
    }))) return
    setError(null)
    try {
      setEnvironment(await api.operate(props.projectId, props.taskId, operation, {
        idempotencyKey: previewIdempotencyKey(),
        ...(operation === 'seed' || operation === 'reset' ? { scenario } : {}),
        ...(selectedAgentId ? { agentId: selectedAgentId } : {})
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
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
  const run = environment?.runs.at(-1)
  const current = environment?.expectedCommitSha && environment.expectedCommitSha === environment.currentCommitSha && environment.currentCommitSha === environment.builtCommitSha
  const canOpen = state === 'running' && environment?.healthStatus === 'healthy'
  return <section className={`feature-preview feature-preview--${state}`} data-testid="feature-preview">
    <div className="feature-preview__head">
      <div>
        <h3>Тестовое окружение</h3>
        <span className="feature-preview__state">{loading ? 'Загрузка…' : LABEL[state]}</span>
      </div>
      {isPreviewBusy(state) && <Button size="sm" variant="ghost" onClick={() => void api.cancel(props.projectId, props.taskId).then(load)}>Отменить</Button>}
    </div>
    <label className="feature-preview__scenario">Машина для окружения
      <select aria-label="Машина для тестового окружения" value={selectedAgentId} disabled={isPreviewBusy(state) || state === 'running'} onChange={(event) => setSelectedAgentId(event.target.value)}>
        <option value="">Выберите машину</option>
        {machines.map((machine) => <option key={machine.agentId} value={machine.agentId}>{machine.agentId}</option>)}
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
        <div><dt>Машина</dt><dd>{environment.agentId}</dd></div>
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
      {actions.includes('start') && <Button variant="primary" size="sm" onClick={() => void operate('start')}>{state === 'stopped' ? 'Запустить снова' : 'Запустить тестовый контейнер'}</Button>}
      {actions.includes('rebuild') && <Button size="sm" onClick={() => void operate('rebuild')}>Пересобрать</Button>}
      {actions.includes('stop') && <Button size="sm" onClick={() => void operate('stop')}>Остановить</Button>}
      {canOpen && environment?.appUrl && <Button variant="primary" size="sm" disabled={opening !== null} onClick={() => void openService('app')}>{opening === 'app' ? 'Создаём подключение…' : 'Открыть проект'}</Button>}
      {canOpen && environment?.storybookUrl && environment.storybookStatus === 'ready' && <Button size="sm" disabled={opening !== null} onClick={() => void openService('storybook')}>{opening === 'storybook' ? 'Создаём подключение…' : 'Открыть Storybook'}</Button>}
      {actions.includes('seed') && <Button size="sm" onClick={() => void operate('seed')}>Подготовить тестовые данные</Button>}
      {actions.includes('reset') && <Button size="sm" onClick={() => void operate('reset')}>Сбросить тестовые данные</Button>}
      {actions.includes('health_check') && <Button size="sm" onClick={() => void operate('health_check')}>Проверить состояние</Button>}
      {run && <Button size="sm" variant="ghost" onClick={() => setLogsOpen((value) => !value)}>Показать логи</Button>}
      {(error?.includes('не запущен') || environment?.lastError?.message.includes('не запущен')) && <Button size="sm" onClick={() => void operate('docker_start')}>Запустить Docker</Button>}
      {(error?.includes('не установлен') || environment?.lastError?.message.includes('не установлен')) && <Button size="sm" onClick={() => void operate('docker_install')}>Установить и запустить Docker</Button>}
      {actions.includes('remove') && <Button size="sm" variant="danger" onClick={() => void operate('remove')}>Удалить окружение</Button>}
    </div>
    {logsOpen && run && <pre className="feature-preview__log" aria-label="Лог preview">{run.log || 'Лог пока пуст'}</pre>}
  </section>
}
