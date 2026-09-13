import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, FeedLog, Skeleton, useConfirm } from '@voicechat/ui-kit'
import type { MergeRun } from '@shared/merge'
import { AttemptList, CheckList, MetricTiles, StageCard, StageHeading, StageRail } from './NewTaskStages'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, mergeStageStatus, pluralRu, stageTitle } from './taskCycles'

export interface NewTaskMergePanelProps {
  projectId: string; taskId: string; cycles: TaskReworkCycleViewModel[]; workflow: string[]
  activeRunId: string | null; canStart: boolean; onStartMerge?: (agentId: string | null) => void | Promise<void>
}
export function NewTaskMergePanel(props: NewTaskMergePanelProps): JSX.Element {
  const key = props.projectId + ':' + props.taskId
  const history = useNewTaskResource(key, async () => {
    if (!window.ci) throw new Error('Merge недоступен')
    return window.ci.listMergeRuns(props.projectId, props.taskId)
  })
  const machines = useNewTaskResource(key, async () => {
    if (!window.ci) throw new Error('Машины merge недоступны')
    const [task, merge] = await Promise.all([window.ci.getTaskMachines(props.projectId, props.taskId), window.ci.getMergeMachines(props.projectId, props.taskId)])
    return { task, merge }
  })
  const [agentId, setAgentId] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { busy, error, act } = useNewTaskAction(history.refresh)
  const confirm = useConfirm()
  const stages = useMemo(() => assignToCycles(props.cycles, history.data ?? [], { createdAt: run => run.createdAt }), [props.cycles, history.data])
  const selected = stages.find(stage => stage.key === selectedKey) ?? stages[stages.length - 1]!
  const run = selected.items.find(item => item.id === selectedId) ?? selected.items[selected.items.length - 1] ?? null
  const chosen = agentId ?? machines.data?.merge.defaultAgentId ?? ''
  const readiness = machines.data?.merge.machines.find(item => item.agentId === chosen)?.readiness
  const current = selected.key === stages[stages.length - 1]!.key
  useEffect(() => {
    const off = window.ci?.onMerge(({ run: next }) => { if (next.projectId === props.projectId && next.taskId === props.taskId) void history.refresh() })
    const reconnect = window.board?.onReconnect?.(() => { void history.refresh(); void machines.refresh() })
    return () => { off?.(); reconnect?.() }
  }, [key, history.refresh, machines.refresh])
  return <div className="new-task-process" data-testid="new-task-merge">
    <StageHeading eyebrow="История проходов" title="Merge" description="Отдельный проход для каждого development-цикла и набора доработок."
      badge={<Badge>{pluralRu(stages.length, 'проход', 'прохода', 'проходов')}</Badge>} />
    {(history.error || error) && <ErrorState compact message="Не удалось обновить Merge" detail={error || history.error} onRetry={() => void history.refresh()} />}
    {!history.data && history.loading && <Skeleton variant="list" count={3} />}
    <StageRail testId="new-task-merge-rail">
      {stages.map((stage, index) => {
        const shown = stage.key === selected.key ? run : stage.items[stage.items.length - 1]
        return <StageCard key={stage.key} number={stage.number} status={shown ? mergeStageStatus(shown.status) : 'idle'}
          statusLabel={shown?.status === 'success' ? 'Влито в main' : undefined} eyebrow={`Проход ${stage.number}`} title={stageTitle('Merge', stage)}
          workflow={props.workflow} cycle={stage.cycle} sourceTitle="Цикл 1" sourceText="Результат разработки первоначальной постановки задачи."
          selected={stage.key === selected.key} onSelect={() => { setSelectedKey(stage.key); setSelectedId(null) }} connector={index < stages.length - 1} testId={`new-task-merge-stage-${stage.number}`}>
          <CheckList checks={[
            { id: 'main', title: 'Актуальность main', ok: shown?.conflicts.length ? false : shown?.status === 'success' ? true : null, note: shown?.targetSha ? `main ${shown.targetSha.slice(0, 8)}` : 'Нет данных' },
            { id: 'checks', title: 'CI и конфликты', ok: shown?.checks.some(check => check.status === 'failed') ? false : shown?.status === 'success' ? true : null, note: shown ? `${shown.checks.length} проверок` : 'Ран ещё не запускался' }
          ]} />
          {stage.key === selected.key && <>
            <AttemptList ariaLabel="Merge-раны прохода" selectedId={run?.id ?? null} onSelect={setSelectedId}
              attempts={stage.items.map((item, at) => ({ id: item.id, label: `Ран ${at + 1}`, status: mergeStageStatus(item.status), at: item.createdAt, note: item.machineName ?? item.agentId }))} />
            {current && (props.canStart || run?.canRetry) && <section className="new-task-section">
              <h3>Машина merge-рана</h3>
              {machines.error && <ErrorState compact message="Не удалось загрузить машины для merge" detail={machines.error} onRetry={() => void machines.refresh()} />}
              {!machines.data && machines.loading && <Skeleton variant="block" height={54} />}
              {machines.data && <label>Машина<select aria-label="Машина merge-рана" value={chosen} onChange={event => setAgentId(event.target.value)} disabled={busy}>
                <option value="" disabled>Выберите готовую машину</option>
                {machines.data.task.machines.map(machine => {
                  const status = machines.data!.merge.machines.find(item => item.agentId === machine.agentId)?.readiness
                  return <option key={machine.agentId} value={machine.agentId} disabled={!status?.selectable}>{machine.name} — {status?.message ?? 'Готовность не проверена'}</option>
                })}
              </select></label>}
              {!readiness?.selectable && <p role="status">{readiness?.message ?? 'Нет готовой машины для запуска.'}</p>}
              {props.canStart && props.onStartMerge && <Button variant="primary" loading={busy} disabled={!readiness?.selectable || Boolean(props.activeRunId)} onClick={() => void act(async () => { await props.onStartMerge!(chosen) })}>Мерж в main</Button>}
              {run?.canRetry && <Button loading={busy} disabled={!readiness?.selectable || Boolean(props.activeRunId)} onClick={() => void act(async () => { const next = await window.ci!.retryMerge(run.id, chosen); setSelectedId(next.id) })}>Повторить</Button>}
            </section>}
            {run ? <>
              <NewMergeRunDetails run={run} />
              {run.canCancel && <Button variant="danger" loading={busy} onClick={() => void act(async () => {
                if (await confirm({ title: 'Остановить ран?', message: 'Текущий merge-ран будет отменён.', variant: 'danger', confirmLabel: 'Остановить' })) await window.ci!.cancelMerge(run.id)
              })}>Отменить</Button>}
            </> : <EmptyState compact icon="🔀" title="Merge-ранов этого цикла ещё не было" description="Ран появится после запуска слияния ветки задачи." />}
          </>}
        </StageCard>
      })}
    </StageRail>
  </div>
}
export function NewMergeRunDetails({ run }: { run: MergeRun }): JSX.Element {
  return <section className="new-task-section" data-testid="new-merge-run-details">
    <MetricTiles items={[{ label: 'Ветка', value: run.sourceBranch }, { label: 'Машина', value: run.machineName ?? run.agentId },
      { label: 'Модель', value: `${run.llmProvider} · ${run.llmModel || 'по умолчанию'}` }]} />
    {run.error && <ErrorState compact message="Merge остановлен" detail={run.error} />}
    {run.conflicts.length > 0 && <ul>{run.conflicts.map(path => <li key={path}>{path}</li>)}</ul>}
    <CheckList checks={run.stages.map(stage => ({ id: stage.stage, title: stage.stage, note: stage.message ?? '', ok: stage.status === 'passed' ? true : stage.status === 'failed' ? false : null }))} />
    {run.checks.map(check => <details key={check.name}><summary>{check.name} · {check.status}</summary><FeedLog label={check.name}>{check.output}</FeedLog></details>)}
    <FeedLog label="Лента merge-рана">{run.log || 'Лента этой попытки пуста.'}</FeedLog>
  </section>
}
