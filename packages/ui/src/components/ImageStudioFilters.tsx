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
  /** Вес отобранного человеческой строкой: чистят место именно по нему. */
  shownBytes: string | null
  /** Условия отбора словами — тултипом на счётчике; null — условий нет. */
  conditions: string | null
  /** Отбор по весу файла: место в галерее кончается из-за крупных. */
  heavy: '' | '1' | '5'
  onHeavy: (value: '' | '1' | '5') => void
  /** Сколько условий включено; 0 — кнопки сброса нет. */
  activeCount: number
  onReset: () => void
  /** Селект происхождения нужен, только если есть и то, и другое. */
  showOrigin: boolean
  origin: '' | 'ai' | 'own' | 'derived'
  onOrigin: (value: '' | 'ai' | 'own' | 'derived') => void
  /** Отбор по пометкам: только с заметкой, только черновики, только готовые. */
  mark: '' | 'noted' | 'draft' | 'ready' | 'none'
  onMark: (value: '' | 'noted' | 'draft' | 'ready' | 'none') => void
  /** Имена сохранённых наборов: отбор «только файлы набора». */
  setNames: string[]
  setFilter: string
  onSetFilter: (value: string) => void
  /** Ориентация по известным размерам превью. */
  shape: '' | 'square' | 'portrait' | 'landscape'
  onShape: (value: '' | 'square' | 'portrait' | 'landscape') => void
  /** Сколько видно из общего числа: показывается, когда часть скрыта. */
  shown: number
  total: number
  /** Появилось за последние сутки; 0 — кнопки нет. */
  dayCount: number
  dayOnly: boolean
  onDayOnly: () => void
  /** Появилось с прошлого визита; 0 — кнопки нет. */
  missed: number
  sinceVisitOnly: boolean
  onSinceVisitOnly: () => void
  grouped: boolean
  onGrouped: () => void
  /** Свернуть или развернуть все группы разом; null — группы выключены. */
  onFoldAll: (() => void) | null
  allFolded: boolean
  /** Появилось за эту сессию (бейдж «новое»). */
  freshCount: number
  freshOnly: boolean
  onFreshOnly: () => void
  /** Расширения, которые реально есть в галерее. */
  kinds: string[]
  kind: string
  onKind: (value: string) => void
  orderLabel: string
  /** `reverse` — нажали с Shift: развернуть нынешний порядок. */
  onOrderNext: (reverse: boolean) => void
}

export function ImageStudioFilters({
  showSearch, searchRef, query, onQuery, found, shownBytes, conditions, heavy, onHeavy, activeCount, onReset,
  showOrigin, origin, onOrigin, mark, onMark, setNames, setFilter, onSetFilter, shape, onShape, shown, total,
  dayCount, dayOnly, onDayOnly, missed, sinceVisitOnly, onSinceVisitOnly,
  grouped, onGrouped, onFoldAll, allFolded, freshCount, freshOnly, onFreshOnly, kinds, kind, onKind,
  orderLabel, onOrderNext
}: Props): JSX.Element {
  return <>
    {showSearch && <span className="image-studio-search">
      <input
        ref={searchRef}
        aria-label="Фильтр по имени файла или промпту"
        placeholder="Найти по имени или промпту… (/)"
        // Синтаксис виден только тому, кто наведёт мышь, — зато он есть где
        // прочитать: без подсказки о кавычках и минусе никто не догадается.
        title={'Слова — через И\n"в кавычках" — точная фраза\n-слово — исключить\nEsc — очистить'}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          // Esc в поиске очищает запрос, а не закрывает панель: закрывать тут
          // нечего, а очистка — самое частое следующее действие.
          if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); onQuery('') }
        }}
      />
      {query && <button type="button" className="image-studio-search-clear" aria-label="Очистить поиск" title="Очистить (Esc)" onClick={() => onQuery('')}>×</button>}
    </span>}
    {/* Тултип объясняет, почему видно не всё: семь условий вспомнить труднее,
        чем прочитать. */}
    {found !== null && <span className="image-studio-dim" title={conditions ?? undefined}>Найдено: {found}{shownBytes ? ` · ${shownBytes}` : ''}</span>}
    {found === null && shown < total && <span className="image-studio-dim" title={conditions ?? undefined}>Показано {shown} из {total}{shownBytes ? ` · ${shownBytes}` : ''}</span>}
    {activeCount > 0 && <Button size="sm" variant="ghost" title="Снять все условия поиска и фильтров" onClick={onReset}>
      Сбросить фильтры ({activeCount})
    </Button>}
    {showOrigin && <select aria-label="Происхождение файла" value={origin} onChange={(event) => onOrigin(event.target.value as '' | 'ai' | 'own' | 'derived')}>
      <option value="">Откуда: все</option>
      <option value="ai">Нарисованные</option>
      <option value="own">Свои файлы</option>
      <option value="derived">Производные</option>
    </select>}
    {setNames.length > 0 && <select aria-label="Набор файлов" value={setFilter} onChange={(event) => onSetFilter(event.target.value)}>
      <option value="">Набор: любой</option>
      {setNames.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>}
    <select aria-label="Пометки файла" value={mark} onChange={(event) => onMark(event.target.value as '' | 'noted' | 'draft' | 'ready' | 'none')}>
      <option value="">Пометки: любые</option>
      <option value="noted">С заметкой</option>
      <option value="draft">Черновики</option>
      <option value="ready">Готовые</option>
      <option value="none">Неразобранное</option>
    </select>
    {dayCount > 0 && <Button size="sm" variant="ghost" aria-pressed={dayOnly} title="Только то, что появилось за последние сутки" onClick={onDayOnly}>
      {dayOnly ? 'Все файлы' : `За сутки (${dayCount})`}
    </Button>}
    {missed > 0 && <Button size="sm" variant="ghost" aria-pressed={sinceVisitOnly} title="Появилось после вашего прошлого визита в этот чат" onClick={onSinceVisitOnly}>
      {sinceVisitOnly ? 'Все файлы' : `С прошлого визита (${missed})`}
    </Button>}
    <Button size="sm" variant="ghost" aria-pressed={grouped} title="Разбить сетку на «Сегодня», «Вчера» и «Раньше»" onClick={onGrouped}>
      {grouped ? 'Без групп' : 'По датам'}
    </Button>
    {onFoldAll && <Button size="sm" variant="ghost" title={allFolded ? 'Развернуть все группы' : 'Свернуть все группы'} onClick={onFoldAll}>
      {allFolded ? 'Развернуть все' : 'Свернуть все'}
    </Button>}
    {freshCount > 0 && <Button size="sm" variant="ghost" aria-pressed={freshOnly} title="Только то, что появилось за эту сессию" onClick={onFreshOnly}>
      {freshOnly ? 'Все файлы' : `Только новое (${freshCount})`}
    </Button>}
    {/* Честно предупреждаем в тултипе: форма известна только у загруженных
        превью, и файлы с неизвестным размером фильтр не скрывает — иначе
        сетка пустела бы на каждой прокрутке. */}
    <select
      aria-label="Ориентация картинки"
      title="Форма считается по загруженному превью; файлы с неизвестным размером остаются видимыми"
      value={shape}
      onChange={(event) => onShape(event.target.value as '' | 'square' | 'portrait' | 'landscape')}
    >
      <option value="">Форма: любая</option>
      <option value="square">Квадратные</option>
      <option value="portrait">Портрет</option>
      <option value="landscape">Пейзаж</option>
    </select>
    <select aria-label="Вес файла" title="Крупные файлы съедают квоту галереи быстрее всего" value={heavy} onChange={(event) => onHeavy(event.target.value as '' | '1' | '5')}>
      <option value="">Вес: любой</option>
      <option value="1">Больше 1 МБ</option>
      <option value="5">Больше 5 МБ</option>
    </select>
    {kinds.length > 1 && <select aria-label="Тип файла" value={kind} onChange={(event) => onKind(event.target.value)}>
      <option value="">Тип: все</option>
      {kinds.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
    </select>}
    <Button size="sm" variant="ghost" title="Сменить порядок · Shift+клик — развернуть нынешний" onClick={(event) => onOrderNext(event.shiftKey)}>{orderLabel}</Button>
  </>
}
