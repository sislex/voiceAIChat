// Создание проекта: имя + выбор типа каскадом по уровням дерева.
//
// Раньше проект заводился инлайн-полем в сайдбаре, которое закрывалось по onBlur;
// селект туда вставить нельзя — переход фокуса в него закрывал бы форму. Поэтому
// окно: у Dialog есть ловушка фокуса, Esc и полный экран на телефоне.
//
// Каскад строится от корней вглубь: выбрал «Разработка ПО» — появился следующий
// уровень с его детьми. «— не уточнять —» допустимо: проект можно привязать к
// любому узлу, не обязательно к листу.
import { useMemo, useState } from 'react'
import { Button, Dialog } from '@voicechat/ui-kit'
import {
  PROJECT_FEATURES,
  PROJECT_FEATURE_LABELS,
  compareProjectTypes,
  resolveProjectTypeFeatures,
  type ProjectTypeNode
} from '@shared/projectTypes'
import type { ProjectQuota } from '@shared/projects'

/** Короткие подписи чипов: длинные пояснения остаются в tooltip. */
const FEATURE_CHIPS: Record<(typeof PROJECT_FEATURES)[number], string> = {
  git: 'git',
  machines: 'машины',
  ci: 'CI',
  qa: 'QA',
  releases: 'релизы',
  preview: 'превью'
}

export interface NewProjectDialogProps {
  types: ProjectTypeNode[]
  /** Создание: имя уже обрезано, тип — id выбранного узла (или undefined). */
  onCreate: (name: string, typeId?: string) => void | Promise<void>
  onClose: () => void
  busy?: boolean
  quota?: ProjectQuota | null
}

/**
 * Уровни каскада: корни, затем дети выбранного на предыдущем уровне.
 *
 * Порядок внутри уровня: сначала встроенные — в том порядке, в каком объявлены
 * (основной тип «Разработка ПО» должен стоять первым, а не как выйдет по
 * алфавиту), затем пользовательские по имени.
 */
export function typeCascadeLevels(types: ProjectTypeNode[], selected: string[]): ProjectTypeNode[][] {
  const childrenOf = (parentId: string | null): ProjectTypeNode[] =>
    types.filter((t) => t.parentId === parentId).sort(compareProjectTypes)
  const levels: ProjectTypeNode[][] = [childrenOf(null)]
  for (const id of selected) {
    if (!id) break
    const next = childrenOf(id)
    if (!next.length) break
    levels.push(next)
  }
  return levels
}

export function NewProjectDialog({ types, onCreate, onClose, busy = false, quota = null }: NewProjectDialogProps): JSX.Element {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const levels = useMemo(() => typeCascadeLevels(types, selected), [types, selected])
  // Действующий тип — самый глубокий выбранный узел.
  const activeId = [...selected].reverse().find(Boolean)
  const active = types.find((t) => t.id === activeId) ?? null
  const chain = useMemo(() => {
    const out: ProjectTypeNode[] = []
    let current = active
    while (current) {
      out.unshift(current)
      current = current.parentId ? types.find((t) => t.id === current!.parentId) ?? null : null
    }
    return out
  }, [active, types])
  const features = useMemo(() => resolveProjectTypeFeatures(chain), [chain])
  const enabled = PROJECT_FEATURES.filter((feature) => features[feature])
  const quotaReached = Boolean(quota && !quota.unlimited && quota.owned >= quota.limit)
  const quotaNear = Boolean(quota && !quota.unlimited && !quotaReached && quota.owned + 1 >= quota.limit)

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed || busy || quotaReached) return
    void onCreate(trimmed, activeId)
  }

  return (
    <Dialog
      title="Новый проект"
      size="md"
      onClose={onClose}
      closeOnOverlay={false}
      testId="new-project-dialog"
      padded
      footer={
        <div className="newproj-actions">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <div>
            {(quotaReached || quotaNear) && <p className="fsub" role="status">{quotaReached ? `Лимит исчерпан: ${quota!.owned} из ${quota!.limit} проектов. Удалите ненужный проект или обратитесь к администратору.` : `Осталось одно место: ${quota!.owned} из ${quota!.limit} проектов.`}</p>}
            <Button onClick={submit} loading={busy} disabled={!name.trim() || quotaReached} title={quotaReached ? 'Квота собственных проектов исчерпана' : undefined}>Создать</Button>
          </div>
        </div>
      }
    >
      <div className="newproj">
        <label className="newproj-field">
          <span className="newproj-label">Название</span>
          <input
            className="login-input"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
            placeholder="Например, Редизайн лендинга"
          />
        </label>

        {levels.map((options, depth) => (
          <label className="newproj-field" key={depth}>
            <span className="newproj-label">{depth === 0 ? 'Тип проекта' : 'Уточнение'}</span>
            <select
              className="login-input"
              value={selected[depth] ?? ''}
              onChange={(event) => {
                const value = event.target.value
                // Смена уровня сбрасывает всё, что было выбрано глубже.
                setSelected([...selected.slice(0, depth), value].filter((_, i) => i <= depth))
              }}
            >
              <option value="">{depth === 0 ? '— выберите тип —' : '— не уточнять —'}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
        ))}

        {active && (
          <div className="newproj-summary" data-testid="new-project-type-summary">
            {active.description && <p className="newproj-desc">{active.description}</p>}
            {/* Возможности — чипами, а не прозой: иначе строка дублирует описание. */}
            <ul className="newproj-features" role="list">
              {enabled.length
                ? enabled.map((feature) => (
                    <li key={feature} className="newproj-chip" title={PROJECT_FEATURE_LABELS[feature]}>
                      {FEATURE_CHIPS[feature]}
                    </li>
                  ))
                : <li className="newproj-chip newproj-chip--muted">только доска и задачи</li>}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  )
}
