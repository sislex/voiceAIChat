// Строка пакетных действий мультирежима студии: скачать, пометить, собрать
// коллаж, переименовать по шаблону, обработать, править моделью, перенести и
// удалить выбранное. Логика — у панели, строка только показывает и дёргает
// колбэки: у самой панели их уже больше двадцати, и держать эту разметку там
// значило читать полторы тысячи строк ради одной кнопки.
import { Button } from '@voicechat/ui-kit'
import { IMAGE_TRANSFORMS, type ImageTransformKind } from '../lib/imageTransform'

export interface BatchActions {
  onSelectAll: () => void
  onInvert: () => void
  onDownload: () => void
  /** `allStarred` приходит обратно, чтобы панель знала, что делать: снять или поставить. */
  onToggleStars: (allStarred: boolean) => void
  onCollage: () => void
  onRenameByTemplate: () => void
  onTransform: (kind: ImageTransformKind) => void
  onReferences: () => void
  onEditBatch: () => void
  onCompare: () => void
  /** `copy: true` — оставить картинку и в этом чате. */
  onTransfer: (to: string, copy: boolean) => void
  onDelete: () => void
  onNote: () => void
  /** Промпты выбранных — текстом в буфер. */
  onCopyPrompts: () => void
  /** Подписать каждую выбранную её же именем — для контрольных листов. */
  onCaptionNames: () => void
  /** Сохранить выбор как набор под введённым именем. */
  onSaveSet: () => void
}

interface Props {
  /** Пути выбранных файлов. */
  selected: Set<string>
  /** Сколько файлов видно в сетке (знаменатель сводки). */
  total: number
  /** Суммарный вес выбранного. */
  bytes: number
  busy: boolean
  /** Все выбранные уже в избранном — тогда кнопка предлагает обратное. */
  allStarred: boolean
  otherChats: Array<{ id: string; title: string }>
  renameTemplate: string
  onRenameTemplateChange: (value: string) => void
  noteDraft: string
  onNoteDraftChange: (value: string) => void
  setName: string
  onSetNameChange: (value: string) => void
  formatBytes: (bytes: number) => string
  actions: BatchActions
}

export function ImageStudioBatchBar({
  selected, total, bytes, busy, allStarred, otherChats,
  renameTemplate, onRenameTemplateChange, noteDraft, onNoteDraftChange, setName, onSetNameChange, formatBytes, actions
}: Props): JSX.Element {
  const count = selected.size
  return <>
    <Button size="sm" variant="ghost" onClick={actions.onSelectAll}>Выбрать все</Button>
    <Button size="sm" variant="ghost" onClick={actions.onInvert}>Инвертировать</Button>
    <span className="image-studio-dim" role="status">
      Выбрано {count} из {total}
      {count > 0 && ` · ${formatBytes(bytes)}`}
    </span>
    {count > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={actions.onDownload}>Скачать выбранные ({count})</Button>}
    {count > 0 && <Button size="sm" variant="ghost" onClick={() => actions.onToggleStars(allStarred)}>
      {allStarred ? `Убрать из избранного (${count})` : `В избранное (${count})`}
    </Button>}
    {count > 0 && <span className="image-studio-rename-batch">
      <input aria-label="Заметка для выбранных" placeholder="заметка для всех…" value={noteDraft} onChange={(event) => onNoteDraftChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={!noteDraft.trim()} onClick={actions.onNote}>Заметить ({count})</Button>
    </span>}
    {count > 0 && <span className="image-studio-rename-batch">
      <input aria-label="Имя набора" placeholder="имя набора…" value={setName} onChange={(event) => onSetNameChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={!setName.trim()} title="Запомнить этот выбор под именем" onClick={actions.onSaveSet}>Сохранить набор</Button>
    </span>}
    {count > 1 && <Button size="sm" variant="ghost" disabled={busy} title="Собрать выбранные в один PNG сеткой" onClick={actions.onCollage}>Коллаж ({count})</Button>}
    {count > 1 && <span className="image-studio-rename-batch">
      <input aria-label="Шаблон пакетного переименования" placeholder="кадр-{n}" value={renameTemplate} onChange={(event) => onRenameTemplateChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={busy || !renameTemplate.trim()} title="Переименовать выбранные по шаблону: {n} — номер по порядку" onClick={actions.onRenameByTemplate}>Переименовать по шаблону</Button>
    </span>}
    {count > 0 && <select aria-label="Обработать выбранные" disabled={busy} value="" onChange={(event) => {
      const kind = IMAGE_TRANSFORMS.find((item) => item.kind === event.target.value)
      if (kind) actions.onTransform(kind.kind)
    }}>
      <option value="">Обработать выбранные…</option>
      {IMAGE_TRANSFORMS.map((kind) => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
    </select>}
    {count > 0 && count <= 4 && <Button size="sm" variant="ghost" disabled={busy} title="Нарисовать новую картинку по промпту, используя выбранные как образцы стиля" onClick={actions.onReferences}>
      Нарисовать с референсами ({count})
    </Button>}
    {count > 1 && <Button size="sm" variant="ghost" disabled={busy} title="Применить промпт из поля к каждой выбранной картинке (результат — новые файлы)" onClick={actions.onEditBatch}>
      Править выбранные ({count})
    </Button>}
    {count >= 2 && count <= 4 && <Button size="sm" variant="ghost" onClick={actions.onCompare}>
      {count === 2 ? 'Сравнить выбранные' : `Сравнить сеткой (${count})`}
    </Button>}
    {count > 0 && <Button size="sm" variant="ghost" onClick={actions.onCopyPrompts}>Промпты выбранных</Button>}
    {count > 0 && <Button size="sm" variant="ghost" disabled={busy} title="Нанести на каждую выбранную её имя — удобно для контрольного листа" onClick={actions.onCaptionNames}>
      Подписать именами ({count})
    </Button>}
    {count > 0 && otherChats.length > 0 && <select aria-label="Перенести или скопировать выбранные в другой чат" disabled={busy} value="" onChange={(event) => {
      const [mode, target] = event.target.value.split(':', 2)
      if (target) actions.onTransfer(target, mode === 'copy')
    }}>
      <option value="">Выбранные в другой чат…</option>
      <optgroup label="Переместить в">
        {otherChats.map((chatItem) => <option key={`move:${chatItem.id}`} value={`move:${chatItem.id}`}>{chatItem.title}</option>)}
      </optgroup>
      <optgroup label="Скопировать в">
        {otherChats.map((chatItem) => <option key={`copy:${chatItem.id}`} value={`copy:${chatItem.id}`}>{chatItem.title}</option>)}
      </optgroup>
    </select>}
    {count > 0 && <Button size="sm" variant="danger" disabled={busy} onClick={actions.onDelete}>Удалить выбранные ({count})</Button>}
  </>
}
