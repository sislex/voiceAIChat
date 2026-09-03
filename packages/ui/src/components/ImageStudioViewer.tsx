// Лайтбокс студии картинок: полный размер, листание (кнопки, стрелки, свайп),
// сравнение с исходником и действия над открытым файлом. Состояние — у панели:
// вьюер только показывает и дёргает колбэки.
import { useEffect, useRef, useState } from 'react'
import type { ImageStudioFile } from '@shared/imageStudio'
import { IconButton } from '@voicechat/ui-kit'
import { ToolFrame } from './ToolFrame'

interface Props {
  viewing: string
  busy?: boolean
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
  /** Закрыть вьюер и выбрать файл для правки (фокус уйдёт в промпт). */
  onPickForEdit: (path: string) => void
  onVariate: (path: string) => void
  onDownload: (path: string) => void
  onDelete: (path: string) => void
  onClose: () => void
}

export function ImageStudioViewer({ viewing, busy, files, previews, dimensions, compare, formatBytes, canStep, onCompareChange, onView, onStep, onUsePrompt, onPickForEdit, onVariate, onDownload, onDelete, onClose }: Props): JSX.Element {
  /** Положение шторки сравнения, % ширины (0 — весь исходник, 100 — весь результат). */
  const [wipe, setWipe] = useState(50)
  /** Начальная точка свайпа (телефон). */
  const touchX = useRef<number | null>(null)
  // Стрелки листают из любого места вьюера: фокус после открытия стоит на
  // кнопках шапки, и локальный onKeyDown тела до него не дотягивается.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      onStep(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])
  const meta = files.find((file) => file.path === viewing)
  const sourceInGallery = meta?.source && files.some((file) => file.path === meta.source)

  return <ToolFrame title={compare ? `${viewing} — сравнение с исходником` : viewing} onClose={onClose} className="util-embed--img" testId="image-studio-viewer"
    actions={<>
      {sourceInGallery && <IconButton size="sm" aria-label="Сравнить с исходником" title={compare ? 'Скрыть исходник' : 'Сравнить с исходником'} onClick={() => onCompareChange(!compare)}>⇄</IconButton>}
      <IconButton size="sm" aria-label={`Править ${viewing} по промпту`} title="Править по промпту" onClick={() => onPickForEdit(viewing)}>✎</IconButton>
      <IconButton size="sm" aria-label={`Нарисовать вариацию ${viewing}`} title="Вариация" disabled={busy} onClick={() => onVariate(viewing)}>✦</IconButton>
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
          // Шторка: обе картинки в стеке, результат обрезается слева по слайдеру.
          return <div className="image-studio-wipe">
            <div className="image-studio-wipe-stage">
              <img src={previews[sourcePath]} alt={`Исходник: ${sourcePath}`} />
              <img src={previews[viewing]} alt={viewing} style={{ clipPath: `inset(0 0 0 ${wipe}%)` }} />
              <span className="image-studio-wipe-line" style={{ left: `${wipe}%` }} aria-hidden="true" />
            </div>
            <input type="range" min={0} max={100} value={wipe} aria-label="Шторка сравнения: левее — исходник, правее — результат" onChange={(event) => setWipe(Number(event.target.value))} />
            <p className="image-studio-origin"><span className="image-studio-dim">← {sourcePath} · {viewing} →</span></p>
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
