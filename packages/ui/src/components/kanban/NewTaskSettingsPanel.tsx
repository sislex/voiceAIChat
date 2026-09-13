import { useEffect, useState } from 'react'
import type { UserLlmAccess } from '@shared/llmAccess'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import type { CiLlmConfig, CiSlotConfig } from '@shared/ci'
import { Button, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import { CiSlotEditor } from '../ci/CiSlotEditor'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'

export interface NewTaskSettingsPanelProps {
  projectId: string; taskId: string; mergeMachineBound?: boolean; llmAccess?: UserLlmAccess[]
}
export function NewTaskSettingsPanel(props: NewTaskSettingsPanelProps): JSX.Element {
  return <div className="new-task-settings" data-testid="new-task-settings">
    <MachineSettings {...props} /><ModelSettings {...props} /><CommandSettings {...props} />
  </div>
}
function MachineSettings(p: NewTaskSettingsPanelProps): JSX.Element {
  const resource = useNewTaskResource(p.projectId + ':' + p.taskId, async () => {
    if (!window.ci) throw new Error('Машины недоступны')
    return window.ci.getTaskMachines(p.projectId, p.taskId)
  })
  const { busy, error, act } = useNewTaskAction(resource.refresh)
  return <section className="new-task-section"><h3>Машина выполнения</h3>
    {(resource.error || error) && <ErrorState compact message="Не удалось обновить машину" detail={error || resource.error} onRetry={() => void resource.refresh()} />}
    {!resource.data && resource.loading && <Skeleton variant="block" height={54} />}
    {resource.data && <>
      <label>Машина<select aria-label="Машина выполнения" value={resource.data.selectedAgentId ?? ''} disabled={busy} onChange={event => {
        const agentId = event.target.value || null
        void act(() => window.api['tasks:update']({ projectId: p.projectId, taskId: p.taskId, agentId }))
      }}>
        <option value="">Машина проекта по умолчанию</option>
        {resource.data.unavailableSelection && <option value={resource.data.unavailableSelection.agentId} disabled>{resource.data.unavailableSelection.name ?? 'Недоступная машина'}</option>}
        {resource.data.machines.map(machine => <option key={machine.agentId} value={machine.agentId} disabled={machine.canUse === false}>{machine.name} · {machine.online ? 'online' : 'offline'}</option>)}
      </select></label>
      {!resource.data.machines.length && <EmptyState compact icon="🖥" title="Доступных машин нет" description="Добавьте машину в проект." />}
      {resource.data.unavailableSelection && <p role="alert">Сохранённая машина недоступна. Выберите доступную машину для запуска.</p>}
    </>}
  </section>
}
function ModelSettings(p: NewTaskSettingsPanelProps): JSX.Element {
  const resource = useNewTaskResource(p.projectId + ':' + p.taskId, async () => {
    if (!window.ci) throw new Error('Модели недоступны')
    return window.ci.getTaskCiLlm(p.projectId, p.taskId)
  })
  const [draft, setDraft] = useState<CiLlmConfig | null>(null)
  const { busy, error, act } = useNewTaskAction(resource.refresh)
  useEffect(() => { setDraft(null) }, [p.projectId, p.taskId])
  const llm = draft ?? resource.data?.config
  const access = p.llmAccess ?? []
  const models = llm ? allowedModels(access, llm.provider) : []
  return <section className="new-task-section"><h3>Движок и модель</h3>
    {(resource.error || error) && <ErrorState compact message="Не удалось обновить модель" detail={error || resource.error} onRetry={() => void resource.refresh()} />}
    {!resource.data && resource.loading && <Skeleton variant="block" height={100} />}
    {llm && <>
      <p className="new-task-muted">{resource.data?.overridden ? 'Настройка задачи' : 'Унаследовано от проекта'}</p>
      <div className="task-preparation-grid">
        <label>Движок<select aria-label="Движок модели" value={llm.provider} onChange={event => {
          const provider = event.target.value as 'claude' | 'codex'
          setDraft({ ...llm, provider, model: allowedModels(access, provider)[0]?.id ?? '', llmEngineId: null })
        }}>{(['claude', 'codex'] as const).map(provider => <option key={provider} value={provider} disabled={!isProviderAllowed(access, provider)}>{provider}</option>)}</select></label>
        <label>Модель<select aria-label="Модель" value={llm.model} onChange={event => setDraft({ ...llm, model: event.target.value })}>
          {!models.some(item => item.id === llm.model) && <option value={llm.model} disabled>{llm.model || 'Модели не загружены'}</option>}
          {models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>Режим запуска<select aria-label="Режим запуска" value={llm.mode} onChange={event => setDraft({ ...llm, mode: event.target.value as CiLlmConfig['mode'] })}><option value="plan">План</option><option value="development">Разработка</option></select></label>
        <label>Уточнения<select aria-label="Степень уточнения" value={llm.clarifyLevel} onChange={event => setDraft({ ...llm, clarifyLevel: event.target.value as CiLlmConfig['clarifyLevel'] })}>
          <option value="none">Без вопросов</option><option value="few">Немного</option><option value="medium">Средне</option><option value="detailed">Подробно</option>
        </select></label>
      </div>
      {!models.length && <p role="status">Нет доступных моделей для выбранного движка.</p>}
      <div className="new-task-heading-actions">
        <Button loading={busy} disabled={!draft || !models.some(item => item.id === llm.model)} onClick={() => void act(async () => { await window.ci!.putTaskCiLlm(p.projectId, p.taskId, llm); setDraft(null) })}>Сохранить движок и модель</Button>
        {resource.data?.overridden && <Button loading={busy} onClick={() => void act(async () => { await window.ci!.resetTaskCiLlm(p.projectId, p.taskId); setDraft(null) })}>Вернуть настройку проекта</Button>}
      </div>
    </>}
  </section>
}
function CommandSettings(p: NewTaskSettingsPanelProps): JSX.Element {
  const resource = useNewTaskResource(p.projectId + ':' + p.taskId, async () => {
    if (!window.ci) throw new Error('Команды недоступны')
    const [commands, config] = await Promise.all([window.ci.listCommands(p.projectId), window.ci.getTaskCi(p.projectId, p.taskId)])
    return { commands, config }
  })
  const [draft, setDraft] = useState<CiSlotConfig | null>(null)
  useEffect(() => { setDraft(null) }, [p.projectId, p.taskId])
  const { busy, error, act } = useNewTaskAction(resource.refresh)
  const config = draft ?? resource.data?.config.config
  return <section className="new-task-section"><h3>Команды воркфлоу</h3>
    {(resource.error || error) && <ErrorState compact message="Не удалось обновить команды" detail={error || resource.error} onRetry={() => void resource.refresh()} />}
    {!resource.data && resource.loading && <Skeleton variant="list" count={2} />}
    {config && <>
      <CiSlotEditor label="До работы модели" commands={resource.data?.commands ?? []} value={config.beforeModel} onChange={beforeModel => setDraft({ ...config, beforeModel })} />
      <CiSlotEditor label="После работы модели" commands={resource.data?.commands ?? []} value={config.afterModel} onChange={afterModel => setDraft({ ...config, afterModel })} />
      <Button loading={busy} disabled={!draft} onClick={() => void act(async () => { await window.ci!.putTaskCi(p.projectId, p.taskId, config); setDraft(null) })}>Сохранить команды</Button>
    </>}
  </section>
}
