import { useCallback, useEffect, useState } from 'react'
import { formatDateTime } from '../../lib/dateFormat'
import type { AnyQaStageRun, QaRunStage } from '@shared/qa'
import { AttemptHistory, Button, EmptyState, ErrorState, FeedItem, FeedLog, GateList, MetricGrid, PanelHeading, ProgressTrack, QaScore, ResultTable, StatusPill } from '@voicechat/ui-kit'
import { qaRunTone, qaStepTone, stageRunTone } from './qaTone'
import { useQaStageUpdates } from './useQaStageUpdates'
import { parseAutomatedQaVerdict, scenarioLabel, QA_RUN_STATUS_LABELS, QA_STAGE_RUN_STATUS_LABELS, QA_STEP_STATUS_LABELS } from '@shared/qa'
import { Skeleton } from '@voicechat/ui-kit'

const CLASSIFICATION_LABEL = {
  implementation_defect: 'Дефект реализации — задача уходит на доработку',
  infrastructure: 'Инфраструктурный сбой — автопроход остановлен, задача не возвращается'
} as const
const STEP_LABEL = { passed: 'пройден', failed: 'провален', skipped: 'пропущен' } as const

/**
 * Вердикт этапа человеку. Раньше здесь лежал `JSON.stringify(result)`: отладочный
 * дамп вместо ответа на вопрос «что сломалось и кто виноват». Старые раны хранят
 * в `result` только `{gatePassed}` — для них вердикта нет, и это честно сказано.
 */
function AutomatedQaVerdictView(props: { result: Record<string, unknown> }): JSX.Element {
  const verdict = parseAutomatedQaVerdict(props.result)
  if (!verdict) return <section><h4>Результат</h4><pre>{JSON.stringify(props.result, null, 2)}</pre></section>
  const shownAtSteps = new Set(verdict.steps.flatMap((step) => step.pageErrors ?? []))
  const restPageErrors = (verdict.pageErrors ?? []).filter((item) => !shownAtSteps.has(item))
  return <section className="qa-verdict" data-testid="qa-verdict">
    <h4>Вердикт</h4>
    <p className={`qa-verdict__summary qa-verdict__summary--${verdict.passed ? 'passed' : 'failed'}`}>{verdict.summary}</p>
    {verdict.classification && <p className="qa-verdict__cause">{CLASSIFICATION_LABEL[verdict.classification]}</p>}
    <dl className="qa-verdict__facts">
      <dt>Режим</dt><dd>{verdict.mode === 'playwright' ? 'сценарий в браузере' : 'команда в воркспейсе'}</dd>
      <dt>{verdict.mode === 'playwright' ? 'Стартовый адрес' : 'Команда'}</dt><dd><code>{verdict.command}</code></dd>
      {verdict.exitCode !== null && <><dt>Код выхода</dt><dd>{verdict.exitCode}</dd></>}
      <dt>Длительность</dt><dd>{Math.round(verdict.durationMs / 1000)} с</dd>
    </dl>
    {verdict.steps.length > 0 && <ol className="qa-verdict__steps">{verdict.steps.map((step) => (
      <li key={step.id} data-status={step.status}>
        {step.title} — {STEP_LABEL[step.status]}{step.detail && <>: {step.detail}</>}
        {/* Ошибки, появившиеся именно на этом шаге: за весь прогон было не
            понять, какое действие сломало страницу. */}
        {step.pageErrors && step.pageErrors.length > 0 && (
          <ul className="qa-verdict__step-errors">{step.pageErrors.map((item, at) => <li key={`${at}-${item.slice(0, 40)}`}>{item}</li>)}</ul>
        )}
      </li>
    ))}</ol>}
    {/* Ошибки страницы стоят перед снимком: обычно они и есть ответ, а снимок
        только подтверждает. Провалом сами по себе не считаются — страница может
        ругаться на постороннее. */}
    {/* Остаток: ошибки, не привязанные ни к одному шагу (прилетели после
        последнего) или пришедшие из старого рана без разбивки по шагам. */}
    {restPageErrors.length > 0 && (
      <div className="qa-verdict__page-errors">
        <h5>{verdict.steps.some((step) => step.pageErrors?.length) ? 'Ошибки вне шагов' : 'Ошибки на странице'}</h5>
        <ul>{restPageErrors.map((item, index) => <li key={`${index}-${item.slice(0, 40)}`}>{item}</li>)}</ul>
      </div>
    )}
    {verdict.screenshotUrl && <a className="qa-verdict__shot" href={verdict.screenshotUrl} target="_blank" rel="noreferrer"><img src={verdict.screenshotUrl} alt="Снимок экрана в момент вердикта" /></a>}
    {verdict.logTail && <details><summary>Хвост вывода</summary><pre>{verdict.logTail}</pre></details>}
  </section>
}

const LABEL: Record<QaRunStage, string> = {
  component_qa: 'Component QA',
  integration_tests: 'Интеграционные тесты',
  automated_qa: 'Automated QA'
}

function IntegrationTestPanel(props:{projectId:string;taskId:string}):JSX.Element {
  const [state,setState]=useState<import('@shared/qa').IntegrationTestTaskState|null>(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const load=useCallback(async()=>{if(!window.qa?.getIntegration)return;try{const next=await window.qa.getIntegration(props.projectId,props.taskId);setState((current)=>{if(!current||!next)return next;const a=current.latestRun?.finishedAt??current.latestRun?.startedAt??current.latestRun?.createdAt??0,b=next.latestRun?.finishedAt??next.latestRun?.startedAt??next.latestRun?.createdAt??0;return b>=a?next:current});setError('')}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}},[props.projectId,props.taskId])
  useEffect(()=>{void load()},[load])
  useQaStageUpdates({ projectId: props.projectId, taskId: props.taskId, stage: 'integration_tests', onUpdate: () => void load(), active: Boolean(state?.activeRun) })
  if(!window.qa?.getIntegration)return <section>
    <EmptyState compact icon="🧪" title="Стадия недоступна" description="Мост QA не подключён в этой сборке." testId="integration-unavailable" />
  </section>
  if(!state)return <section>
    <span className="vc-sr-only" aria-live="polite">Загрузка интеграционных автотестов…</span>
    <Skeleton variant="list" count={3} item="block" height={64} gap={10} />
  </section>
  const run=state.latestRun
  const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();await load()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <section className="qa-stage-panel" aria-label="Интеграционные автотесты">
    <PanelHeading
      kicker={run?`Попытка ${run.attempt}`:'Интеграционные тесты'}
      title="Интеграционные автотесты"
      description="Генерация и прогон сценариев между UI и API."
      actions={run&&<StatusPill tone={qaRunTone(run.status)}>{QA_RUN_STATUS_LABELS[run.status]}</StatusPill>}
    />
    {error&&<ErrorState compact message="Не удалось обновить интеграционные автотесты" detail={error} onRetry={()=>void load()} />}
    {state.launchReasons.length>0&&<ErrorState compact message="Запуск недоступен" detail={state.launchReasons.join('; ')} testId="integration-blocked" />}
    {run&&<>
      <MetricGrid
        testId="integration-summary"
        items={[
          { label: 'Ветка', value: run.branch, title: run.branch },
          { label: 'SHA', value: run.commitSha.slice(0, 8), title: run.commitSha },
          { label: 'Команд', value: String(run.commands.length) }
        ]}
      />
      {run.commands.length>0&&<QaScore
        passed={run.commands.filter((command)=>command.status==='passed').length}
        total={run.commands.length}
        unit="команд"
        testId="integration-score"
      />}
      {run.blockerReasons.length>0&&<ErrorState compact message="Прогон заблокирован" detail={run.blockerReasons.join('; ')} />}
      <ResultTable
        caption="Тест-кейсы"
        resultLabel="Автоматизация"
        rows={run.testCases.map((item)=>({
          id: item.id,
          name: item.title,
          tone: item.automatable?'success':'neutral' as const,
          result: item.automatable?'автоматизируемый':'исключён',
          detail: item.automationLinks.filter((link)=>link.commitSha===run.commitSha).map((link)=><a key={link.testId+link.path} href={link.path}>{link.path}</a>)
        }))}
      />
      <div className="vc-feed">
        {run.commands.map((command)=><FeedItem
          key={command.commandId}
          tone={qaStepTone(command.status)}
          title={command.name}
          meta={`${QA_STEP_STATUS_LABELS[command.status]} · exit ${command.exitCode??'—'} · ${command.durationMs} мс`}
        >
          <FeedLog label={`Лог команды ${command.name}`}>{`$ ${command.command}\n${command.stdout}${command.stderr}`}</FeedLog>
        </FeedItem>)}
        {run.log&&<FeedItem tone={run.status==='running'?'running':'neutral'} title="Потоковый лог" defaultOpen={run.status==='running'}>
          <FeedLog label="Потоковый лог интеграционных автотестов">{run.log}</FeedLog>
        </FeedItem>}
      </div>
      {run.summary&&<p className="ci-task-hint"><strong>Итог:</strong> {run.summary}</p>}</>}
    <div className="qa-stage-actions"><Button size="sm" disabled={busy||!state.canStart} onClick={()=>void act(()=>window.qa!.startIntegration!(props.projectId,props.taskId))}>Запустить</Button>
      {state.activeRun&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.cancelIntegration!(props.projectId,props.taskId,state.activeRun!.id))}>Отменить</Button>}
      {run?.canRetry&&<Button size="sm" disabled={busy||!!state.activeRun} onClick={()=>void act(()=>window.qa!.startIntegration!(props.projectId,props.taskId))}>Повторить</Button>}
      {run&&['failed','blocked'].includes(run.status)&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>window.qa!.fixIntegration!(props.projectId,props.taskId,run.id))}>Отправить на доработку</Button>}
      {run&&<Button size="sm" disabled={busy||!state.canComplete} onClick={()=>void act(()=>window.qa!.completeIntegration!(props.projectId,props.taskId,run.id))}>Перейти к Automated QA</Button>}</div>
    {state.runs.length>0&&<AttemptHistory
      testId="integration-history"
      selectedId={run?.id}
      attempts={state.runs.map((item)=>({
        id: item.id,
        attempt: item.attempt,
        status: QA_RUN_STATUS_LABELS[item.status],
        tone: qaRunTone(item.status)
      }))}
    />}
  </section>
}

function GenericQaStageRunPanel(props: { projectId: string; taskId: string; stage: QaRunStage }): JSX.Element {
  const [runs, setRuns] = useState<AnyQaStageRun[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const load = useCallback(async () => {
    if (!window.qa?.listStageRuns) return
    try { setRuns(await window.qa.listStageRuns(props.projectId, props.taskId, props.stage)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [props.projectId, props.taskId, props.stage])
  useEffect(() => { void load() }, [load])
  const stageActive = ['running', 'queued', 'awaiting_input'].includes(runs[0]?.status ?? '')
  useQaStageUpdates({ projectId: props.projectId, taskId: props.taskId, stage: props.stage, onUpdate: () => void load(), active: stageActive, intervalMs: 1500 })
  const run = runs[0]
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try { await fn(); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="qa-stage-run qa-stage-panel" data-testid={`qa-stage-${props.stage}`}>
    {/* Раньше здесь печатался сырой `run.status` — «running» и «failed» в русской
        карточке читались как отладочный вывод. Статус — лозенга с подписью. */}
    <PanelHeading
      kicker={run ? `Попытка ${run.attempt}` : LABEL[props.stage]}
      title={LABEL[props.stage]}
      description={run ? run.currentStep || 'Ожидание' : 'Этап ещё не запускался.'}
      actions={<>
        {run && <StatusPill tone={stageRunTone(run.status)}>{QA_STAGE_RUN_STATUS_LABELS[run.status]}</StatusPill>}
        {!run?.canCancel && window.qa?.startStageRun && <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(() => window.qa!.startStageRun!(props.projectId, props.taskId, props.stage))}>Запустить</Button>}
        {run?.canCancel && window.qa?.cancelStageRun && <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(() => window.qa!.cancelStageRun!(run.id))}>Отменить</Button>}
        {run?.canRetry && window.qa?.retryStageRun && <Button size="sm" disabled={busy} onClick={() => void act(() => window.qa!.retryStageRun!(run.id))}>{run.scenarios?.length ? 'Повторить те же сценарии' : 'Повторить'}</Button>}
      </>}
    />
    {error && <ErrorState compact message="Не удалось обновить этап" detail={error} onRetry={() => void load()} />}
    {!run && <EmptyState compact icon="🧪" title="Запусков этого этапа ещё нет" description="Ран появится, когда задача дойдёт до этого этапа." testId={`qa-stage-empty-${props.stage}`} />}
    {run && <>
      <MetricGrid
        testId={`qa-stage-summary-${props.stage}`}
        items={[
          { label: 'Ветка', value: run.branch || 'не задана', title: run.branch || undefined },
          { label: 'SHA', value: run.commitSha ? run.commitSha.slice(0, 8) : '—', title: run.commitSha || undefined },
          { label: 'Шаг', value: `${run.progress.current}/${run.progress.total} ${run.progress.label}` }
        ]}
      />
      {/* Безымянный `<progress>` скринридер объявляет как «индикатор» без всякого
          «чего»: у прогресса этапа теперь есть имя. */}
      <ProgressTrack
        value={run.progress.current}
        max={Math.max(1, run.progress.total)}
        label={`Прогресс этапа: ${run.progress.label || LABEL[props.stage]}`}
        tone={stageRunTone(run.status)}
      />
      {run.gateReasons.length > 0 && <GateList
        ariaLabel="Непройденные условия quality gate"
        testId={`qa-stage-gates-${props.stage}`}
        checks={run.gateReasons.map((reason) => ({ id: reason, name: reason, verdict: 'Не пройдено', tone: 'danger' as const }))}
      />}
      {run.error && <ErrorState compact message="Этап остановлен" detail={run.error} />}
      {run.result && <AutomatedQaVerdictView result={run.result} />}
      {run.scenarios && run.scenarios.length > 0 && (
        <details className="qa-verdict__scenario">
          <summary>Что прогонялось: сценариев {run.scenarios.length}, шагов {run.scenarios.reduce((sum, item) => sum + item.steps.length, 0)}</summary>
          {run.scenarios.map((scenario, index) => (
            <div key={scenarioLabel(scenario, index)}>
              <strong>{scenarioLabel(scenario, index)}</strong> <code>{scenario.startUrl}</code>
              <ol>{scenario.steps.map((step) => <li key={step.id}>{step.title}</li>)}</ol>
            </div>
          ))}
        </details>
      )}
      {/* Лента была набором `div`-ов без имени и без клавиатуры: прокрутить её
          с клавиатуры было нельзя. */}
      <div className="vc-feed">
        <FeedItem tone={run.status === 'running' ? 'running' : 'neutral'} title="Потоковая лента" defaultOpen={run.status === 'running'}>
          <FeedLog label={`Потоковая лента ${LABEL[props.stage]}`}>{run.log.map((line) => line.text).join('\n') || 'Лента пуста.'}</FeedLog>
        </FeedItem>
      </div>
      {run.status === 'awaiting_input' && props.stage === 'integration_tests' && window.qa?.answerStageRun && <form className="qa-stage-answer" onSubmit={(event) => { event.preventDefault(); void act(async () => { await window.qa!.answerStageRun!(run.id, answer); setAnswer('') }) }}><label>Ответ модели<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} /></label><Button size="sm" type="submit" disabled={busy || !answer.trim()}>Отправить</Button></form>}
    </>}
    {runs.length > 0 && <AttemptHistory
      testId={`qa-stage-history-${props.stage}`}
      attempts={runs.map((item) => ({
        id: item.id,
        attempt: item.attempt,
        status: QA_STAGE_RUN_STATUS_LABELS[item.status],
        tone: stageRunTone(item.status),
        at: formatDateTime(item.createdAt)
      }))}
    />}
  </div>
}
export function QaStageRunPanel(props:{projectId:string;taskId:string;stage:QaRunStage}):JSX.Element {
  return props.stage==='integration_tests'?<IntegrationTestPanel projectId={props.projectId} taskId={props.taskId}/>:<GenericQaStageRunPanel {...props}/>
}
