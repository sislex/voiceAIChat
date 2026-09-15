// Форма ответов на уточняющие вопросы модели (блок ```questions в ответе).
// Радио — один вариант, чекбоксы — multi; всегда доступен «свой вариант».
// Кнопка отправки активируется, когда отвечены ВСЕ вопросы.

import { useId, useState } from 'react'
import { Button } from '@voicechat/ui-kit'
import { formatAnswers, type QuestionSpec } from '@shared/questions'

export interface QuestionsFormProps {
  questions: QuestionSpec[]
  /** Отправить собранный текст ответов как реплику пользователя. */
  onSubmit: (text: string) => void
  /** true — форма только для чтения (идёт другой запрос). */
  disabled?: boolean
  draftKey?: string
  onLater?: () => void
}

interface AnswerDraft {
  selected: Set<number>
  custom: string
}

function emptyDrafts(n: number): AnswerDraft[] {
  return Array.from({ length: n }, () => ({ selected: new Set<number>(), custom: '' }))
}

/** Итоговый ответ на вопрос: выбранные варианты + свой текст (через «; »). */
function answerText(q: QuestionSpec, d: AnswerDraft): string {
  const picked = q.options.filter((_, i) => d.selected.has(i))
  const custom = d.custom.trim()
  return [...picked, ...(custom ? [custom] : [])].join('; ')
}

export function QuestionsForm({ questions, onSubmit, disabled = false, draftKey, onLater }: QuestionsFormProps): JSX.Element {
  const formId = useId()
  const [drafts, setDrafts] = useState<AnswerDraft[]>(() => {
    try {
      const saved = draftKey ? JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') : null
      if (Array.isArray(saved) && saved.length === questions.length) return saved.map((item) => ({ selected: new Set<number>(item.selected), custom: String(item.custom ?? '') }))
    } catch { /* A damaged or unavailable session store must not hide questions. */ }
    return emptyDrafts(questions.length)
  })
  const [draftError, setDraftError] = useState<string | null>(null)
  const saveLater = (): void => {
    try {
      if (draftKey) sessionStorage.setItem(draftKey, JSON.stringify(drafts.map((draft) => ({ selected: [...draft.selected], custom: draft.custom }))))
      setDraftError(null)
      onLater?.()
    } catch { setDraftError('Не удалось сохранить черновик. Ответ остаётся в открытой форме.') }
  }

  const update = (qi: number, patch: (d: AnswerDraft) => AnswerDraft): void => {
    setDrafts((prev) => prev.map((d, i) => (i === qi ? patch(d) : d)))
  }

  const toggle = (qi: number, oi: number, multi: boolean): void => {
    update(qi, (d) => {
      const selected = new Set(d.selected)
      if (multi) {
        if (selected.has(oi)) selected.delete(oi)
        else selected.add(oi)
      } else if (selected.has(oi)) {
        selected.delete(oi)
      } else {
        selected.clear()
        selected.add(oi)
      }
      return { ...d, selected }
    })
  }

  const answered = questions.map((q, i) => answerText(q, drafts[i]).length > 0)
  const answeredCount = answered.filter(Boolean).length
  const allAnswered = answeredCount === questions.length

  const submit = (): void => {
    if (!allAnswered || disabled) return
    const text = formatAnswers(questions.map((q, i) => ({ q: q.q, answer: answerText(q, drafts[i]) })))
    if (text) onSubmit(text)
  }

  return (
    <div className="qform" data-testid="questions-form">
      {questions.map((q, qi) => (
        <fieldset className="qitem" key={qi} disabled={disabled}>
          <legend className="qtext">
            {q.q}
            {q.multi && <span className="qhint"> (можно несколько)</span>}
          </legend>
          <div className="qopts">
            {q.options.map((opt, oi) => (
              <label className="qopt" key={oi}>
                <input
                  type={q.multi ? 'checkbox' : 'radio'}
                  name={`${formId}-q${qi}`}
                  checked={drafts[qi].selected.has(oi)}
                  onChange={q.multi ? () => toggle(qi, oi, true) : undefined}
                  onClick={q.multi ? undefined : () => toggle(qi, oi, false)}
                  readOnly={!q.multi}
                />
                <span>{opt}</span>
              </label>
            ))}
            <input
              className="qother"
              type="text"
              placeholder="Свой вариант…"
              aria-label={`Свой вариант: ${q.q}`}
              value={drafts[qi].custom}
              onChange={(e) => update(qi, (d) => ({ ...d, custom: e.target.value }))}
            />
          </div>
        </fieldset>
      ))}
      {draftError && <p role="alert">{draftError}</p>}
      <div className="qfoot">
        {onLater && <Button disabled={disabled} onClick={saveLater}>Ответить позже</Button>}
        <span className="qcount">
          Отвечено {answeredCount} из {questions.length}
        </span>
        <Button variant="primary" disabled={!allAnswered || disabled} onClick={submit}>
          Отправить ответы
        </Button>
      </div>
    </div>
  )
}
