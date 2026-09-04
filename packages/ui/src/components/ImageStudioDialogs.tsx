// Окна студии картинок: шпаргалка клавиш, заметка к файлу и виды галереи.
// Вынесено из панели — вместе они занимали там сто с лишним строк разметки
// посреди логики, и читать её приходилось целиком ради одной кнопки. Состояние
// и все побочные эффекты (запись пометок, тосты) остаются у панели.
import { Button, Dialog, IconButton } from '@voicechat/ui-kit'
import { viewSummary, type StudioView } from '../lib/imageViews'

interface Props {
  keysOpen: boolean
  onCloseKeys: () => void
  /** Правка заметки одного файла: путь и черновик текста; null — окна нет. */
  note: { path: string; text: string } | null
  /** У файла уже есть сохранённая заметка — тогда есть и «Убрать». */
  noteSaved: boolean
  onNoteText: (text: string) => void
  onNoteSave: () => void
  onNoteClear: () => void
  onNoteClose: () => void
  viewsOpen: boolean
  onCloseViews: () => void
  views: Record<string, StudioView>
  viewName: string
  onViewName: (value: string) => void
  onApplyView: (name: string) => void
  onDeleteView: (name: string) => void
  onSaveView: () => void
}

export function ImageStudioDialogs({
  keysOpen, onCloseKeys,
  note, noteSaved, onNoteText, onNoteSave, onNoteClear, onNoteClose,
  viewsOpen, onCloseViews, views, viewName, onViewName, onApplyView, onDeleteView, onSaveView
}: Props): JSX.Element {
  return <>
    {viewsOpen && <Dialog title="Виды галереи" onClose={onCloseViews} size="sm" padded>
      {Object.keys(views).length === 0
        ? <p className="image-studio-dim">Пока ни одного вида. Настройте фильтры и порядок в галерее и запомните их здесь — потом хватит одного нажатия.</p>
        : <ul className="image-studio-views" role="list">
            {Object.entries(views).map(([name, view]) => <li key={name} role="listitem">
              <Button size="sm" variant="ghost" onClick={() => onApplyView(name)}>{name}</Button>
              <span className="image-studio-dim">{viewSummary(view)}</span>
              <IconButton size="sm" aria-label={`Удалить вид ${name}`} title="Удалить вид" onClick={() => onDeleteView(name)}>✕</IconButton>
            </li>)}
          </ul>}
      <span className="image-studio-rename-batch">
        <input aria-label="Имя вида" placeholder="имя вида…" value={viewName} onChange={(event) => onViewName(event.target.value)} />
        <Button size="sm" disabled={!viewName.trim()} onClick={onSaveView}>Запомнить нынешний вид</Button>
      </span>
    </Dialog>}

    {note && <Dialog
      title={`Заметка · ${note.path}`}
      onClose={onNoteClose}
      size="sm"
      padded
      actions={<>
        {noteSaved && <Button variant="ghost" onClick={onNoteClear}>Убрать заметку</Button>}
        <Button onClick={onNoteSave}>Сохранить</Button>
      </>}>
      <textarea
        aria-label={`Заметка к ${note.path}`}
        className="image-studio-note-field"
        placeholder="зачем этот кадр, что доделать…"
        autoFocus
        value={note.text}
        onChange={(event) => onNoteText(event.target.value)}
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter — сохранить: заметка обычно в одну строку, и тянуться
          // мышью к кнопке ради неё утомительно.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onNoteSave() }
        }}
      />
      <p className="image-studio-dim">Заметки живут в этом браузере и уходят в архив галереи. ⌘/Ctrl+Enter — сохранить.</p>
    </Dialog>}

    {keysOpen && <Dialog title="Клавиши галереи" onClose={onCloseKeys} size="sm" padded>
      <dl className="image-studio-keys">
        <dt>← → ↑ ↓</dt><dd>перейти по сетке (выбор для правки)</dd>
        <dt>Enter</dt><dd>открыть выбранную на весь экран</dd>
        <dt>Delete</dt><dd>удалить выбранную или все выбранные (с подтверждением)</dd>
        <dt>Esc</dt><dd>снять выбор картинки или выйти из мультирежима</dd>
        <dt>⌘/Ctrl + Enter</dt><dd>запустить рисование из поля промпта</dd>
        <dt>⌘/Ctrl + A</dt><dd>в мультирежиме — выбрать все видимые</dd>
        <dt>Shift + клик</dt><dd>в мультирежиме — отметить диапазон</dd>
        <dt>/</dt><dd>перейти в поиск</dd>
        <dt>u</dt><dd>выбрать файлы для загрузки</dd>
        <dt>f</dt><dd>избранное для выбранной</dd>
        <dt>s</dt><dd>скачать выбранную</dd>
        <dt>c</dt><dd>копировать выбранную в буфер</dd>
        <dt>g</dt><dd>группы по датам вкл/выкл</dd>
        <dt>b</dt><dd>фон сетки: шахматка → светлый → тёмный</dd>
        <dt>m</dt><dd>меню действий выбранной</dd>
        <dt>d</dt><dd>дубликат выбранной</dd>
        <dt>e</dt><dd>перейти к промпту правки выбранной</dd>
        <dt>n</dt><dd>заметка для выбранной</dd>
        <dt>F2</dt><dd>переименовать выбранную</dd>
        <dt>1 … 9</dt><dd>сохранённый вид по порядку</dd>
        <dt>t</dt><dd>корзина</dd>
        <dt>v</dt><dd>окно видов галереи</dd>
        <dt>⌘/Ctrl + Z</dt><dd>отменить последнее удаление или переименование</dd>
        <dt>, / . / 0</dt><dd>в лайтбоксе: масштаб меньше, больше, сброс</dd>
        <dt>i</dt><dd>свойства выбранной (просмотр с раскрытой панелью)</dd>
        <dt>Shift + стрелки</dt><dd>в мультирежиме — расширить выделение</dd>
        <dt>⌘/Ctrl + F</dt><dd>то же, что «/» — поле поиска</dd>
        <dt>⌘/Ctrl + A</dt><dd>вне мультирежима — включить его и выбрать всё</dd>
        <dt>p</dt><dd>взять промпт выбранной в поле</dd>
        <dt>Home / End</dt><dd>первая и последняя картинка</dd>
        <dt>PageUp / PageDown</dt><dd>прыжок на экран строк</dd>
        <dt>?</dt><dd>общая шпаргалка приложения (эта — по кнопке «?» в галерее)</dd>
      </dl>
      <p className="image-studio-dim">Буквенные клавиши работают, когда фокус в галерее, а не в поле ввода.</p>
    </Dialog>}
  </>
}
