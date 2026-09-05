// Действия и вид галереи студии: архив, текстовые выгрузки, поиск дубликатов и
// проверка файлов, вид сетки, избранное, обновление, уведомления, клавиши,
// пометки и корзина. Вынесено из панели — она держала эту разметку посреди
// логики, и читать её приходилось целиком ради одной кнопки. Состояние и все
// побочные эффекты остаются у панели.
import { Button, IconButton } from '@voicechat/ui-kit'

export type GridBackground = 'checker' | 'light' | 'dark'

const BACKGROUND_TITLES: Record<GridBackground, string> = {
  checker: 'шахматка',
  light: 'светлый',
  dark: 'тёмный'
}

interface Props {
  busy: boolean
  /** Сколько файлов видно сейчас: пустой список выключает выгрузки. */
  shownCount: number
  /** Всего файлов в галерее: от двух включаются дубликаты и проверка. */
  totalCount: number
  /** Есть ли среди видимых файлы с промптом. */
  hasPrompts: boolean
  gridBg: GridBackground
  dense: boolean
  starsOnly: boolean
  /** Сколько лежит в корзине; 0 — счётчик не показываем. */
  trashCount: number
  trashOpen: boolean
  /** Разрешение на системные уведомления ещё не спрашивали. */
  canAskNotifications: boolean
  onDownloadArchive: () => void
  onCopyInventory: () => void
  /** Тот же список — файлом .md: буфер обмена не всегда куда вставить. */
  onDownloadInventory: () => void
  onFindDuplicates: () => void
  onVerifyFiles: () => void
  onCopyPrompts: () => void
  onCycleGridBg: () => void
  onToggleDense: () => void
  onToggleStarsOnly: () => void
  onReload: () => void
  onAskNotifications: () => void
  onOpenKeys: () => void
  onOpenMarks: () => void
  /** Сохранённые виды: фильтры и сортировка под именем. */
  onOpenViews: () => void
  /** Сколько видов уже сохранено — показывается на кнопке. */
  viewsCount: number
  /** Ссылка на нынешний отбор; null — условий нет, копировать нечего. */
  onCopyViewLink: (() => void) | null
  /** Запустить показ по нынешнему отбору; null — показывать нечего. */
  onSlideshow: (() => void) | null
  /** Сколько карточек в странице сетки: 60, 120 или 300. */
  pageSize: number
  onPageSize: (value: number) => void
  /** Журнал операций панели; 0 записей — кнопки нет. */
  journalCount: number
  onOpenJournal: () => void
  /** Заметки текстом и контактный лист на печать. */
  hasNotes: boolean
  onCopyNotes: () => void
  onPrint: () => void
  onToggleTrash: () => void
}

export function ImageStudioActions({
  busy, shownCount, totalCount, hasPrompts, gridBg, dense, starsOnly, trashCount, trashOpen,
  canAskNotifications, onDownloadArchive, onCopyInventory, onDownloadInventory, onFindDuplicates, onVerifyFiles,
  onCopyPrompts, onCycleGridBg, onToggleDense, onToggleStarsOnly, onReload, onAskNotifications,
  onOpenKeys, onOpenMarks, onOpenViews, viewsCount, onCopyViewLink,
  onSlideshow, pageSize, onPageSize, journalCount, onOpenJournal, hasNotes, onCopyNotes, onPrint, onToggleTrash
}: Props): JSX.Element {
  const background = BACKGROUND_TITLES[gridBg]
  return <>
    <Button size="sm" variant="ghost" disabled={busy || shownCount === 0} onClick={onDownloadArchive}>Скачать архивом</Button>
    <Button size="sm" variant="ghost" disabled={shownCount === 0} title="Markdown-таблица: имя, размер, пиксели, промпт, заметка" onClick={onCopyInventory}>
      Список в буфер
    </Button>
    <Button size="sm" variant="ghost" disabled={shownCount === 0} title="Тот же список файлом .md" onClick={onDownloadInventory}>Список файлом</Button>
    {totalCount >= 2 && <Button size="sm" variant="ghost" disabled={busy} title="Сравнить содержимое файлов и отметить лишние копии" onClick={onFindDuplicates}>
      Найти дубликаты
    </Button>}
    {totalCount >= 2 && <Button size="sm" variant="ghost" disabled={busy} title="Прочитать все файлы и показать те, что не открываются" onClick={onVerifyFiles}>
      Проверить файлы
    </Button>}
    {hasPrompts && <Button size="sm" variant="ghost" onClick={onCopyPrompts}>Промпты в буфер</Button>}
    <IconButton size="sm" aria-label={`Фон сетки: ${background} — сменить`} title={`Фон сетки: ${background}`} onClick={onCycleGridBg}>◧</IconButton>
    <IconButton size="sm" aria-label={dense ? 'Крупные карточки' : 'Мелкие карточки'} title={dense ? 'Крупнее' : 'Мельче'} onClick={onToggleDense}>
      {dense ? '▦' : '▤'}
    </IconButton>
    <IconButton size="sm" aria-label={starsOnly ? 'Показать все файлы' : 'Показать только избранные'} title={starsOnly ? 'Все файлы' : 'Только избранные'} aria-pressed={starsOnly} onClick={onToggleStarsOnly}>
      {starsOnly ? '★' : '☆'}
    </IconButton>
    {totalCount > 60 && <select aria-label="Карточек на странице" title="Сколько карточек показывать сразу" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
      <option value={60}>Страница: 60</option>
      <option value={120}>Страница: 120</option>
      <option value={300}>Страница: 300</option>
    </select>}
    <IconButton size="sm" aria-label="Обновить галерею" title="Обновить (r)" onClick={onReload}>↻</IconButton>
    {canAskNotifications && <Button size="sm" variant="ghost" title="Показывать системное уведомление, когда картинка готова и вкладка в фоне" onClick={onAskNotifications}>
      Уведомлять…
    </Button>}
    <IconButton size="sm" aria-label="Горячие клавиши галереи" title="Клавиши (?)" onClick={onOpenKeys}>?</IconButton>
    <Button size="sm" variant="ghost" title="Звёзды и заметки текстом: перенести в другой браузер" onClick={onOpenMarks}>Пометки…</Button>
    <Button size="sm" variant="ghost" title="Клавиша v · запомнить нынешние фильтры и сортировку под именем и возвращаться к ним одним нажатием" onClick={onOpenViews}>
      Виды…{viewsCount ? ` (${viewsCount})` : ''}
    </Button>
    {onCopyViewLink && <Button size="sm" variant="ghost" title="Ссылка, которая откроет галерею с этим же отбором — коллеге с доступом" onClick={onCopyViewLink}>
      Ссылка на отбор
    </Button>}
    {hasNotes && <Button size="sm" variant="ghost" title="Все заметки галереи списком в Markdown" onClick={onCopyNotes}>Заметки в буфер</Button>}
    {onSlideshow && <Button size="sm" variant="ghost" title="Показать отобранное по кадрам — с первого" onClick={onSlideshow}>Показ</Button>}
    <Button size="sm" variant="ghost" title="Контактный лист: печать или PDF из окна печати браузера" disabled={shownCount === 0} onClick={onPrint}>Печать</Button>
    {journalCount > 0 && <Button size="sm" variant="ghost" title="Что делали в галерее и что можно вернуть" onClick={onOpenJournal}>История ({journalCount})</Button>}
    <Button size="sm" variant="ghost" aria-expanded={trashOpen} title={trashCount ? `Клавиша t · в корзине файлов: ${trashCount} (хранятся 7 дней)` : 'Клавиша t · корзина пуста'} onClick={onToggleTrash}>
      Корзина…{trashCount ? ` (${trashCount})` : ''}
    </Button>
  </>
}
