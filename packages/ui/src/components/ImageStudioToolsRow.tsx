// Раскрываемая строка «Действия и обработка» карточки студии: файловые
// действия, клиентские трансформации и перенос в другой чат. Логика — у
// панели, строка только вызывает колбэки.
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
}

export function ImageStudioToolsRow({ file, busy, otherChats, onDownload, onCopy, onDuplicate, onTransform, onTransfer }: Props): JSX.Element {
  return <div className="image-studio-tools" role="group" aria-label={`Действия и обработка ${file.path}`}>
    <Button size="sm" variant="ghost" onClick={() => onDownload(file.path)}>Скачать</Button>
    <Button size="sm" variant="ghost" onClick={() => onCopy(file)}>Копировать</Button>
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDuplicate(file)}>Дубликат</Button>
    {IMAGE_TRANSFORMS.map((kind) => <Button key={kind.kind} size="sm" variant="ghost" disabled={busy} onClick={() => onTransform(file, kind)}>{kind.label}</Button>)}
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
