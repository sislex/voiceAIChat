import type { AutomatedQaCheckResult, AutomatedQaScenario, AutomatedQaScenarioStep } from '@shared/qa'
import { automatedQaStartUrlProblem } from '@shared/qa'
import type { ProjectDetail } from '@shared/projects'
import type { PreviewAction } from '@shared/previewActions'
import { useState } from 'react'
import { scenarioLabel } from '@shared/qa'
import { scenarioSetProblems } from '@shared/scenarioStep'
import { Button, IconButton } from '@voicechat/ui-kit'

/**
 * Сценарий этапа Automated QA в режиме Playwright. Хранится в настройках
 * проекта, а не в ране: воспроизводимость нужна между попытками, иначе каждый
 * прогон — новая импровизация, и сравнивать результаты не с чем.
 *
 * Редактор намеренно узкий: четыре действия, которых хватает на проверку
 * «страница открылась, кнопка нажалась, текст появился». Остальной словарь
 * `PreviewAction` доступен модели в Playwright Reader, а не форме настроек.
 */
type StepKind = 'click' | 'type' | 'wait' | 'press'

const KIND_LABEL: Record<StepKind, string> = {
  click: 'Нажать',
  type: 'Ввести текст',
  wait: 'Дождаться',
  press: 'Нажать клавишу'
}

function kindOf(action: PreviewAction): StepKind {
  return action.kind === 'type' || action.kind === 'wait' || action.kind === 'press' ? action.kind : 'click'
}

/** Смена вида действия сохраняет то, что переносится: селектор и текст. */
function withKind(action: PreviewAction, kind: StepKind): PreviewAction {
  const selector = 'selector' in action && typeof action.selector === 'string' ? action.selector : ''
  const text = 'text' in action && typeof action.text === 'string' ? action.text : ''
  if (kind === 'type') return { kind: 'type', selector: selector || 'input', text }
  if (kind === 'wait') return { kind: 'wait', ...(selector ? { selector } : { text }) }
  if (kind === 'press') return { kind: 'press', key: text || 'Enter' }
  return { kind: 'click', ...(selector ? { selector } : {}), ...(text ? { text } : {}) }
}

export function AutomatedQaScenarioEditor(props: {
  detail: ProjectDetail
  isOwner: boolean
  onUpdate: (id: string, fields: { automatedQaScenarios?: AutomatedQaScenario[] }) => void
  /**
   * Разовый прогон набора. Без него сценарий проверялся только задачей на
   * доске: записал — и жди следующего рана, чтобы узнать, работает ли он.
   */
  onCheck?: (id: string) => Promise<AutomatedQaCheckResult[]>
}): JSX.Element {
  // Набор, а не один сценарий: «много автотестов» упиралось именно в это.
  // Правим по одному, выбранный держим локально.
  const scenarios = props.detail.automatedQaScenarios ?? []
  const [activeIndex, setActiveIndex] = useState(0)
  // Новый сценарий живёт черновиком, пока у него нет адреса: в проекте пустой
  // сценарий блокирует весь этап.
  const [draft, setDraft] = useState(false)
  const [draftScenario, setDraftScenario] = useState<AutomatedQaScenario>({ startUrl: '', steps: [] })
  const index = Math.min(activeIndex, Math.max(0, scenarios.length - 1))
  const scenario: AutomatedQaScenario = draft ? draftScenario : (scenarios[index] ?? { startUrl: '', steps: [] })
  const saveAll = (next: AutomatedQaScenario[]): void => props.onUpdate(props.detail.id, { automatedQaScenarios: next })
  const save = (next: AutomatedQaScenario): void => {
    if (draft) {
      setDraftScenario(next)
      // В проект черновик попадает, только когда становится осмысленным.
      if (next.startUrl.trim()) { saveAll([...scenarios, next]); setDraft(false); setActiveIndex(scenarios.length) }
      return
    }
    saveAll(scenarios.length ? scenarios.map((item, at) => (at === index ? next : item)) : [next])
  }
  const setProblems = scenarioSetProblems(scenarios)
  const [checking, setChecking] = useState(false)
  const [checkResults, setCheckResults] = useState<AutomatedQaCheckResult[] | null>(null)
  const [checkError, setCheckError] = useState('')
  const runCheck = async (): Promise<void> => {
    if (!props.onCheck) return
    setChecking(true); setCheckError(''); setCheckResults(null)
    try { setCheckResults(await props.onCheck(props.detail.id)) }
    catch (error) { setCheckError(error instanceof Error ? error.message : 'Проверка не выполнилась') }
    finally { setChecking(false) }
  }
  // Адрес проверяется при вводе: раннер живёт на сервере и в localhost с
  // приватными сетями не ходит, а узнавать об этом через минуты прогона — плохо.
  const urlProblem = automatedQaStartUrlProblem(scenario.startUrl)
  const patchStep = (index: number, patch: Partial<AutomatedQaScenarioStep>): void =>
    save({ ...scenario, steps: scenario.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)) })

  return <fieldset className="qa-scenario" aria-label="Сценарии Automated QA">
    <legend>Сценарии браузерной проверки</legend>
    <div className="qa-scenario__row">
      <label>Сценарий
        <select className="sel" value={draft ? scenarios.length : index} disabled={!props.isOwner || (scenarios.length < 2 && !draft)} onChange={(e) => { const next = Number(e.target.value); setDraft(next === scenarios.length && draft); setActiveIndex(next) }}>
          {(scenarios.length ? scenarios : [scenario]).map((item, at) => <option key={at} value={at}>{scenarioLabel(item, at)}</option>)}
          {draft && <option value={scenarios.length}>новый (не сохранён)</option>}
        </select>
      </label>
      <label>Название<input className="login-input" disabled={!props.isOwner} value={scenario.name ?? ''} placeholder="Вход и доска" onChange={(e) => save({ ...scenario, name: e.target.value })} /></label>
      {/* Черновик держится локально: пустой сценарий, попавший в проект,
          раннер считает ненастроенным и блокирует им весь этап. */}
      <Button size="sm" disabled={!props.isOwner || draft} onClick={() => { setDraft(true); setActiveIndex(scenarios.length) }}>Добавить сценарий</Button>
      {scenarios.length > 1 && (
        <IconButton size="sm" variant="danger" aria-label={`Удалить сценарий «${scenarioLabel(scenario, index)}»`} title="Удалить сценарий" disabled={!props.isOwner}
          onClick={() => { saveAll(scenarios.filter((_, at) => at !== index)); setActiveIndex(0) }}>✕</IconButton>
      )}
    </div>
    <label>Стартовый адрес<input className="login-input" disabled={!props.isOwner} value={scenario.startUrl} placeholder="https://example.com" aria-describedby={urlProblem ? 'qa-scenario-url-problem' : undefined} onChange={(e) => save({ ...scenario, startUrl: e.target.value })} /></label>
    {urlProblem && <p className="qa-scenario__problem" id="qa-scenario-url-problem" role="alert">{urlProblem}</p>}
    {props.onCheck && scenarios.length > 0 && (
      <div className="qa-scenario__check">
        <Button size="sm" disabled={checking || !props.isOwner} onClick={() => void runCheck()}>
          {checking ? 'Прогоняю набор…' : 'Прогнать набор сейчас'}
        </Button>
        {checkError && <span className="qa-scenario__problem" role="alert">{checkError}</span>}
        {checkResults && checkResults.length === 0 && <span className="proj-muted">Прогонять нечего.</span>}
        {checkResults && checkResults.length > 0 && (
          <ul className="qa-scenario__check-list">
            {checkResults.map((result) => (
              <li key={result.name} data-passed={result.passed}>
                {result.name}: {result.blocked ? `заблокирован — ${result.blocked}` : result.passed ? 'пройден' : `провален на шаге «${result.steps.find((step) => step.status === 'failed')?.title ?? '?'}»`}
                {' '}<small>{Math.round(result.durationMs / 100) / 10} с</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
    {setProblems.length > 0 && (
      // Проверка набора целиком: поштучная её не видит — дубли имён и пустые
      // сценарии заметны только вместе.
      // `role="alert"` на самом <ul> перебивает роль списка, и пункты остаются
      // без родителя — тревога живёт на обёртке, список остаётся списком.
      <div role="alert">
        <ul className="qa-scenario__problems">
          {setProblems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      </div>
    )}
    {scenario.steps.length === 0 && <p className="proj-muted">Шагов нет: этап заблокируется, пока сценарий пуст.</p>}
    <ol className="qa-scenario__steps">
      {scenario.steps.map((step, index) => {
        const kind = kindOf(step.action)
        const selector = 'selector' in step.action && typeof step.action.selector === 'string' ? step.action.selector : ''
        const value = step.action.kind === 'type' ? step.action.text : step.action.kind === 'press' ? step.action.key : 'text' in step.action && typeof step.action.text === 'string' ? step.action.text : ''
        return <li key={step.id} className="qa-scenario__step">
          <div className="qa-scenario__row qa-scenario__row--head">
            <span className="qa-scenario__num" aria-hidden="true">{index + 1}</span>
            <label>Название шага<input className="login-input" disabled={!props.isOwner} value={step.title} onChange={(e) => patchStep(index, { title: e.target.value })} /></label>
            <IconButton size="sm" variant="danger" aria-label={`Удалить шаг «${step.title}»`} title={`Удалить шаг «${step.title}»`} disabled={!props.isOwner} onClick={() => save({ ...scenario, steps: scenario.steps.filter((_, at) => at !== index) })}>✕</IconButton>
          </div>
          <div className="qa-scenario__row">
            <label>Действие<select className="sel" disabled={!props.isOwner} value={kind} onChange={(e) => patchStep(index, { action: withKind(step.action, e.target.value as StepKind) })}>{(Object.keys(KIND_LABEL) as StepKind[]).map((item) => <option key={item} value={item}>{KIND_LABEL[item]}</option>)}</select></label>
            {kind !== 'press' && <label>Селектор<input className="login-input" disabled={!props.isOwner} value={selector} placeholder="button[type=submit]" onChange={(e) => patchStep(index, { action: withKind({ ...step.action, selector: e.target.value } as PreviewAction, kind) })} /></label>}
            <label>{kind === 'press' ? 'Клавиша' : kind === 'type' ? 'Текст' : 'Текст на странице'}<input className="login-input" disabled={!props.isOwner} value={value} onChange={(e) => patchStep(index, { action: withKind({ ...step.action, text: e.target.value } as PreviewAction, kind) })} /></label>
          </div>
          <div className="qa-scenario__row">
            <label>Ожидаемый текст<input className="login-input" disabled={!props.isOwner} value={step.expectText ?? ''} onChange={(e) => patchStep(index, { expectText: e.target.value })} /></label>
            <label>Недопустимый текст<input className="login-input" disabled={!props.isOwner} value={step.expectAbsentText ?? ''} onChange={(e) => patchStep(index, { expectAbsentText: e.target.value })} /></label>
          </div>
        </li>
      })}
    </ol>
    <Button size="sm" disabled={!props.isOwner} onClick={() => save({ ...scenario, steps: [...scenario.steps, { id: `step-${scenario.steps.length + 1}-${Date.now()}`, title: `Шаг ${scenario.steps.length + 1}`, action: { kind: 'click', selector: '' } }] })}>Добавить шаг</Button>
  </fieldset>
}
