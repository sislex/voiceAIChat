// Лайтбокс студии картинок: полный размер, листание (кнопки, стрелки, свайп),
// сравнение с исходником и действия над открытым файлом. Состояние — у панели:
// вьюер только показывает и дёргает колбэки.
import { useRef } from 'react'
import type { ImageStudioFile } from '@shared/imageStudio'
import { IconButton } from '@voicechat/ui-kit'
import { ToolFrame } from './ToolFrame'

interface Props {
  viewing: string
  files: ImageStudioFile[]
  previews: Record<string, string>
  dimensions: Record<string, string>
  compare: boolean
  formatBytes: (bytes: number) => string
  /** Листать можно, когда в отфильтрованной сетке больше одного файла. */
  canStep: boolean
  onCompareChange: (compare: boolean) => void
  onView: (path: string) => void
  onStep: (delta: number) => void
  onUsePrompt: (prompt: string) => void
  onDownload: (path: string) => void
  onDelete: (path: string) => void
  onClose: () => void
}

export function ImageStudioViewer({ viewing, files, previews, dimensions, compare, formatBytes, canStep, onCompareChange, onView, onStep, onUsePrompt, onDownload, onDelete, onClose }: Props): JSX.Element {
  /** Начальная точка свайпа (телефон). */
  const touchX = useRef<number | null>(null)
  const meta = files.find((file) => file.path === viewing)
  const sourceInGallery = meta?.source && files.some((file) => file.path === meta.source)

  return <ToolFrame title={compare ? `${viewing} — сравнение с исходником` : viewing} onClose={onClose} className="util-embed--img" testId="image-studio-viewer"
    actions={<>
      {sourceInGallery && <IconButton size="sm" aria-label="Сравнить с исходником" title={compare ? 'Скрыть исходник' : 'Сравнить с исходником'} onClick={() => onCompareChange(!compare)}>⇄</IconButton>}
      <IconButton size="sm" aria-label={`Скачать ${viewing}`} title="Скачать" onClick={() => onDownload(viewing)}>⇩</IconButton>
      <IconButton size="sm" aria-label={`Удалить ${viewing}`} title="Удалить" onClick={() => onDelete(viewing)}>🗑</IconButton>
      {canStep && <>
        <IconButton size="sm" aria-label="Предыдущая картинка" title="Предыдущая (←)" onClick={() => { onCompareChange(false); onStep(-1) }}>‹</IconButton>
        <IconButton size="sm" aria-label="Следующая картинка" title="Следующая (→)" onClick={() => { onCompareChange(false); onStep(1) }}>›</IconButton>
      </>}
    </>}>
    <div className="imgbody" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onStep(-1)
        if (event.key === 'ArrowRight') onStep(1)
      }}
      onTouchStart={(event) => { touchX.current = event.touches[0]?.clientX ?? null }}
      onTouchEnd={(event) => {
        if (touchX.current === null) return
        const delta = (event.changedTouches[0]?.clientX ?? touchX.current) - touchX.current
        touchX.current = null
        if (Math.abs(delta) > 48) { onCompareChange(false); onStep(delta > 0 ? -1 : 1) }
      }}>
      {(() => {
        const sourcePath = compare ? meta?.source : undefined
        if (sourcePath && previews[sourcePath] && previews[viewing]) {
          return <div className="image-studio-compare">
            <figure><img className="image-studio-full" src={previews[sourcePath]} alt={`Исходник: ${sourcePath}`} /><figcaption>{sourcePath}</figcaption></figure>
            <figure><img className="image-studio-full" src={previews[viewing]} alt={viewing} /><figcaption>{viewing}</figcaption></figure>
          </div>
        }
        return previews[viewing]
          ? <img className="image-studio-full" src={previews[viewing]} alt={viewing} />
          : <p className="imgerr" role="alert">Превью ещё не загрузилось</p>
      })()}
      {meta && <p className="imgcap image-studio-origin">
        <span className="image-studio-dim">{formatBytes(meta.size)}{dimensions[meta.path] ? ` · ${dimensions[meta.path]}` : ''}</span>{' · '}
        {meta.source ? (sourceInGallery
          ? <>Из <button type="button" className="image-studio-cancel" onClick={() => { onCompareChange(false); onView(meta.source!) }}>«{meta.source}»</button> · </>
          : `Из «${meta.source}» · `) : ''}{meta.prompt ? `промпт: ${meta.prompt}` : ''}
        {meta.prompt && <>
          {' '}
          <button type="button" className="image-studio-cancel" onClick={() => onUsePrompt(meta.prompt!)}>Использовать промпт</button>
        </>}
      </p>}
    </div>
  </ToolFrame>
}
