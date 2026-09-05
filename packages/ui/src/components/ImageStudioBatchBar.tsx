// Строка пакетных действий мультирежима студии: скачать, пометить, собрать
// коллаж, переименовать по шаблону, обработать, править моделью, перенести и
// удалить выбранное. Логика — у панели, строка только показывает и дёргает
// колбэки: у самой панели их уже больше двадцати, и держать эту разметку там
// значило читать полторы тысячи строк ради одной кнопки.
import { useState } from 'react'
import { Button } from '@voicechat/ui-kit'
import { IMAGE_TRANSFORMS, type ImageTransformKind } from '../lib/imageTransform'

export interface BatchActions {
  onSelectAll: () => void
  onInvert: () => void
  /** Показать в сетке только выбранные — проверить пачку перед действием. */
  onShowPicked: () => void
  onDownload: () => void
  /** Один ZIP из выбранных — вместо лавины отдельных скачиваний. */
  onDownloadArchive: () => void
  /** `allStarred` приходит обратно, чтобы панель знала, что делать: снять или поставить. */
  onToggleStars: (allStarred: boolean) => void
  onCollage: () => void
  onRenameByTemplate: () => void
  onTransform: (kind: ImageTransformKind) => void
  /** Повторить последнюю обработку на нынешнем выборе. */
  onRepeatTransform: () => void
  /** Дать выбранным имена из их промптов. */
  onRenameByPrompt: () => void
  onReferences: () => void
  onEditBatch: () => void
  onCompare: () => void
  /** `copy: true` — оставить картинку и в этом чате. */
  onTransfer: (to: string, copy: boolean) => void
  onDelete: () => void
  onNote: () => void
  /** Промпты выбранных — текстом в буфер. */
  onCopyPrompts: () => void
  /**
   * Подписать выбранные: без текста — именем файла (контрольный лист), с
   * текстом — одной строкой на всех (черновик, водяной знак).
   */
  onCaptionNames: (text?: string) => void
  /** Дубликат каждой выбранной: «сохрани, прежде чем править». */
  onDuplicateBatch: () => void
  /** Сохранить выбор как набор под введённым именем. */
  onSaveSet: () => void
  /** Отметить выбранные черновиками или готовыми. */
  onSetStatus: (status: 'draft' | 'ready') => void
  /** Добавить выбранные в уже существующий набор. */
  onAddToSet: (name: string) => void
  /** Убрать выбранные из набора: подборку чистят так же часто, как собирают. */
  onRemoveFromSet: (name: string) => void
  /** Прикрепить выбранные к сообщению чата; null — мост недоступен. */
  onAttachBatch: (() => void) | null
  /** Снять с выбранных все локальные пометки: звёзды, заметки, готовность. */
  onClearMarks: () => void
}

interface Props {
  /** Подпись последней обработки; null — ещё ничего не обрабатывали. */
  lastTransformLabel: string | null
  /** Сетка уже сужена до выбранных — тогда кнопка предлагает обратное. */
  pickedOnly: boolean
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
  /** Что получится по шаблону: первые строки «было → стало». */
  renamePreview: string | null
  noteDraft: string
  onNoteDraftChange: (value: string) => void
  /** Черновик подписи «на всех»: живёт у панели, как и остальные поля строки. */
  captionDraft: string
  onCaptionDraftChange: (value: string) => void
  /** Имена уже сохранённых наборов — для «добавить в набор». */
  setNames: string[]
  setName: string
  onSetNameChange: (value: string) => void
  formatBytes: (bytes: number) => string
  actions: BatchActions
}

export function ImageStudioBatchBar({
  selected, total, bytes, busy, allStarred, otherChats, pickedOnly, lastTransformLabel,
  renameTemplate, onRenameTemplateChange, renamePreview, noteDraft, onNoteDraftChange, captionDraft, onCaptionDraftChange, setNames, setName, onSetNameChange, formatBytes, actions
}: Props): JSX.Element {
  const count = selected.size
  /**
   * Двадцать одна кнопка и четыре поля в одном ряду занимали пол-экрана, едва
   * человек включал мультирежим. На виду — то, ради чего его включают чаще
   * всего (скачать, отметить, удалить), остальное живёт в раскрытии: попапом
   * его не сделать, внутри поля ввода для заметки, набора, шаблона и подписи.
   */
  const [more, setMore] = useState(false)
  return <>
    <Button size="sm" variant="ghost" onClick={actions.onSelectAll}>Выбрать все</Button>
    <Button size="sm" variant="ghost" onClick={actions.onInvert}>Инвертировать</Button>
    {(count > 1 || pickedOnly) && <Button size="sm" variant="ghost" aria-pressed={pickedOnly} title="Оставить в сетке только выбранные — проверить пачку перед пакетным действием" onClick={actions.onShowPicked}>
      {pickedOnly ? 'Показать все' : `Только выбранные (${count})`}
    </Button>}
    <span className="image-studio-dim" role="status">
      Выбрано {count} из {total}
      {count > 0 && ` · ${formatBytes(bytes)}`}
    </span>
    {count > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={actions.onDownload}>Скачать выбранные ({count})</Button>}
    {count > 1 && <Button size="sm" variant="ghost" disabled={busy} title="Один ZIP с выбранными, промптами и метаданными" onClick={actions.onDownloadArchive}>Архивом ({count})</Button>}
    {count > 0 && <Button size="sm" variant="ghost" onClick={() => actions.onToggleStars(allStarred)}>
      {allStarred ? `Убрать из избранного (${count})` : `В избранное (${count})`}
    </Button>}
    {count > 0 && <Button size="sm" variant="ghost" aria-expanded={more} aria-controls="image-studio-batch-more" title="Пометки, наборы, коллаж, переименование, обработка, перенос" onClick={() => setMore((prev) => !prev)}>
      {more ? 'Скрыть остальное' : 'Ещё с выбранными…'}
    </Button>}
    {count > 0 && <Button size="sm" variant="danger" disabled={busy} onClick={actions.onDelete}>Удалить выбранные ({count})</Button>}
    {count > 0 && more && <span
      id="image-studio-batch-more"
      role="group"
      aria-label="Ещё действия с выбранными"
      className="image-studio-batch-more"
      // Esc сворачивает раскрытие, а не выходит из мультирежима: пока оно
      // открыто, это ближайшее «отменить», и терять выбор пачки не за что.
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setMore(false) } }}
    >
    {count > 0 && <select aria-label="Готовность выбранных" disabled={busy} value="" onChange={(event) => {
      if (event.target.value === 'draft' || event.target.value === 'ready') actions.onSetStatus(event.target.value)
      if (event.target.value === 'clear') actions.onClearMarks()
    }}>
      <option value="">Пометки выбранных…</option>
      <option value="draft">Отметить черновиками</option>
      <option value="ready">Отметить готовыми</option>
      <option value="clear">Снять все пометки</option>
    </select>}
    {count > 0 && <span className="image-studio-rename-batch">
      <input aria-label="Заметка для выбранных" placeholder="заметка для всех…" value={noteDraft} onChange={(event) => onNoteDraftChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={!noteDraft.trim()} onClick={actions.onNote}>Заметить ({count})</Button>
    </span>}
    {count > 0 && <span className="image-studio-rename-batch">
      <input aria-label="Имя набора" placeholder="имя набора…" value={setName} onChange={(event) => onSetNameChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={!setName.trim()} title="Запомнить этот выбор под именем" onClick={actions.onSaveSet}>Сохранить набор</Button>
    </span>}
    {count > 0 && setNames.length > 0 && <select aria-label="Наборы для выбранных" value="" onChange={(event) => {
      const [mode, name] = event.target.value.split(':', 2)
      if (!name) return
      if (mode === 'add') actions.onAddToSet(name)
      else actions.onRemoveFromSet(name)
    }}>
      <option value="">Наборы выбранных…</option>
      <optgroup label="Добавить в">
        {setNames.map((name) => <option key={`add:${name}`} value={`add:${name}`}>{name}</option>)}
      </optgroup>
      <optgroup label="Убрать из">
        {setNames.map((name) => <option key={`drop:${name}`} value={`drop:${name}`}>{name}</option>)}
      </optgroup>
    </select>}
    {count > 0 && actions.onAttachBatch && <Button size="sm" variant="ghost" disabled={busy} title="Приложить выбранные к следующему сообщению чата" onClick={actions.onAttachBatch}>
      В сообщение ({count})
    </Button>}
    {count > 1 && <Button size="sm" variant="ghost" disabled={busy} title="Собрать выбранные в один PNG сеткой" onClick={actions.onCollage}>Коллаж ({count})</Button>}
    {count > 1 && <span className="image-studio-rename-batch">
      <input aria-label="Шаблон пакетного переименования" placeholder="кадр-{n}" value={renameTemplate} onChange={(event) => onRenameTemplateChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={busy || !renameTemplate.trim()} title="Переименовать выбранные по шаблону: {n} — номер по порядку" onClick={actions.onRenameByTemplate}>Переименовать по шаблону</Button>
      {/* Предпросмотр обязателен: пакетное переименование необратимо одним
          нажатием, а ошибку в шаблоне видно только по результату. */}
      {renamePreview && <span className="image-studio-dim" role="status">{renamePreview}</span>}
    </span>}
    {/* Имя из промпта осмысленно и для одного файла — поэтому вне блока шаблона. */}
    {count > 0 && <Button size="sm" variant="ghost" disabled={busy} title="Взять имена из промптов: «рыжий-кот-в-шляпе.png» вместо «изображение-7.png»" onClick={actions.onRenameByPrompt}>По промпту</Button>}
    {count > 0 && <select aria-label="Обработать выбранные" disabled={busy} value="" onChange={(event) => {
      const kind = IMAGE_TRANSFORMS.find((item) => item.kind === event.target.value)
      if (kind) actions.onTransform(kind.kind)
    }}>
      <option value="">Обработать выбранные…</option>
      {IMAGE_TRANSFORMS.map((kind) => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
    </select>}
    {count > 0 && lastTransformLabel && <Button size="sm" variant="ghost" disabled={busy} title={`Повторить «${lastTransformLabel}» на выбранных`} onClick={actions.onRepeatTransform}>
      Ещё раз: {lastTransformLabel.toLowerCase()}
    </Button>}
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
    {count > 0 && <Button size="sm" variant="ghost" disabled={busy} title="Нанести на каждую выбранную её имя — удобно для контрольного листа" onClick={() => actions.onCaptionNames()}>
      Подписать именами ({count})
    </Button>}
    {count > 0 && <span className="image-studio-rename-batch">
      <input aria-label="Подпись для выбранных" placeholder="подпись на всех…" value={captionDraft} onChange={(event) => onCaptionDraftChange(event.target.value)} />
      <Button size="sm" variant="ghost" disabled={busy || !captionDraft.trim()} title="Нанести один и тот же текст на каждую выбранную" onClick={() => actions.onCaptionNames(captionDraft)}>
        Подписать текстом ({count})
      </Button>
    </span>}
    {count > 1 && <Button size="sm" variant="ghost" disabled={busy} title="Сделать копию каждой выбранной — страховка перед правкой" onClick={actions.onDuplicateBatch}>
      Дубликаты ({count})
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
    </span>}
  </>
}
