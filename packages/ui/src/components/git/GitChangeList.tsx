// Список изменённых файлов рабочей копии. Чекбокс у строки — выбор для коммита,
// клик по названию открывает файл справа.
//
// Список — `role="list"` с `listitem`, выбранная строка помечается `aria-current`
// (не `aria-selected`: внутри строки живут чекбокс и кнопка, и роль `option` там
// невозможна). Скелетон, пустота и ошибка рисуются вызывающим — вне `role=list`.
import type { GitFileChange } from '@shared/gitWorkspace'
import { gitChangeLabel, gitChangeOrder, gitChangeShort } from './gitLabels'

export interface GitChangeListProps {
  changes: GitFileChange[]
  selectedPath: string | null
  /** Выбранные для коммита пути; пусто — коммитить нечего. */
  checked: ReadonlySet<string>
  /** Правка запрещена (read-only машина, занятый раном каталог) — чекбоксов нет. */
  writable: boolean
  /** Пути с несохранёнными черновиками — помечаются точкой, чтобы правка не пропала из виду. */
  dirtyPaths?: ReadonlySet<string>
  onSelect: (path: string) => void
  onToggle: (path: string, next: boolean) => void
}

export function GitChangeList({ changes, selectedPath, checked, writable, dirtyPaths, onSelect, onToggle }: GitChangeListProps): JSX.Element {
  const sorted = [...changes].sort((a, b) => gitChangeOrder(a.state) - gitChangeOrder(b.state) || a.path.localeCompare(b.path))
  return (
    <ul className="gitpane-changes" role="list" data-testid="git-change-list">
      {sorted.map((change) => (
        <li
          key={change.path}
          role="listitem"
          className={change.path === selectedPath ? 'gitpane-change gitpane-change--active' : 'gitpane-change'}
          {...(change.path === selectedPath ? { 'aria-current': 'true' as const } : {})}
        >
          {writable && (
            <label className="gitpane-change-pick">
              <input
                type="checkbox"
                checked={checked.has(change.path)}
                onChange={(event) => onToggle(change.path, event.target.checked)}
                aria-label={`Включить ${change.path} в коммит`}
              />
            </label>
          )}
          <button type="button" className="gitpane-change-open" onClick={() => onSelect(change.path)}>
            <span className={`gitpane-change-mark gitpane-change-mark--${change.state}`} aria-hidden="true">{gitChangeShort(change.state)}</span>
            <span className="gitpane-change-path">{change.path}</span>
            {dirtyPaths?.has(change.path) && <span className="gitpane-change-dirty" title="Есть несохранённая правка">●</span>}
            <span className="gitpane-change-state">{gitChangeLabel(change.state)}{change.staged ? ' · в индексе' : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
