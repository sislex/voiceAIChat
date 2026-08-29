import type { AutomatedQaScenario, AutomatedQaScenarioStep } from '@shared/qa'
import type { ProjectDetail } from '@shared/projects'
import type { PreviewAction } from '@shared/previewActions'
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
  onUpdate: (id: string, fields: { automatedQaScenario?: AutomatedQaScenario }) => void
}): JSX.Element {
  const scenario: AutomatedQaScenario = props.detail.automatedQaScenario ?? { startUrl: '', steps: [] }
  const save = (next: AutomatedQaScenario): void => props.onUpdate(props.detail.id, { automatedQaScenario: next })
  const patchStep = (index: number, patch: Partial<AutomatedQaScenarioStep>): void =>
    save({ ...scenario, steps: scenario.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)) })

  return <fieldset className="qa-scenario" aria-label="Сценарий Automated QA">
    <legend>Сценарий браузерной проверки</legend>
    <label>Стартовый адрес<input className="login-input" disabled={!props.isOwner} value={scenario.startUrl} placeholder="http://localhost:5173" onChange={(e) => save({ ...scenario, startUrl: e.target.value })} /></label>
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
