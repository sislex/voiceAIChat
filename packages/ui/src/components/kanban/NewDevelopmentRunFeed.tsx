import { useEffect, useRef } from 'react'
import { Button, EmptyState, ErrorState, FeedLog, Skeleton, useConfirm } from '@voicechat/ui-kit'
import { isActiveCiStatus } from '@shared/ci'
import { ciLlmLabel, ciStageLabel, ciStatusLabel, fmtDuration } from '../ci/ciFormat'
import { InteractionCard } from '../ci/RunFeed'
import { MetricTiles } from './NewTaskStages'
import { useNewTaskAction, useNewTaskResource } from './useNewTaskResource'

/** New-card feed: one resource and subscription identity per selected run. */
export function NewDevelopmentRunFeed({ runId, onDone }: { runId: string; onDone?: () => void }): JSX.Element {
  const resource = useNewTaskResource(runId, async () => {
    if (!window.ci) throw new Error('Лента недоступна')
    const [detail, log] = await Promise.all([window.ci.getRun(runId), window.ci.getRunLog(runId)])
    return { detail, log }
  })
  const notify = useRef(onDone)
  notify.current = onDone
  const { busy, error, act } = useNewTaskAction(resource.refresh)
  const confirm = useConfirm()
  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    let timer: number | undefined
    const update = (message: { runId: string }) => {
      if (message.runId !== runId || timer !== undefined) return
      timer = window.setTimeout(() => { timer = undefined; void resource.refresh() }, 250)
    }
    bridge.subscribe(runId)
    const off = [bridge.onSnapshot(update), bridge.onRun(update), bridge.onStep(update), bridge.onLog(update),
      bridge.onDone(message => { if (message.runId === runId) { update(message); notify.current?.() } }),
      window.board?.onReconnect?.(() => void resource.refresh())]
    return () => { if (timer !== undefined) window.clearTimeout(timer); bridge.unsubscribe(runId); off.forEach(stop => stop?.()) }
  }, [runId, resource.refresh])
  const detail = resource.data?.detail
  const run = detail?.run
  const active = run ? isActiveCiStatus(run.status) : false
  return <section className="new-task-section" data-testid="new-development-run-feed">
    {(resource.error || error) && <ErrorState compact message="Не удалось обновить ленту" detail={error || resource.error} onRetry={() => void resource.refresh()} />}
    {!detail && resource.loading && <Skeleton variant="list" count={3} />}
    {run && detail && <>
      <h3>{detail.executionLlm ? ciLlmLabel(detail.executionLlm) : `${run.llmProvider} · ${run.llmModel || 'по умолчанию'}`} · {detail.executionLlm?.stage ? ciStageLabel(detail.executionLlm.stage) : run.slotProgress.phase}</h3>
      <MetricTiles items={[{ label: 'Состояние', value: ciStatusLabel(run.status) }, { label: 'Шаги', value: `${run.slotProgress.done}/${run.slotProgress.total}` },
        { label: 'Время', value: fmtDuration(run.durationMs) }]} />
      {run.error && <ErrorState compact message="Ран остановлен" detail={run.error} />}
      {!detail.steps.length && <EmptyState compact icon="⏱" title="Шагов ещё нет" description="Шаги появятся после начала выполнения." />}
      <div className="new-task-feed-steps" aria-live="polite">
        {detail.steps.map(step => <details key={step.id} open={isActiveCiStatus(step.status)}>
          <summary>{step.title} · {ciStatusLabel(step.status)} · {fmtDuration(step.durationMs)}{step.exitCode != null ? ` · exit ${step.exitCode}` : ''}</summary>
          {step.commandSnapshot && <code>{step.commandSnapshot}</code>}
          <FeedLog label={`Вывод шага ${step.title}`}>{resource.data!.log.filter(line => line.stepId === step.id).map(line => line.chunk).join('') || 'Лог шага пуст.'}</FeedLog>
        </details>)}
      </div>
      {(detail.interactions ?? []).map(interaction => <InteractionCard key={interaction.id} interaction={interaction} disabled={!active || busy}
        onAnswer={answer => void act(() => window.ci!.answerInteraction(runId, interaction.id, answer))} />)}
      <div className="new-task-heading-actions">
        {active && <Button size="sm" variant="danger" loading={busy} onClick={() => void act(async () => {
          if (await confirm({ title: 'Остановить активный ран?', message: 'Модель прервёт работу, незавершённые шаги будут отменены.', variant: 'danger', confirmLabel: 'Остановить' })) await window.ci!.cancelRun(runId)
        })}>Отменить</Button>}
        {!active && <Button size="sm" loading={busy} onClick={() => void act(async () => { await window.ci!.retryRun(runId); notify.current?.() })}>Повторить весь воркфлоу</Button>}
        {!active && detail.steps.some(step => step.status === 'failed') && <Button size="sm" loading={busy} onClick={() => void act(() => window.ci!.retryRunFromStep(runId))}>Повторить с упавшего шага</Button>}
      </div>
    </>}
  </section>
}
