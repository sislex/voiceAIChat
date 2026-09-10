// Раскрываемая строка «Действия и обработка» карточки студии: файловые
// действия, клиентские трансформации и перенос в другой чат. Логика — у
// панели, строка только вызывает колбэки.
import { useState } from 'react'
import type { ImageStudioFile } from '@shared/imageStudio'
import { Button } from '@voicechat/ui-kit'
import { IMAGE_TRANSFORMS } from '../lib/imageTransform'

interface Props {
  file: ImageStudioFile
  busy: boolean
  otherChats: Array<{ id: string; title: string }>
  onDownload: (path: string) => void
  onCopy: (file: ImageStudioFile) => void
  onDuplicate: (file: ImageStudioFile) => void
  onTransform: (file: ImageStudioFile, kind: (typeof IMAGE_TRANSFORMS)[number]) => void
  onTransfer: (file: ImageStudioFile, to: string, copy: boolean) => void
  /** Прямая ссылка на файл публичной галереи; нет публикации — нет кнопки. */
  onCopyLink?: (file: ImageStudioFile) => void
  /** Ссылка на этот кадр внутри приложения (адрес с открытым лайтбоксом). */
  onCopyDeepLink: (file: ImageStudioFile) => void
  /** Открыть картинку отдельной вкладкой браузера (полный размер, зум браузера). */
  onOpenTab: (file: ImageStudioFile) => void
  /** Нанести подпись в углу картинки; результат — новый файл. */
  onCaption: (file: ImageStudioFile, text: string) => void
  /** Скопировать картинку как data-URI — вставить прямо в CSS или HTML. */
  onCopyDataUri: (file: ImageStudioFile) => void
}

export function ImageStudioToolsRow({ file, busy, otherChats, onDownload, onCopy, onDuplicate, onTransform, onTransfer, onCopyLink, onCopyDeepLink, onOpenTab, onCaption, onCopyDataUri }: Props): JSX.Element {
  const [caption, setCaption] = useState('')
  return <div className="image-studio-tools" role="group" aria-label={`Действия и обработка ${file.path}`}>
    <Button size="sm" variant="ghost" onClick={() => onDownload(file.path)}>Скачать</Button>
    <Button size="sm" variant="ghost" onClick={() => onCopy(file)}>Копировать</Button>
    <Button size="sm" variant="ghost" title="Ссылка на этот кадр в приложении — для коллеги с доступом" onClick={() => onCopyDeepLink(file)}>Ссылка на кадр</Button>
    <Button size="sm" variant="ghost" title="Отдельная вкладка браузера: полный размер и его собственный зум" onClick={() => onOpenTab(file)}>В новой вкладке</Button>
    <Button size="sm" variant="ghost" title="data:image/…;base64 — вставляется прямо в CSS или HTML" onClick={() => onCopyDataUri(file)}>Как data-URI</Button>
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDuplicate(file)}>Дубликат</Button>
    {onCopyLink && <Button size="sm" variant="ghost" title="Прямая ссылка на этот файл в опубликованной галерее" onClick={() => onCopyLink(file)}>Ссылка на файл</Button>}
    {IMAGE_TRANSFORMS.map((kind) => <Button key={kind.kind} size="sm" variant="ghost" disabled={busy} onClick={() => onTransform(file, kind)}>{kind.label}</Button>)}
    <span className="image-studio-caption-row">
      <input aria-label={`Подпись на картинке ${file.path}`} placeholder="подпись в углу…" value={caption} onChange={(event) => setCaption(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && caption.trim()) { event.preventDefault(); onCaption(file, caption.trim()); setCaption('') } }} />
      <Button size="sm" variant="ghost" disabled={busy || !caption.trim()} onClick={() => { onCaption(file, caption.trim()); setCaption('') }}>Подписать</Button>
    </span>
    {otherChats.length > 0 && <select aria-label={`Перенести или скопировать ${file.path} в другой чат`} disabled={busy} value="" onChange={(event) => {
      const [mode, target] = event.target.value.split(':', 2)
      if (target) onTransfer(file, target, mode === 'copy')
    }}>
      <option value="">В другой чат…</option>
      <optgroup label="Переместить в">
        {otherChats.map((chatItem) => <option key={`move:${chatItem.id}`} value={`move:${chatItem.id}`}>{chatItem.title}</option>)}
      </optgroup>
      <optgroup label="Скопировать в">
        {otherChats.map((chatItem) => <option key={`copy:${chatItem.id}`} value={`copy:${chatItem.id}`}>{chatItem.title}</option>)}
      </optgroup>
    </select>}
  </div>
}
