// Форма ответов на уточняющие вопросы модели (блок ```questions в ответе).
// Радио — один вариант, чекбоксы — multi; всегда доступен «свой вариант».
// Кнопка отправки активируется, когда отвечены ВСЕ вопросы.

import { useState } from 'react'
import { formatAnswers, type QuestionSpec } from '@shared/questions'

export interface QuestionsFormProps {
  questions: QuestionSpec[]
  /** Отправить собранный текст ответов как реплику пользователя. */
  onSubmit: (text: string) => void
  /** true — форма только для чтения (идёт другой запрос). */
  disabled?: boolean
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

export function QuestionsForm({ questions, onSubmit, disabled = false }: QuestionsFormProps): JSX.Element {
  const [drafts, setDrafts] = useState<AnswerDraft[]>(() => emptyDrafts(questions.length))

  const update = (qi: number, patch: (d: AnswerDraft) => AnswerDraft): void => {
    setDrafts((prev) => prev.map((d, i) => (i === qi ? patch(d) : d)))
  }

  const toggle = (qi: number, oi: number, multi: boolean): void => {
    update(qi, (d) => {
      const selected = new Set(d.selected)
      if (multi) {
        if (selected.has(oi)) selected.delete(oi)
        else selected.add(oi)
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
                  name={`q${qi}`}
                  checked={drafts[qi].selected.has(oi)}
                  onChange={() => toggle(qi, oi, q.multi === true)}
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
      <div className="qfoot">
        <span className="qcount">
          Отвечено {answeredCount} из {questions.length}
        </span>
        <button className="qsubmit" disabled={!allAnswered || disabled} onClick={submit}>
          Отправить ответы
        </button>
      </div>
    </div>
  )
}
