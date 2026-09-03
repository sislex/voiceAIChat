// Лайтбокс студии картинок: полный размер, листание (кнопки, стрелки, свайп),
// сравнение с исходником и действия над открытым файлом. Состояние — у панели:
// вьюер только показывает и дёргает колбэки.
import { useEffect, useRef, useState } from 'react'
import type { ImageStudioFile } from '@shared/imageStudio'
import type { CropRect } from '../lib/imageTransform'
import { ANNOTATE_COLORS, type AnnotateStroke } from '../lib/imageAnnotate'
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
  /** Обрезка: rect в натуральных пикселях картинки. */
  onCrop: (path: string, rect: CropRect) => void
  /** Разметка: штрихи в CSS-пикселях + размер, в котором рисовали. */
  onAnnotate: (path: string, strokes: AnnotateStroke[], displaySize: { width: number; height: number }) => void
  /** Позиция открытого файла в отфильтрованной сетке: «N из M». */
  position?: { index: number; total: number }
  onDownload: (path: string) => void
  onDelete: (path: string) => void
  onClose: () => void
}

export function ImageStudioViewer({ viewing, busy, files, previews, dimensions, compare, formatBytes, canStep, onCompareChange, onView, onStep, onUsePrompt, onPickForEdit, onVariate, onCrop, onAnnotate, onDownload, onDelete, onClose, position }: Props): JSX.Element {
  /** Положение шторки сравнения, % ширины (0 — весь исходник, 100 — весь результат). */
  const [wipe, setWipe] = useState(50)
  /** Режим обрезки: рамка в координатах отображаемой картинки (CSS-пиксели). */
  const [cropping, setCropping] = useState(false)
  /** Режим разметки: freehand-штрихи поверх картинки. */
  const [annotating, setAnnotating] = useState(false)
  const [strokes, setStrokes] = useState<AnnotateStroke[]>([])
  const [penColor, setPenColor] = useState<string>(ANNOTATE_COLORS[0])
  const [penWidth, setPenWidth] = useState<3 | 8>(3)
  const drawing = useRef(false)
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
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

  const positionLabel = position && position.total > 1 ? ` · ${position.index + 1} из ${position.total}` : ''
  return <ToolFrame title={compare ? `${viewing} — сравнение с исходником` : `${viewing}${positionLabel}`} onClose={onClose} className="util-embed--img" testId="image-studio-viewer"
    actions={<>
      {sourceInGallery && <IconButton size="sm" aria-label="Сравнить с исходником" title={compare ? 'Скрыть исходник' : 'Сравнить с исходником'} onClick={() => onCompareChange(!compare)}>⇄</IconButton>}
      <IconButton size="sm" aria-label={annotating ? 'Выйти из режима разметки' : `Разметить ${viewing}`} title={annotating ? 'Отменить разметку' : 'Разметить (рисование поверх)'} aria-pressed={annotating} onClick={() => { setAnnotating((prev) => !prev); setStrokes([]); setCropping(false); setCropBox(null); onCompareChange(false) }}>✏️</IconButton>
      <IconButton size="sm" aria-label={cropping ? 'Выйти из режима обрезки' : `Обрезать ${viewing}`} title={cropping ? 'Отменить обрезку' : 'Обрезать (выделите область)'} aria-pressed={cropping} onClick={() => { setCropping((prev) => !prev); setCropBox(null); setAnnotating(false); setStrokes([]); onCompareChange(false) }}>✂</IconButton>
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
        if (!previews[viewing]) return <p className="imgerr" role="alert">Превью ещё не загрузилось</p>
        if (annotating) {
          return <div className="image-studio-crop-stage image-studio-annotate"
            onPointerDown={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              drawing.current = true
              setStrokes((prev) => [...prev, { color: penColor, width: penWidth, points: [{ x: event.clientX - box.left, y: event.clientY - box.top }] }])
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return
              const box = event.currentTarget.getBoundingClientRect()
              const point = { x: event.clientX - box.left, y: event.clientY - box.top }
              setStrokes((prev) => {
                const last = prev[prev.length - 1]
                if (!last) return prev
                return [...prev.slice(0, -1), { ...last, points: [...last.points, point] }]
              })
            }}
            onPointerUp={() => { drawing.current = false }}>
            <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} draggable={false} />
            <svg className="image-studio-annotate-layer" aria-hidden="true">
              {strokes.map((stroke, index) => <polyline key={index} points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
            </svg>
          </div>
        }
        if (!cropping) return <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} />
        return <div className="image-studio-crop-stage"
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            dragStart.current = { x: event.clientX - box.left, y: event.clientY - box.top }
            setCropBox(null)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!dragStart.current) return
            const box = event.currentTarget.getBoundingClientRect()
            const x = event.clientX - box.left
            const y = event.clientY - box.top
            setCropBox({ x: Math.min(x, dragStart.current.x), y: Math.min(y, dragStart.current.y), w: Math.abs(x - dragStart.current.x), h: Math.abs(y - dragStart.current.y) })
          }}
          onPointerUp={() => { dragStart.current = null }}>
          <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} draggable={false} />
          {cropBox && <span className="image-studio-crop-box" style={{ left: cropBox.x, top: cropBox.y, width: cropBox.w, height: cropBox.h }} aria-hidden="true" />}
          <p className="image-studio-origin"><span className="image-studio-dim">Выделите область мышью и нажмите «Вырезать».</span></p>
        </div>
      })()}
      {annotating && <p className="image-studio-origin image-studio-annotate-controls">
        {ANNOTATE_COLORS.map((color) => <button key={color} type="button" className={`image-studio-pen${penColor === color ? ' image-studio-pen--active' : ''}`} style={{ background: color }} aria-label={`Цвет ${color}`} aria-pressed={penColor === color} title={`Цвет ${color}`} onClick={() => setPenColor(color)} />)}
        <button type="button" className="image-studio-cancel" aria-pressed={penWidth === 8} onClick={() => setPenWidth(penWidth === 3 ? 8 : 3)}>{penWidth === 3 ? 'Тонкая линия' : 'Толстая линия'}</button>
        <button type="button" className="image-studio-cancel" disabled={!strokes.length} onClick={() => setStrokes((prev) => prev.slice(0, -1))}>Отменить штрих</button>
        <button type="button" className="image-studio-cancel" disabled={!strokes.length || busy} onClick={() => {
          const img = imgRef.current
          if (!img || !strokes.length) return
          const size = { width: img.clientWidth, height: img.clientHeight }
          setAnnotating(false)
          onAnnotate(viewing, strokes, size)
          setStrokes([])
        }}>Сохранить разметку</button>
      </p>}
      {cropping && <p className="image-studio-origin">
        <button type="button" className="image-studio-cancel" disabled={!cropBox || busy} onClick={() => {
          const img = imgRef.current
          if (!img || !cropBox) return
          // Рамка в CSS-пикселях → натуральные пиксели картинки. object-fit:
          // contain держит картинку прижатой к левому верхнему углу stage? Нет —
          // stage обёрнут вокруг самой картинки, offsetLeft внутри равен нулю,
          // масштаб один по обеим осям не гарантирован — пересчитываем по факту.
          const scaleX = img.naturalWidth / img.clientWidth
          const scaleY = img.naturalHeight / img.clientHeight
          const rect = {
            x: (cropBox.x - img.offsetLeft) * scaleX,
            y: (cropBox.y - img.offsetTop) * scaleY,
            w: cropBox.w * scaleX,
            h: cropBox.h * scaleY
          }
          setCropping(false)
          setCropBox(null)
          onCrop(viewing, rect)
        }}>Вырезать выделенное</button>
      </p>}
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
