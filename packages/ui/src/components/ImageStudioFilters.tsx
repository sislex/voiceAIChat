// Фильтры и порядок галереи студии: поиск, происхождение, тип, новизна,
// сортировка, группировка и сброс. Вынесено из панели — там эта строка
// занимала полторы сотни строк разметки посреди логики. Состояние и запись
// предпочтений остаются у панели: компонент показывает и сообщает о нажатии.
import type { Ref } from 'react'
import { Button } from '@voicechat/ui-kit'

interface Props {
  /** Поле поиска появляется, когда глазами искать уже неудобно. */
  showSearch: boolean
  searchRef: Ref<HTMLInputElement>
  query: string
  onQuery: (value: string) => void
  /** Сколько нашлось; null — запрос пустой и счётчик не нужен. */
  found: number | null
  /** Сколько условий включено; 0 — кнопки сброса нет. */
  activeCount: number
  onReset: () => void
  /** Селект происхождения нужен, только если есть и то, и другое. */
  showOrigin: boolean
  origin: '' | 'ai' | 'own'
  onOrigin: (value: '' | 'ai' | 'own') => void
  /** Появилось с прошлого визита; 0 — кнопки нет. */
  missed: number
  sinceVisitOnly: boolean
  onSinceVisitOnly: () => void
  grouped: boolean
  onGrouped: () => void
  /** Появилось за эту сессию (бейдж «новое»). */
  freshCount: number
  freshOnly: boolean
  onFreshOnly: () => void
  /** Расширения, которые реально есть в галерее. */
  kinds: string[]
  kind: string
  onKind: (value: string) => void
  orderLabel: string
  onOrderNext: () => void
}

export function ImageStudioFilters({
  showSearch, searchRef, query, onQuery, found, activeCount, onReset,
  showOrigin, origin, onOrigin, missed, sinceVisitOnly, onSinceVisitOnly,
  grouped, onGrouped, freshCount, freshOnly, onFreshOnly, kinds, kind, onKind,
  orderLabel, onOrderNext
}: Props): JSX.Element {
  return <>
    {showSearch && <input
      ref={searchRef}
      aria-label="Фильтр по имени файла или промпту"
      placeholder="Найти по имени или промпту… (/)"
      value={query}
      onChange={(event) => onQuery(event.target.value)}
    />}
    {found !== null && <span className="image-studio-dim">Найдено: {found}</span>}
    {activeCount > 0 && <Button size="sm" variant="ghost" title="Снять все условия поиска и фильтров" onClick={onReset}>
      Сбросить фильтры ({activeCount})
    </Button>}
    {showOrigin && <select aria-label="Происхождение файла" value={origin} onChange={(event) => onOrigin(event.target.value as '' | 'ai' | 'own')}>
      <option value="">Откуда: все</option>
      <option value="ai">Нарисованные</option>
      <option value="own">Свои файлы</option>
    </select>}
    {missed > 0 && <Button size="sm" variant="ghost" aria-pressed={sinceVisitOnly} title="Появилось после вашего прошлого визита в этот чат" onClick={onSinceVisitOnly}>
      {sinceVisitOnly ? 'Все файлы' : `С прошлого визита (${missed})`}
    </Button>}
    <Button size="sm" variant="ghost" aria-pressed={grouped} title="Разбить сетку на «Сегодня», «Вчера» и «Раньше»" onClick={onGrouped}>
      {grouped ? 'Без групп' : 'По датам'}
    </Button>
    {freshCount > 0 && <Button size="sm" variant="ghost" aria-pressed={freshOnly} title="Только то, что появилось за эту сессию" onClick={onFreshOnly}>
      {freshOnly ? 'Все файлы' : `Только новое (${freshCount})`}
    </Button>}
    {kinds.length > 1 && <select aria-label="Тип файла" value={kind} onChange={(event) => onKind(event.target.value)}>
      <option value="">Тип: все</option>
      {kinds.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
    </select>}
    <Button size="sm" variant="ghost" onClick={onOrderNext}>{orderLabel}</Button>
  </>
}
