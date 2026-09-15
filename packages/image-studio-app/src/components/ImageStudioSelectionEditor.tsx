import { useRef, useState } from 'react'
import type { ImageStudioSelection } from '@shared/imageStudio'
import { Button } from '@voicechat/ui-kit'
import { detectImageObjects, magicWandMask, selectionBounds, type DetectedImageObject } from '../lib/imageSelection'

interface Props {
  path: string
  src: string
  busy?: boolean
  onRetouch: (selection: ImageStudioSelection, prompt: string) => Promise<void>
  onExtract: (selection: ImageStudioSelection) => Promise<void>
  onCancel: () => void
}

type Tool = 'rectangle' | 'lasso' | 'wand'
const RETOUCH_PRESETS = [
  'Естественно выровнять тон кожи, сохранить черты лица и текстуру',
  'Убрать мелкие дефекты кожи, сохранить поры и естественный свет',
  'Аккуратно поправить волосы, не менять лицо и фон',
  'Убрать выделенный предмет и реалистично восстановить фон',
  'Заменить выделенный предмет по описанию, сохранив свет и перспективу'
] as const
const ANALYSIS_SIDE = 1000

function canvasMask(mask: Uint8ClampedArray, width: number, height: number, naturalWidth: number, naturalHeight: number): { dataBase64: string; preview: string } {
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const context = small.getContext('2d')
  if (!context) throw new Error('Canvas недоступен')
  const image = context.createImageData(width, height)
  for (let index = 0; index < mask.length; index += 1) {
    const at = index * 4
    image.data[at] = 255
    image.data[at + 1] = 255
    image.data[at + 2] = 255
    image.data[at + 3] = mask[index]!
  }
  context.putImageData(image, 0, 0)
  const full = document.createElement('canvas')
  full.width = naturalWidth
  full.height = naturalHeight
  const fullContext = full.getContext('2d')
  if (!fullContext) throw new Error('Canvas недоступен')
  fullContext.fillStyle = '#000'
  fullContext.fillRect(0, 0, naturalWidth, naturalHeight)
  fullContext.imageSmoothingEnabled = false
  fullContext.drawImage(small, 0, 0, naturalWidth, naturalHeight)
  const maskData = fullContext.getImageData(0, 0, naturalWidth, naturalHeight)
  for (let index = 0; index < maskData.data.length; index += 4) maskData.data[index + 3] = 255
  fullContext.putImageData(maskData, 0, 0)
  const encoded = full.toDataURL('image/png')
  return { dataBase64: encoded.slice(encoded.indexOf(',') + 1), preview: small.toDataURL('image/png') }
}

export function ImageStudioSelectionEditor({ path, src, busy, onRetouch, onExtract, onCancel }: Props): JSX.Element {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [tool, setTool] = useState<Tool>('wand')
  const [selection, setSelection] = useState<ImageStudioSelection | null>(null)
  const [maskPreview, setMaskPreview] = useState<string | null>(null)
  const [lasso, setLasso] = useState<Array<{ x: number; y: number }>>([])
  const [objects, setObjects] = useState<DetectedImageObject[]>([])
  const [tolerance, setTolerance] = useState(48)
  const [prompt, setPrompt] = useState<string>(RETOUCH_PRESETS[0])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)

  const pointAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const image = imageRef.current
    if (!image?.naturalWidth) return null
    const box = image.getBoundingClientRect()
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null
    return {
      x: Math.max(0, Math.min(image.naturalWidth, (clientX - box.left) / box.width * image.naturalWidth)),
      y: Math.max(0, Math.min(image.naturalHeight, (clientY - box.top) / box.height * image.naturalHeight))
    }
  }

  const analysis = (): { data: Uint8ClampedArray; width: number; height: number; scaleX: number; scaleY: number } => {
    const image = imageRef.current
    if (!image?.naturalWidth) throw new Error('Изображение ещё загружается')
    const scale = Math.min(1, ANALYSIS_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas недоступен')
    context.drawImage(image, 0, 0, width, height)
    return { data: context.getImageData(0, 0, width, height).data, width, height, scaleX: image.naturalWidth / width, scaleY: image.naturalHeight / height }
  }

  const selectWand = (point: { x: number; y: number }): void => {
    const image = imageRef.current
    if (!image) return
    try {
      const sampled = analysis()
      const mask = magicWandMask(sampled.data, sampled.width, sampled.height, point.x / sampled.scaleX, point.y / sampled.scaleY, tolerance)
      const encoded = canvasMask(mask, sampled.width, sampled.height, image.naturalWidth, image.naturalHeight)
      setSelection({ kind: 'mask', width: image.naturalWidth, height: image.naturalHeight, dataBase64: encoded.dataBase64 })
      setMaskPreview(encoded.preview)
      setObjects([])
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const findObjects = (): void => {
    try {
      const sampled = analysis()
      const found = detectImageObjects(sampled.data, sampled.width, sampled.height, tolerance)
        .map((box) => ({ x: box.x * sampled.scaleX, y: box.y * sampled.scaleY, width: box.width * sampled.scaleX, height: box.height * sampled.scaleY, pixels: box.pixels }))
      setObjects(found)
      if (found[0]) setSelection({ kind: 'rectangle', x: found[0].x, y: found[0].y, width: found[0].width, height: found[0].height })
      setMaskPreview(null)
      setError(found.length ? null : 'Объекты не найдены. Выберите волшебной палочкой, рамкой или лассо.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const execute = async (action: () => Promise<void>): Promise<void> => {
    setWorking(true)
    setError(null)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setWorking(false) }
  }

  const selectedBounds = selection?.kind === 'mask' ? null : selection?.kind === 'rectangle' ? selection : selectionBounds(selection?.points ?? [])
  return <section className="image-studio-selection" aria-label={`Выделение объекта: ${path}`}>
    <header className="image-studio-selection-toolbar">
      <strong>Объект и ретушь</strong>
      <span className="image-studio-selection-tools" role="group" aria-label="Инструмент выделения">
        <button type="button" aria-pressed={tool === 'wand'} onClick={() => setTool('wand')}>Волшебная палочка</button>
        <button type="button" aria-pressed={tool === 'rectangle'} onClick={() => setTool('rectangle')}>Рамка</button>
        <button type="button" aria-pressed={tool === 'lasso'} onClick={() => setTool('lasso')}>Лассо</button>
      </span>
      <Button variant="ghost" onClick={findObjects}>Найти объекты</Button>
      <Button variant="ghost" onClick={() => { setSelection(null); setMaskPreview(null); setLasso([]); setObjects([]) }}>Сбросить</Button>
      <Button variant="ghost" onClick={onCancel}>Закрыть</Button>
    </header>
    <label className="image-studio-selection-tolerance">
      Чувствительность: {tolerance}
      <input type="range" min={8} max={160} value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} />
    </label>
    <div className="image-studio-selection-stage"
      onPointerDown={(event) => {
        const point = pointAt(event.clientX, event.clientY)
        if (!point) return
        if (tool === 'wand') { selectWand(point); return }
        start.current = point
        setMaskPreview(null)
        setObjects([])
        if (tool === 'lasso') setLasso([point])
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        const point = pointAt(event.clientX, event.clientY)
        if (!point) return
        if (tool === 'lasso') {
          setLasso((previous) => [...previous, point])
          setSelection((previous) => ({ kind: 'lasso', points: [...(previous?.kind === 'lasso' ? previous.points : [start.current!]), point] }))
        } else {
          setSelection({ kind: 'rectangle', x: Math.min(start.current.x, point.x), y: Math.min(start.current.y, point.y), width: Math.abs(point.x - start.current.x), height: Math.abs(point.y - start.current.y) })
        }
      }}
      onPointerUp={() => { start.current = null }}>
      <img ref={imageRef} src={src} alt={path} draggable={false} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      {maskPreview && <img className="image-studio-selection-mask" src={maskPreview} alt="Выделение волшебной палочкой" />}
      {naturalSize && selection?.kind === 'rectangle' && <span className="image-studio-selection-box" style={{ left: `${selection.x / naturalSize.width * 100}%`, top: `${selection.y / naturalSize.height * 100}%`, width: `${selection.width / naturalSize.width * 100}%`, height: `${selection.height / naturalSize.height * 100}%` }} />}
      {naturalSize && lasso.length > 1 && <svg className="image-studio-selection-overlay" viewBox={`0 0 ${naturalSize.width} ${naturalSize.height}`} aria-hidden="true"><polygon points={lasso.map((point) => `${point.x},${point.y}`).join(' ')} /></svg>}
      {naturalSize && objects.map((object, index) => <button key={index} type="button" className="image-studio-object-box" aria-label={`Выбрать найденный объект ${index + 1}`} style={{ left: `${object.x / naturalSize.width * 100}%`, top: `${object.y / naturalSize.height * 100}%`, width: `${object.width / naturalSize.width * 100}%`, height: `${object.height / naturalSize.height * 100}%` }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'rectangle', x: object.x, y: object.y, width: object.width, height: object.height }) }}>{index + 1}</button>)}
    </div>
    <div className="image-studio-selection-controls">
      <label>Что изменить
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Например: убрать блик на очках, сохранить лицо" />
      </label>
      <div className="image-studio-retouch-presets" aria-label="Пресеты ретуши">
        {RETOUCH_PRESETS.map((preset) => <button key={preset} type="button" onClick={() => setPrompt(preset)}>{preset.split(',')[0]}</button>)}
      </div>
      <p className="image-studio-dim">{selection ? (selectedBounds ? `Выделено: ${Math.round(selectedBounds.width)}×${Math.round(selectedBounds.height)} px` : 'Выделена область волшебной палочкой') : 'Сначала выделите предмет или область.'}</p>
      {error && <p className="imgerr" role="alert">{error}</p>}
      <div className="image-studio-selection-actions">
        <Button disabled={!selection || !prompt.trim() || busy || working} onClick={() => selection && void execute(() => onRetouch(selection, prompt.trim()))}>Изменить только выделенное</Button>
        <Button variant="secondary" disabled={!selection || busy || working} onClick={() => selection && void execute(() => onExtract(selection))}>Извлечь объект отдельно</Button>
      </div>
    </div>
  </section>
}
