import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { scaleImagePoint, type ImagePoint, type ImageRetouchSelection } from '@shared/imageRetouch'
import type { MessageAttachment } from '@shared/types'

export interface ImageRetouchEditorProps {
  src: string
  source: MessageAttachment
  conversationId: string
  initialSelection?: ImageRetouchSelection
  onClose(): void
  onDone(image: MessageAttachment): void
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать референс'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export function ImageRetouchEditor({ src, source, conversationId, initialSelection, onClose, onDone }: ImageRetouchEditorProps): JSX.Element {
  const imageRef = useRef<HTMLImageElement>(null)
  const [tool, setTool] = useState<'rectangle' | 'lasso'>('rectangle')
  const [selection, setSelection] = useState<ImageRetouchSelection | null>(initialSelection ?? null)
  const [draft, setDraft] = useState<ImagePoint[]>([])
  const [start, setStart] = useState<ImagePoint | null>(null)
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState<MessageAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const pointOf = (event: ReactPointerEvent): ImagePoint => {
    const image = imageRef.current!
    const box = image.getBoundingClientRect()
    return scaleImagePoint({ x: event.clientX - box.left, y: event.clientY - box.top }, { width: box.width, height: box.height }, { width: image.naturalWidth, height: image.naturalHeight })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image?.naturalWidth) return
    canvas.width = image.clientWidth
    canvas.height = image.clientHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const sx = canvas.width / image.naturalWidth
    const sy = canvas.height / image.naturalHeight
    ctx.fillStyle = 'rgba(255, 45, 70, .28)'
    ctx.strokeStyle = '#ff2d46'
    ctx.lineWidth = 2
    const active = selection ?? (tool === 'lasso' && draft.length > 1 ? { kind: 'lasso' as const, points: draft } : null)
    if (!active) return
    ctx.beginPath()
    if (active.kind === 'rectangle') ctx.rect(active.x * sx, active.y * sy, active.width * sx, active.height * sy)
    else active.points.forEach((point, index) => index ? ctx.lineTo(point.x * sx, point.y * sy) : ctx.moveTo(point.x * sx, point.y * sy))
    if (active.kind === 'lasso') ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }, [selection, draft, tool])

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = pointOf(event)
    setError(null)
    if (tool === 'rectangle') {
      setStart(point)
      setSelection({ kind: 'rectangle', x: point.x, y: point.y, width: 0, height: 0 })
    } else {
      setDraft([point])
      setSelection(null)
    }
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!(event.buttons & 1)) return
    const point = pointOf(event)
    if (tool === 'rectangle' && start) {
      setSelection({ kind: 'rectangle', x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) })
    } else if (tool === 'lasso' && draft.length) setDraft((points) => [...points, point])
  }
  const pointerUp = (): void => {
    setStart(null)
    if (tool === 'lasso' && draft.length >= 3) setSelection({ kind: 'lasso', points: draft })
    setDraft([])
  }

  const addReferences = async (files: FileList | null): Promise<void> => {
    if (!files) return
    try {
      const uploaded = await Promise.all([...files].filter((file) => file.type.startsWith('image/')).map(async (file) => window.api['uploads:add']({ name: file.name, mimeType: file.type, dataBase64: await fileBase64(file), ...(source.agentId ? { agentId: source.agentId } : {}) })))
      setReferences((current) => [...current, ...uploaded.map((file) => ({ uploadId: file.id, path: file.path, name: file.name, mimeType: file.mimeType, size: file.size, ...(file.agentId ? { agentId: file.agentId } : {}) }))])
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const submit = async (): Promise<void> => {
    if (!selection) { setError('Сначала выделите область прямоугольником или лассо'); return }
    if (!prompt.trim()) { setError('Введите описание ретуши'); return }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api['images:retouch']({ conversationId, source, selection, prompt, ...(references.length ? { references } : {}) })
      onDone(result.image)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <div className="retouch-backdrop" role="dialog" aria-modal="true" aria-label="Локальная AI-ретушь">
    <div className="retouch-editor">
      <div className="retouch-toolbar">
        <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => { setTool('rectangle'); setSelection(null) }}>Прямоугольник</button>
        <button className={tool === 'lasso' ? 'active' : ''} onClick={() => { setTool('lasso'); setSelection(null) }}>Лассо</button>
        <button onClick={() => { setSelection(null); setDraft([]) }}>Очистить</button>
        <button onClick={onClose}>Закрыть</button>
      </div>
      <div className="retouch-canvas-wrap">
        <img ref={imageRef} src={src} alt={source.name} onLoad={() => setSelection((value) => value ? { ...value } : value)} draggable={false} />
        <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} />
      </div>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Например: убрать складку, сохранив кружево, швы и фактуру" aria-label="Описание ретуши" />
      <label className="retouch-reference">Референсы (необязательно)<input type="file" accept="image/*" multiple onChange={(event) => void addReferences(event.target.files)} /></label>
      {references.length > 0 && <p>{references.map((file) => file.name).join(', ')}</p>}
      {error && <p className="imgerr" role="alert">{error}</p>}
      <button disabled={busy || !selection || !prompt.trim()} onClick={() => void submit()}>{busy ? 'Обработка…' : 'Выполнить ретушь'}</button>
    </div>
  </div>
}
