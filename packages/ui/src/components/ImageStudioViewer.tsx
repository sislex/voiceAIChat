// Лайтбокс студии картинок: полный размер, листание (кнопки, стрелки, свайп),
// сравнение с исходником и действия над открытым файлом. Состояние — у панели:
// вьюер только показывает и дёргает колбэки.
import { useEffect, useRef, useState } from 'react'
import type { ImageStudioFile } from '@shared/imageStudio'
import type { CropRect } from '../lib/imageTransform'
import { ANNOTATE_COLORS, ANNOTATE_TOOLS, arrowHead, type AnnotateShape, type AnnotateTool } from '../lib/imageAnnotate'
import { versionChain } from '../lib/imageVersions'
import { IMAGE_STUDIO_VIEWER_BG_KEY } from '../store/contracts'
import { IconButton } from '@voicechat/ui-kit'
import { ToolFrame } from './ToolFrame'

interface Props {
  viewing: string
  busy?: boolean
  files: ImageStudioFile[]
  previews: Record<string, string>
  dimensions: Record<string, string>
  compare: boolean
  /** Явная пара для шторки (из мультирежима); имеет приоритет над meta.source. */
  compareWith?: string | null
  /** Три и более выбранных — сравниваем сеткой, шторка тут не поможет. */
  compareGrid?: string[]
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
  /** Разметка: фигуры в CSS-пикселях + размер, в котором рисовали. */
  onAnnotate: (path: string, shapes: AnnotateShape[], displaySize: { width: number; height: number }) => void
  /** Позиция открытого файла в отфильтрованной сетке: «N из M». */
  position?: { index: number; total: number }
  onDownload: (path: string) => void
  /** Положить открытую картинку в буфер обмена (панель читает файл сама). */
  onCopy: (path: string) => void
  /** Заметка к открытой картинке (локальная, хранит панель). */
  note?: string
  onNoteChange?: (path: string, note: string) => void
  /** Достать доминирующие цвета открытой картинки (панель читает файл сама). */
  onPalette?: (path: string) => Promise<string[]>
  /** Столбики гистограммы яркости в процентах высоты. */
  onHistogram?: (path: string) => Promise<number[]>
  onDelete: (path: string) => void
  onClose: () => void
}

/** Шаг слайдшоу: меньше — не успеваешь рассмотреть, больше — уже не показ. */
const SLIDESHOW_MS = 3000
/** Фоны подложки: прозрачный PNG читается по-разному на каждом из них. */
const VIEWER_BACKGROUNDS = ['checker', 'light', 'dark'] as const
type ViewerBackground = (typeof VIEWER_BACKGROUNDS)[number]
const BACKGROUND_LABELS: Record<ViewerBackground, string> = { checker: 'шахматка', light: 'светлый', dark: 'тёмный' }

export function ImageStudioViewer({ viewing, busy, files, previews, dimensions, compare, compareWith, compareGrid, formatBytes, canStep, onCompareChange, onView, onStep, onUsePrompt, onPickForEdit, onVariate, onCrop, onAnnotate, onDownload, onCopy, note, onNoteChange, onPalette, onHistogram, onDelete, onClose, position }: Props): JSX.Element {
  /** Положение шторки сравнения, % ширины (0 — весь исходник, 100 — весь результат). */
  const [wipe, setWipe] = useState(50)
  /**
   * Наложение вместо шторки: картинки складываются в режиме разницы, и
   * совпадающие пиксели становятся чёрными. Так видно даже сдвиг на пиксель,
   * который шторкой не поймать.
   */
  const [blend, setBlend] = useState(false)
  /** Режим обрезки: рамка в координатах отображаемой картинки (CSS-пиксели). */
  const [cropping, setCropping] = useState(false)
  /** Режим разметки: freehand-штрихи поверх картинки. */
  const [annotating, setAnnotating] = useState(false)
  const [strokes, setStrokes] = useState<AnnotateShape[]>([])
  const [penColor, setPenColor] = useState<string>(ANNOTATE_COLORS[0])
  const [penWidth, setPenWidth] = useState<3 | 8>(3)
  const [tool, setTool] = useState<AnnotateTool>('pen')
  const [labelText, setLabelText] = useState('')
  const drawing = useRef(false)
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Фиксированные пропорции рамки кропа; 0 — свободная. */
  const [cropRatio, setCropRatio] = useState(0)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  /** Зум простого просмотра: колесо масштабирует, drag двигает, dblclick сброс. */
  const [zoom, setZoom] = useState<{ scale: number; x: number; y: number }>({ scale: 1, x: 0, y: 0 })
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  /** Начальная точка свайпа (телефон). */
  const touchX = useRef<number | null>(null)
  /** Подложка под картинкой: у прозрачного PNG края видно только на контрасте. */
  const [background, setBackground] = useState<ViewerBackground>(() => {
    try {
      const saved = localStorage.getItem(IMAGE_STUDIO_VIEWER_BG_KEY)
      return (VIEWER_BACKGROUNDS as readonly string[]).includes(saved ?? '') ? saved as ViewerBackground : 'checker'
    } catch { return 'checker' }
  })
  /** Слайдшоу: сам листает вперёд, пока не выключат или не начнут править. */
  const [slideshow, setSlideshow] = useState(false)
  /** Раскрытая панель свойств: полная мета и заметка одним списком. */
  const [propsOpen, setPropsOpen] = useState(false)
  /** Доминирующие цвета открытой картинки; null — ещё не считали. */
  const [palette, setPalette] = useState<string[] | null>(null)
  /** Гистограмма яркости; null — ещё не считали. */
  const [histogram, setHistogram] = useState<number[] | null>(null)
  // Листаем — палитра и гистограмма прежнего кадра к новому отношения не имеют.
  useEffect(() => { setPalette(null); setHistogram(null) }, [viewing])
  /** Черновик заметки: пишем в панель по «Сохранить», а не на каждый символ. */
  const [noteDraft, setNoteDraft] = useState(note ?? '')
  // Листаем — заметка в поле должна стать заметкой нового файла.
  useEffect(() => { setNoteDraft(note ?? '') }, [viewing, note])
  // Любой режим правки останавливает показ: иначе картинка уедет из-под кисти.
  const stopSlideshow = (): void => setSlideshow(false)
  useEffect(() => {
    if (!slideshow || !canStep) return
    const timer = setInterval(() => onStep(1), SLIDESHOW_MS)
    return () => clearInterval(timer)
  }, [slideshow, canStep, onStep])
  /** Масштаб кнопками: колесо есть не у всех (трекпад, тач, клавиатура). */
  const zoomBy = (delta: number): void => setZoom((prev) => {
    const scale = Math.min(4, Math.max(1, Math.round((prev.scale + delta) * 100) / 100))
    return scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...prev, scale }
  })
  // Стрелки листают из любого места вьюера: фокус после открытия стоит на
  // кнопках шапки, и локальный onKeyDown тела до него не дотягивается.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { onStep(event.key === 'ArrowLeft' ? -1 : 1); return }
      // Delete — то же удаление с confirm, что и кнопкой корзины.
      if (event.key === 'Delete' || event.key === 'Backspace') onDelete(viewing)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep, onDelete, viewing])
  const meta = files.find((file) => file.path === viewing)
  const sourceInGallery = meta?.source && files.some((file) => file.path === meta.source)

  useEffect(() => { setZoom({ scale: 1, x: 0, y: 0 }) }, [viewing])
  useEffect(() => { if (!compare) setBlend(false) }, [compare])
  const positionLabel = position && position.total > 1 ? ` · ${position.index + 1} из ${position.total}` : ''
  return <ToolFrame title={compare ? `${viewing} — сравнение с исходником` : `${viewing}${positionLabel}`} onClose={onClose} className="util-embed--img" testId="image-studio-viewer"
    actions={<>
      {(sourceInGallery || compareWith || (compareGrid?.length ?? 0) > 2) && <IconButton size="sm" aria-label="Сравнить с исходником" title={compare ? 'Скрыть исходник' : 'Сравнить с исходником'} onClick={() => onCompareChange(!compare)}>⇄</IconButton>}
      <IconButton size="sm" aria-label={annotating ? 'Выйти из режима разметки' : `Разметить ${viewing}`} title={annotating ? 'Отменить разметку' : 'Разметить (рисование поверх)'} aria-pressed={annotating} onClick={() => { stopSlideshow(); setAnnotating((prev) => !prev); setStrokes([]); setCropping(false); setCropBox(null); onCompareChange(false) }}>✏️</IconButton>
      <IconButton size="sm" aria-label={cropping ? 'Выйти из режима обрезки' : `Обрезать ${viewing}`} title={cropping ? 'Отменить обрезку' : 'Обрезать (выделите область)'} aria-pressed={cropping} onClick={() => { stopSlideshow(); setCropping((prev) => !prev); setCropBox(null); setAnnotating(false); setStrokes([]); onCompareChange(false) }}>✂</IconButton>
      <IconButton size="sm" aria-label={`Править ${viewing} по промпту`} title="Править по промпту" onClick={() => onPickForEdit(viewing)}>✎</IconButton>
      <IconButton size="sm" aria-label={`Нарисовать вариацию ${viewing}`} title="Вариация" disabled={busy} onClick={() => onVariate(viewing)}>✦</IconButton>
      {'EyeDropper' in globalThis && <IconButton size="sm" aria-label="Пипетка: взять цвет с экрана" title="Пипетка (цвет в буфер)" onClick={() => {
        const Ctor = (globalThis as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
        if (!Ctor) return
        void new Ctor().open().then(({ sRGBHex }) => navigator.clipboard?.writeText(sRGBHex)).catch(() => undefined)
      }}>💧</IconButton>}
      {!compare && !cropping && !annotating && <>
        <IconButton size="sm" aria-label="Уменьшить масштаб" title="Уменьшить (колесо мыши тоже)" disabled={zoom.scale <= 1} onClick={() => zoomBy(-0.25)}>−</IconButton>
        <IconButton size="sm" aria-label={`Масштаб ${Math.round(zoom.scale * 100)} процентов, сбросить к 100`} title="Сбросить масштаб" disabled={zoom.scale === 1} onClick={() => setZoom({ scale: 1, x: 0, y: 0 })}>{`${Math.round(zoom.scale * 100)}%`}</IconButton>
        <IconButton size="sm" aria-label="Увеличить масштаб" title="Увеличить (колесо мыши тоже)" disabled={zoom.scale >= 4} onClick={() => zoomBy(0.25)}>+</IconButton>
      </>}
      <IconButton size="sm" aria-label={`Фон подложки: ${BACKGROUND_LABELS[background]} — сменить`} title={`Фон: ${BACKGROUND_LABELS[background]}`} onClick={() => setBackground((prev) => {
        const next = VIEWER_BACKGROUNDS[(VIEWER_BACKGROUNDS.indexOf(prev) + 1) % VIEWER_BACKGROUNDS.length]!
        try { localStorage.setItem(IMAGE_STUDIO_VIEWER_BG_KEY, next) } catch { /* приватный режим */ }
        return next
      })}>◧</IconButton>
      {canStep && <IconButton size="sm" aria-label={slideshow ? 'Остановить слайдшоу' : 'Запустить слайдшоу'} title={slideshow ? 'Стоп' : `Слайдшоу (${SLIDESHOW_MS / 1000} с на кадр)`} aria-pressed={slideshow} onClick={() => setSlideshow((prev) => !prev)}>{slideshow ? '⏸' : '▶'}</IconButton>}
      <IconButton size="sm" aria-label={propsOpen ? 'Скрыть свойства' : `Свойства ${viewing}`} title="Свойства и заметка" aria-pressed={propsOpen} onClick={() => setPropsOpen((prev) => !prev)}>ⓘ</IconButton>
      <IconButton size="sm" aria-label={`Скопировать ${viewing} в буфер`} title="Копировать в буфер" onClick={() => onCopy(viewing)}>⧉</IconButton>
      <IconButton size="sm" aria-label={`Скачать ${viewing}`} title="Скачать" onClick={() => onDownload(viewing)}>⇩</IconButton>
      <IconButton size="sm" aria-label={`Удалить ${viewing}`} title="Удалить" onClick={() => onDelete(viewing)}>🗑</IconButton>
      {canStep && <>
        <IconButton size="sm" aria-label="Предыдущая картинка" title="Предыдущая (←)" onClick={() => { onCompareChange(false); onStep(-1) }}>‹</IconButton>
        <IconButton size="sm" aria-label="Следующая картинка" title="Следующая (→)" onClick={() => { onCompareChange(false); onStep(1) }}>›</IconButton>
      </>}
    </>}>
    <div className={`imgbody image-studio-bg--${background}`} tabIndex={-1}
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
        // Сетка сравнения: три-четыре картинки рядом, подписи под каждой.
        if (compare && compareGrid && compareGrid.length > 2) {
          return <div className="image-studio-compare-grid" role="group" aria-label={`Сравнение ${compareGrid.length} картинок`}>
            {compareGrid.map((path) => <figure key={path}>
              {previews[path] ? <img src={previews[path]} alt={path} /> : <span className="image-studio-dim">превью грузится…</span>}
              <figcaption>
                <button type="button" className="image-studio-cancel" onClick={() => { onCompareChange(false); onView(path) }}>{path}</button>
                {dimensions[path] && <span className="image-studio-dim"> {dimensions[path]}</span>}
              </figcaption>
            </figure>)}
          </div>
        }
        const sourcePath = compare ? (compareWith ?? meta?.source) : undefined
        if (sourcePath && previews[sourcePath] && previews[viewing]) {
          // Шторка: обе картинки в стеке, результат обрезается слева по слайдеру.
          return <div className="image-studio-wipe">
            <div className={`image-studio-wipe-stage${blend ? ' image-studio-wipe-stage--blend' : ''}`} onClick={(event) => {
              if (blend) return
              const box = event.currentTarget.getBoundingClientRect()
              setWipe(Math.round((event.clientX - box.left) / box.width * 100))
            }}>
              <img src={previews[sourcePath]} alt={`Исходник: ${sourcePath}`} />
              <img src={previews[viewing]} alt={viewing} style={blend ? undefined : { clipPath: `inset(0 0 0 ${wipe}%)` }} />
              {!blend && <span className="image-studio-wipe-line" style={{ left: `${wipe}%` }} aria-hidden="true" />}
            </div>
            {!blend && <input type="range" min={0} max={100} value={wipe} aria-label="Шторка сравнения: левее — исходник, правее — результат" onChange={(event) => setWipe(Number(event.target.value))} />}
            <p className="image-studio-origin">
              <span className="image-studio-dim">← {sourcePath} · {viewing} →</span>{' '}
              <button type="button" className="image-studio-cancel" aria-pressed={blend} onClick={() => setBlend((prev) => !prev)}>
                {blend ? 'Шторкой' : 'Наложением'}
              </button>
              {blend && <span className="image-studio-dim"> — совпадающее выглядит чёрным</span>}
            </p>
          </div>
        }
        if (!previews[viewing]) return <p className="imgerr" role="alert">Превью ещё не загрузилось</p>
        if (annotating) {
          return <div className="image-studio-crop-stage image-studio-annotate"
            onPointerDown={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const point = { x: event.clientX - box.left, y: event.clientY - box.top }
              if (tool === 'text') {
                // Метка ставится кликом; текст берётся из поля панели.
                if (labelText.trim()) setStrokes((prev) => [...prev, { kind: 'text', color: penColor, x: point.x, y: point.y, text: labelText.trim(), size: penWidth === 3 ? 18 : 28 }])
                return
              }
              drawing.current = true
              setStrokes((prev) => [...prev,
                tool === 'pen'
                  ? { kind: 'pen', color: penColor, width: penWidth, points: [point] }
                  : { kind: tool, color: penColor, width: penWidth, from: point, to: point }])
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return
              const box = event.currentTarget.getBoundingClientRect()
              const point = { x: event.clientX - box.left, y: event.clientY - box.top }
              setStrokes((prev) => {
                const last = prev[prev.length - 1]
                if (!last) return prev
                if (last.kind === 'pen') return [...prev.slice(0, -1), { ...last, points: [...last.points, point] }]
                if (last.kind === 'arrow' || last.kind === 'rect') return [...prev.slice(0, -1), { ...last, to: point }]
                return prev
              })
            }}
            onPointerUp={() => { drawing.current = false }}>
            <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} draggable={false} />
            <svg className="image-studio-annotate-layer" aria-hidden="true">
              {strokes.map((shape, index) => {
                if (shape.kind === 'pen') return <polyline key={index} points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={shape.color} strokeWidth={shape.width} strokeLinecap="round" strokeLinejoin="round" />
                if (shape.kind === 'rect') return <rect key={index} x={Math.min(shape.from.x, shape.to.x)} y={Math.min(shape.from.y, shape.to.y)} width={Math.abs(shape.to.x - shape.from.x)} height={Math.abs(shape.to.y - shape.from.y)} fill="none" stroke={shape.color} strokeWidth={shape.width} />
                if (shape.kind === 'arrow') {
                  const [left, right] = arrowHead(shape.from, shape.to, Math.max(10, shape.width * 4))
                  return <g key={index} stroke={shape.color} strokeWidth={shape.width} fill="none" strokeLinecap="round">
                    <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} />
                    <polyline points={`${left.x},${left.y} ${shape.to.x},${shape.to.y} ${right.x},${right.y}`} />
                  </g>
                }
                return <text key={index} x={shape.x} y={shape.y} fill={shape.color} stroke="#fff" strokeWidth={2} paintOrder="stroke" fontWeight="bold" fontSize={shape.size} fontFamily="system-ui, sans-serif">{shape.text}</text>
              })}
            </svg>
          </div>
        }
        if (!cropping) {
          return <div className="image-studio-zoom-stage"
            onWheel={(event) => {
              event.preventDefault()
              setZoom((prev) => {
                const scale = Math.min(4, Math.max(1, prev.scale * Math.exp(-event.deltaY / 300)))
                return scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...prev, scale }
              })
            }}
            onDoubleClick={() => setZoom({ scale: 1, x: 0, y: 0 })}
            onPointerDown={(event) => {
              if (zoom.scale === 1) return
              panStart.current = { x: event.clientX, y: event.clientY, ox: zoom.x, oy: zoom.y }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!panStart.current) return
              const start = panStart.current
              setZoom((prev) => ({ ...prev, x: start.ox + (event.clientX - start.x), y: start.oy + (event.clientY - start.y) }))
            }}
            onPointerUp={() => { panStart.current = null }}
            role="presentation"
            title={zoom.scale > 1 ? 'Двойной клик — сбросить масштаб' : 'Колесо мыши — масштаб'}>
            <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} draggable={false}
              style={zoom.scale > 1 ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`, cursor: 'grab' } : undefined} data-zoom={zoom.scale > 1 ? zoom.scale.toFixed(2) : undefined} />
          </div>
        }
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
            const w = Math.abs(x - dragStart.current.x)
            // Фиксированное соотношение: высота следует за шириной.
            const h = cropRatio > 0 ? w / cropRatio : Math.abs(y - dragStart.current.y)
            const top = cropRatio > 0
              ? (y >= dragStart.current.y ? dragStart.current.y : dragStart.current.y - h)
              : Math.min(y, dragStart.current.y)
            setCropBox({ x: Math.min(x, dragStart.current.x), y: top, w, h })
          }}
          onPointerUp={() => { dragStart.current = null }}>
          <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} draggable={false} />
          {/* Правило третей: кадрировать «на глаз» без направляющих неудобно. */}
          <span className="image-studio-thirds" aria-hidden="true" />
          {cropBox && <span className="image-studio-crop-box" style={{ left: cropBox.x, top: cropBox.y, width: cropBox.w, height: cropBox.h }} aria-hidden="true" />}
          <p className="image-studio-origin"><span className="image-studio-dim">Выделите область мышью и нажмите «Вырезать».</span></p>
        </div>
      })()}
      {annotating && <p className="image-studio-origin image-studio-annotate-controls">
        {ANNOTATE_TOOLS.map((item) => <button key={item.tool} type="button" className="image-studio-cancel" aria-pressed={tool === item.tool} style={tool === item.tool ? { fontWeight: 700 } : undefined} onClick={() => setTool(item.tool)}>{item.label}</button>)}
        {tool === 'text' && <input className="image-studio-filename" aria-label="Текст метки" placeholder="Текст метки — затем кликните по картинке" value={labelText} onChange={(event) => setLabelText(event.target.value)} />}
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
        {[{ r: 0, label: 'Свободно' }, { r: 1, label: '1:1' }, { r: 16 / 9, label: '16:9' }, { r: 4 / 3, label: '4:3' }, { r: 9 / 16, label: '9:16' }, { r: 1200 / 630, label: 'OG' }].map((item) => (
          <button key={item.label} type="button" className="image-studio-cancel" aria-pressed={cropRatio === item.r} style={cropRatio === item.r ? { fontWeight: 700 } : undefined} onClick={() => { setCropRatio(item.r); setCropBox(null) }}>{item.label}</button>
        ))}
        {' '}
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
      {(() => {
        const chain = versionChain(files, viewing)
        if (chain.length < 2) return null
        return <p className="image-studio-origin image-studio-versions">
          <span className="image-studio-dim">Версии:</span>{' '}
          {chain.map((step, index) => <span key={step}>
            {index > 0 && ' → '}
            {step === viewing
              ? <strong>{step}</strong>
              : <button type="button" className="image-studio-cancel" onClick={() => { onCompareChange(false); onView(step) }}>{step}</button>}
          </span>)}
        </p>
      })()}
      {propsOpen && meta && <div className="image-studio-props" role="group" aria-label={`Свойства ${viewing}`}>
        <dl>
          <dt>Файл</dt><dd>{meta.path}</dd>
          <dt>Вес</dt><dd>{formatBytes(meta.size)}</dd>
          {dimensions[meta.path] && <><dt>Пиксели</dt><dd>{dimensions[meta.path]}</dd></>}
          <dt>Обновлён</dt><dd>{new Date(meta.updatedAt).toLocaleString('ru-RU')}</dd>
          {meta.tookMs !== undefined && <><dt>Ран</dt><dd>{Math.round(meta.tookMs / 1000)} с</dd></>}
          {meta.source && <><dt>Исходник</dt><dd>{meta.source}</dd></>}
          {meta.prompt && <><dt>Промпт</dt><dd>{meta.prompt}</dd></>}
        </dl>
        <button type="button" className="image-studio-cancel" onClick={() => {
          // Сводку удобно вставить в задачу: она объясняет, что это за файл.
          const lines = [
            `Файл: ${meta.path}`,
            `Вес: ${formatBytes(meta.size)}${dimensions[meta.path] ? ` · ${dimensions[meta.path]}` : ''}`,
            `Обновлён: ${new Date(meta.updatedAt).toLocaleString('ru-RU')}`,
            meta.source ? `Исходник: ${meta.source}` : '',
            meta.prompt ? `Промпт: ${meta.prompt}` : '',
            noteDraft.trim() ? `Заметка: ${noteDraft.trim()}` : ''
          ].filter(Boolean)
          void navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined)
        }}>Скопировать сводку</button>
        {onPalette && <span className="image-studio-palette">
          {palette === null
            ? <button type="button" className="image-studio-cancel" onClick={() => void onPalette(viewing).then(setPalette).catch(() => setPalette([]))}>Показать палитру</button>
            : palette.length === 0
              ? <span className="image-studio-dim">Палитру собрать не удалось</span>
              : <>
                  <span className="image-studio-dim">Палитра:</span>
                  {palette.map((color) => <button
                    key={color}
                    type="button"
                    className="image-studio-swatch"
                    style={{ background: color }}
                    aria-label={`Скопировать цвет ${color}`}
                    title={`${color} — скопировать`}
                    onClick={() => void navigator.clipboard?.writeText(color).catch(() => undefined)}
                  />)}
                  <span className="image-studio-dim">{palette.join(' ')}</span>
                </>}
        </span>}
        {onHistogram && <span className="image-studio-histogram-row">
          {histogram === null
            ? <button type="button" className="image-studio-cancel" onClick={() => void onHistogram(viewing).then(setHistogram).catch(() => setHistogram([]))}>Показать гистограмму</button>
            : histogram.length === 0
              ? <span className="image-studio-dim">Гистограмму собрать не удалось</span>
              : <>
                  <span className="image-studio-dim">Яркость:</span>
                  <span className="image-studio-histogram" role="img" aria-label={`Гистограмма яркости: ${histogram.length} столбиков, тени слева`}>
                    {histogram.map((height, index) => <span key={index} style={{ height: `${Math.max(2, height)}%` }} />)}
                  </span>
                </>}
        </span>}
        {onNoteChange && <span className="image-studio-note">
          <input
            aria-label={`Заметка к ${viewing}`}
            placeholder="Заметка: зачем эта картинка…"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onNoteChange(viewing, noteDraft) } }}
          />
          <button type="button" className="image-studio-cancel" disabled={noteDraft === (note ?? '')} onClick={() => onNoteChange(viewing, noteDraft)}>Сохранить заметку</button>
        </span>}
      </div>}
      <p className="image-studio-origin"><span className="image-studio-dim">← → — листать · Delete — удалить · Esc — закрыть{slideshow ? ' · слайдшоу идёт' : ''}</span></p>
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
