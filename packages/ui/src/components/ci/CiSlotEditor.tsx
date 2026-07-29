// Упорядоченный мультиселект команд для слота (до/после). Команда может
// повторяться; порядок = порядок выполнения (перестановка ▲▼, удаление ✕).
// Стиль — токены темы, без хардкода цветов.
import type { JSX } from 'react'
import type { CiCommand } from '@shared/ci'

export interface CiSlotEditorProps {
  label: string
  commands: CiCommand[]
  value: string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}

export function CiSlotEditor(props: CiSlotEditorProps): JSX.Element {
  const nameOf = (id: string): string => props.commands.find((c) => c.id === id)?.name ?? '— удалена —'
  const move = (i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= props.value.length) return
    const next = props.value.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    props.onChange(next)
  }
  const remove = (i: number): void => props.onChange(props.value.filter((_, k) => k !== i))
  const add = (id: string): void => { if (id) props.onChange([...props.value, id]) }

  return (
    <div className="ci-slot">
      <div className="ci-slot-label">{props.label}</div>
      <ol className="ci-slot-list">
        {props.value.length === 0 && <li className="ci-slot-empty">Команды не выбраны</li>}
        {props.value.map((id, i) => (
          <li key={`${id}-${i}`} className="ci-slot-item">
            <span className="ci-slot-name">{nameOf(id)}</span>
            {!props.disabled && (
              <span className="ci-slot-actions">
                <button type="button" aria-label="Выше" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                <button type="button" aria-label="Ниже" onClick={() => move(i, 1)} disabled={i === props.value.length - 1}>▼</button>
                <button type="button" aria-label="Убрать" onClick={() => remove(i)}>✕</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {!props.disabled && (
        <select className="sel ci-slot-add" value="" aria-label={`Добавить команду: ${props.label}`} onChange={(e) => { add(e.target.value); e.currentTarget.value = '' }}>
          <option value="">+ Добавить команду…</option>
          {props.commands.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.isCleanup ? ' (cleanup)' : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
}
