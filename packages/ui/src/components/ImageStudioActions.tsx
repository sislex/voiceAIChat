// Действия и вид галереи студии: архив, текстовые выгрузки, поиск дубликатов и
// проверка файлов, вид сетки, избранное, обновление, уведомления, клавиши,
// пометки и корзина. Вынесено из панели — она держала эту разметку посреди
// логики, и читать её приходилось целиком ради одной кнопки. Состояние и все
// побочные эффекты остаются у панели; здесь живёт только раскрытие меню «Ещё…»
// — это вид, а не поведение галереи.
import { useEffect, useRef, useState } from 'react'
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
  /** Миниатюры показывают картинку целиком, а не обрезают по квадрату. */
  fit: boolean
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
  onToggleFit: () => void
  onToggleStarsOnly: () => void
  onReload: () => void
  onAskNotifications: () => void
  onOpenKeys: () => void
  /** Справочник возможностей студии со снимками экрана. */
  onOpenGuide: () => void
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
  busy, shownCount, totalCount, hasPrompts, gridBg, dense, fit, starsOnly, trashCount, trashOpen,
  canAskNotifications, onDownloadArchive, onCopyInventory, onDownloadInventory, onFindDuplicates, onVerifyFiles,
  onCopyPrompts, onCycleGridBg, onToggleDense, onToggleFit, onToggleStarsOnly, onReload, onAskNotifications,
  onOpenKeys, onOpenGuide, onOpenMarks, onOpenViews, viewsCount, onCopyViewLink,
  onSlideshow, pageSize, onPageSize, journalCount, onOpenJournal, hasNotes, onCopyNotes, onPrint, onToggleTrash
}: Props): JSX.Element {
  const background = BACKGROUND_TITLES[gridBg]
  // Редкие команды жили в общем ряду, и он разросся до трёх строк мелких
  // кнопок: найти в такой стене нужную дороже, чем открыть меню.
  const [more, setMore] = useState(false)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!more) return
    const close = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node) && event.target !== moreRef.current) setMore(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [more])

  const item = (label: string, action: () => void, title?: string, disabled?: boolean): JSX.Element => (
    <button type="button" role="menuitem" disabled={disabled} title={title} onClick={() => { setMore(false); action() }}>{label}</button>
  )

  return <>
    <Button size="sm" variant="ghost" disabled={busy || shownCount === 0} onClick={onDownloadArchive}>Скачать архивом</Button>
    <IconButton size="sm" aria-label={`Фон сетки: ${background} — сменить`} title={`Фон сетки: ${background}`} onClick={onCycleGridBg}>◧</IconButton>
    <IconButton size="sm" aria-label={dense ? 'Крупные карточки' : 'Мелкие карточки'} title={dense ? 'Крупнее' : 'Мельче'} onClick={onToggleDense}>
      {dense ? '▦' : '▤'}
    </IconButton>
    <IconButton
      size="sm"
      aria-label={fit ? 'Обрезать миниатюры по квадрату' : 'Показывать миниатюры целиком'}
      title={fit ? 'Миниатюры: целиком (клавиша o)' : 'Миниатюры: обрезаны (клавиша o)'}
      aria-pressed={fit}
      onClick={onToggleFit}
    >{fit ? '▣' : '▢'}</IconButton>
    <IconButton size="sm" aria-label={starsOnly ? 'Показать все файлы' : 'Показать только избранные'} title={starsOnly ? 'Все файлы' : 'Только избранные'} aria-pressed={starsOnly} onClick={onToggleStarsOnly}>
      {starsOnly ? '★' : '☆'}
    </IconButton>
    {totalCount > 60 && <select aria-label="Карточек на странице" title="Сколько карточек показывать сразу" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
      <option value={60}>Страница: 60</option>
      <option value={120}>Страница: 120</option>
      <option value={300}>Страница: 300</option>
    </select>}
    <IconButton size="sm" aria-label="Обновить галерею" title="Обновить (r)" onClick={onReload}>↻</IconButton>
    <IconButton size="sm" aria-label="Горячие клавиши галереи" title="Клавиши (?)" onClick={onOpenKeys}>?</IconButton>
    {/* Половина возможностей студии живёт в меню и раскрытиях: без такой
        кнопки о них узнают случайно. */}
    <IconButton size="sm" aria-label="Что умеет студия картинок" title="Что умеет студия" onClick={onOpenGuide}>ⓘ</IconButton>
    <Button size="sm" variant="ghost" aria-expanded={trashOpen} title={trashCount ? `Клавиша t · в корзине файлов: ${trashCount} (хранятся 7 дней)` : 'Клавиша t · корзина пуста'} onClick={onToggleTrash}>
      Корзина…{trashCount ? ` (${trashCount})` : ''}
    </Button>
    <span className="image-studio-toolbar-more">
      <Button
        size="sm"
        variant="ghost"
        ref={moreRef}
        aria-expanded={more}
        aria-haspopup="menu"
        title="Выгрузки, проверки, виды, печать"
        onClick={() => setMore((open) => !open)}
      >Ещё…</Button>
      {more && <div
        className="image-studio-menu image-studio-toolbar-menu"
        role="menu"
        aria-label="Ещё действия галереи"
        ref={(node) => {
          menuRef.current = node
          node?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); setMore(false); moreRef.current?.focus(); return }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
          event.stopPropagation()
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
          if (!items.length) return
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          const focus = (next: number): void => {
            event.preventDefault()
            items[(next + items.length) % items.length]?.focus()
          }
          if (event.key === 'ArrowDown') focus(index + 1)
          else if (event.key === 'ArrowUp') focus(index - 1)
          else if (event.key === 'Home') focus(0)
          else if (event.key === 'End') focus(items.length - 1)
          else focus(index + (event.shiftKey ? -1 : 1))
        }}
      >
        {item('Список в буфер', onCopyInventory, 'Markdown-таблица: имя, размер, пиксели, промпт, заметка', shownCount === 0)}
        {item('Список файлом', onDownloadInventory, 'Тот же список файлом .md', shownCount === 0)}
        {totalCount >= 2 ? item('Найти дубликаты', onFindDuplicates, 'Сравнить содержимое файлов и отметить лишние копии', busy) : null}
        {totalCount >= 2 ? item('Проверить файлы', onVerifyFiles, 'Прочитать все файлы и показать те, что не открываются', busy) : null}
        {hasPrompts ? item('Промпты в буфер', onCopyPrompts) : null}
        {item('Пометки…', onOpenMarks, 'Звёзды и заметки текстом: перенести в другой браузер')}
        {item(`Виды…${viewsCount ? ` (${viewsCount})` : ''}`, onOpenViews, 'Клавиша v · запомнить нынешние фильтры и сортировку под именем')}
        {onCopyViewLink ? item('Ссылка на отбор', onCopyViewLink, 'Ссылка, которая откроет галерею с этим же отбором') : null}
        {hasNotes ? item('Заметки в буфер', onCopyNotes, 'Все заметки галереи списком в Markdown') : null}
        {onSlideshow ? item('Показ', onSlideshow, 'Показать отобранное по кадрам — с первого') : null}
        {item('Печать', onPrint, 'Контактный лист: печать или PDF из окна печати браузера', shownCount === 0)}
        {journalCount > 0 ? item(`История (${journalCount})`, onOpenJournal, 'Что делали в галерее и что можно вернуть') : null}
        {canAskNotifications ? item('Уведомлять…', onAskNotifications, 'Системное уведомление, когда картинка готова и вкладка в фоне') : null}
      </div>}
    </span>
  </>
}
