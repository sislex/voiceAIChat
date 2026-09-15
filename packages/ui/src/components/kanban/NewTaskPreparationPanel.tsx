import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { TaskPreparationLlmSelection, TaskPreparationRun } from '@shared/qa'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import type { TaskPreparationTabProps } from './TaskPreparationTab'
import { PreparationRunSteps } from '../ci/RunFeed'
import { AttemptList, CheckList, MetricTiles, StageCard, StageHeading, StageRail } from './NewTaskStages'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, pluralRu, preparationStageStatus } from './taskCycles'

export interface NewTaskPreparationPanelProps {
  preparation: Omit<TaskPreparationTabProps, 'runFilter' | 'onRunsChange' | 'hideHistory'>
  cycles: TaskReworkCycleViewModel[]
  workflow: string[]
  initialCycleId?: string | null
}
export function NewTaskPreparationPanel(props: NewTaskPreparationPanelProps): JSX.Element {
  const p = props.preparation
  const identity = p.projectId + ':' + p.taskId
  const history = useNewTaskResource(identity, async () => {
    if (!p.loadRuns) throw new Error('История подготовки недоступна')
    return p.loadRuns(p.taskId)
  })
  const setup = useNewTaskResource(identity, async () => {
    if (!window.ci) throw new Error('Настройки подготовки недоступны')
    const [machines, llm] = await Promise.all([window.ci.getTaskMachines(p.projectId, p.taskId), window.ci.getTaskPreparationLlm(p.projectId, p.taskId)])
    return { machines, llm }
  })
  const [selection, setSelection] = useState<TaskPreparationLlmSelection | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(props.initialCycleId ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const { busy, error, act } = useNewTaskAction(history.refresh)
  const stages = useMemo(() => assignToCycles(props.cycles, history.data ?? [], {
    createdAt: run => run.createdAt,
    pinnedCycleId: (run, all) => all.find(cycle => cycle.preparationRunId === run.id)?.id ?? null
  }), [props.cycles, history.data])
  const selected = stages.find(stage => stage.key === selectedKey) ?? stages[stages.length - 1]!
  const run = selected.items.find(item => item.id === selectedId) ?? selected.items[selected.items.length - 1] ?? null
  const active = history.data?.find(item => item.canCancel)
  const currentCycle = selected.key === stages[stages.length - 1]!.key
  const machines = setup.data?.machines.machines ?? []
  const preferred = machines.find(item => item.agentId === setup.data?.machines.effectiveAgentId && item.online && item.canUse !== false)
    ?? machines.find(item => item.online && item.canUse !== false)
  const chosen = selection ?? (setup.data ? { ...setup.data.llm, machineId: preferred?.agentId ?? '' } : null)
  const models = chosen ? allowedModels(p.llmAccess ?? [], chosen.provider) : []
  const ready = Boolean(chosen && machines.some(item => item.agentId === chosen.machineId && item.online && item.canUse !== false)
    && models.some(item => item.id === chosen.model) && isProviderAllowed(p.llmAccess ?? [], chosen.provider))
  useEffect(() => {
    const offUpdate = window.board?.onPreparationRunUpdated?.(event => {
      if (event.projectId === p.projectId && event.taskId === p.taskId) void history.refresh()
    })
    const offReconnect = window.board?.onReconnect?.(() => void history.refresh())
    return () => { offUpdate?.(); offReconnect?.() }
  }, [identity, history.refresh])
  useEffect(() => { setAnswer('') }, [run?.id])
  const accept = (next: TaskPreparationRun | void) => { if (next) setSelectedId(next.id) }
  return <div className="new-task-process" data-testid="new-task-preparation">
    <StageHeading eyebrow="История подготовки" title="Этапы подготовки к разработке"
      description="Каждый новый набор доработок готовится отдельно, не перезаписывая исходный Development Brief."
      badge={<Badge>{pluralRu(stages.length, 'этап', 'этапа', 'этапов')}</Badge>} />
    {(history.error || error) && <ErrorState compact message="Не удалось обновить подготовку" detail={error || history.error} onRetry={() => void history.refresh()} />}
    {history.loading && !history.data && <Skeleton variant="list" count={3} />}
    <StageRail testId="new-task-preparation-rail">
      {stages.map((stage, index) => {
        const shown = stage.key === selected.key ? run : stage.items[stage.items.length - 1]
        return <StageCard key={stage.key} number={stage.number} status={shown ? preparationStageStatus(shown.status) : 'idle'}
          statusLabel={shown ? (preparationStageStatus(shown.status) === 'success' ? 'Подготовлено' : undefined) : 'Ожидает'}
          eyebrow={`Этап ${stage.number}`} title={stage.cycle ? `Подготовка к разработке доработки ${stage.cycle.sequence}` : 'Подготовка задачи по первоначальному описанию'}
          workflow={props.workflow} cycle={stage.cycle} sourceTitle="Источник этапа" sourceText="Первоначальное описание, критерии приёмки, файлы задачи и Make-дизайн."
          selected={stage.key === selected.key} onSelect={() => { setSelectedKey(stage.key); setSelectedId(null) }} connector={index < stages.length - 1}
          testId={`new-task-preparation-stage-${stage.number}`}>
          {stage.key === selected.key && <>
            <AttemptList ariaLabel="Попытки подготовки" selectedId={run?.id ?? null} onSelect={setSelectedId}
              attempts={stage.items.map(item => ({ id: item.id, label: `Попытка ${item.attempt}`, status: preparationStageStatus(item.status), at: item.createdAt }))} />
            {currentCycle && (!run || run.canRetry) && <section className="new-task-section" aria-label="Настройка запуска подготовки">
              <h3>Исполнитель подготовки</h3>
              {setup.error && <ErrorState compact message="Не удалось загрузить настройки" detail={setup.error} onRetry={() => void setup.refresh()} />}
              {!setup.data && setup.loading && <Skeleton variant="block" height={80} />}
              {chosen && <div className="task-preparation-grid">
                <label>Машина<select aria-label="Машина подготовки" value={chosen.machineId} onChange={event => setSelection({ ...chosen, machineId: event.target.value })}>
                  <option value="" disabled>Выберите online-машину</option>
                  {machines.map(item => <option key={item.agentId} value={item.agentId} disabled={!item.online || item.canUse === false}>{item.name}{item.online ? '' : ' (offline)'}</option>)}
                </select></label>
                <label>Исполнитель LLM<select aria-label="Исполнитель LLM" value={chosen.llmEngineId ?? ''} onChange={event => setSelection({ ...chosen, llmEngineId: event.target.value || null })}>
                  <option value="">По умолчанию</option>{(p.llmEngines ?? []).filter(item => item.kind === chosen.provider).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label>Провайдер<select aria-label="Провайдер модели" value={chosen.provider} onChange={event => {
                  const provider = event.target.value as 'claude' | 'codex'
                  setSelection({ ...chosen, provider, model: allowedModels(p.llmAccess ?? [], provider)[0]?.id ?? '', llmEngineId: null })
                }}>{(['claude', 'codex'] as const).map(provider => <option key={provider} value={provider} disabled={!isProviderAllowed(p.llmAccess ?? [], provider)}>{provider}</option>)}</select></label>
                <label>Модель<select aria-label="Модель подготовки" value={chosen.model} onChange={event => setSelection({ ...chosen, model: event.target.value })}>
                  <option value="" disabled>Выберите доступную модель</option>{models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select></label>
              </div>}
              {!ready && <p role="status">Для запуска нужны доступные машина и модель.</p>}
              {!run && <Button size="sm" variant="primary" loading={busy} disabled={!ready || Boolean(active) || !p.onStart || !history.data} onClick={() => void act(async () => accept(await p.onStart!(p.taskId, chosen!)))}>Запустить подготовку</Button>}
              {run?.canRetry && p.onRetry && <Button size="sm" loading={busy} disabled={!ready || Boolean(active)} onClick={() => void act(async () => accept(await p.onRetry!(run.id, chosen!)))}>Повторить подготовку</Button>}
            </section>}
            {!run && <EmptyState compact icon="🧭" title="Подготовка этого этапа ещё не запускалась" description={currentCycle ? 'Выберите исполнителя и запустите подготовку.' : 'В этом историческом цикле попыток нет.'} />}
            {run && <>
              <h4>Попытка {run.attempt}</h4>
              <MetricTiles items={[{ label: 'Длительность', value: run.durationMs == null ? '—' : `${Math.round(run.durationMs / 1000)} с` },
                { label: 'Машина', value: run.machineName ?? run.machineId ?? '—' }, { label: 'Модель', value: `${run.provider ?? '—'} · ${run.model || 'по умолчанию'}` }]} />
              {run.error && <ErrorState compact message="Подготовка остановлена" detail={run.error} />}
              {(run.questions ?? []).map(question => <section key={question.questionId} className="new-task-section">
                <h4>Уточнение</h4><p>{question.text}</p>
                {question.status === 'open' && active?.id === run.id && p.onAnswer ? <>
                  <textarea aria-label="Ответ на вопрос подготовки" value={answer} onChange={event => setAnswer(event.target.value)} />
                  <Button loading={busy} disabled={!answer.trim()} onClick={() => void act(async () => { await p.onAnswer!(question.questionId, answer.trim()); setAnswer('') })}>Отправить ответ</Button>
                </> : <p>{question.answer ?? 'Ответ не получен'}</p>}
              </section>)}
              <CheckList checks={(run.gateResults ?? []).map(gate => ({ id: gate.code, title: gate.code, ok: gate.status === 'pass', note: gate.explanation }))} />
              {run.gateReasons.length > 0 && <ErrorState compact message="Условия готовности не выполнены" detail={run.gateReasons.join('; ')} />}
              {run.readiness && <details className="new-task-stage-details"><summary>Development Brief и результат</summary>
                <h4>{run.readiness.goal}</h4><p>{run.readiness.functionalRequirements}</p><pre>{JSON.stringify(run.readiness, null, 2)}</pre>
              </details>}
              <PreparationRunSteps steps={run.steps ?? []} fallback={run.log || 'Лента этой попытки пуста.'} />
              <div className="new-task-heading-actions">
                {run.canCancel && active?.id === run.id && p.onCancel && <Button size="sm" variant="danger" loading={busy} onClick={() => void act(async () => accept(await p.onCancel!(run.id)))}>Отменить</Button>}
                {p.onExport && <><Button size="sm" onClick={() => void act(() => p.onExport!(run.id, 'md'))}>Скачать Markdown</Button><Button size="sm" onClick={() => void act(() => p.onExport!(run.id, 'json'))}>Скачать JSON</Button></>}
              </div>
            </>}
          </>}
        </StageCard>
      })}
    </StageRail>
  </div>
}
