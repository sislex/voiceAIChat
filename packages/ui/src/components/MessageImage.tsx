// Картинка, созданная моделью, прямо в сообщении. Файл лежит на машине-агенте,
// поэтому байты тянем через fs.read и показываем data-URL: обычного src с
// абсолютным путём браузер не откроет.
//
// Рамка — общая (ToolFrame): шапка с кнопками и разворот на весь экран. В
// развороте — зум колесом и перетаскивание, как в просмотрщике ChatGPT.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { imageMime, imageName, type ImageRef } from '@shared/images'
import { copyImage } from '../lib/clipboard'
import { Dots } from './animations'
import { ToolFrame, type ToolFrameControl } from './ToolFrame'
import type { MachineOps, UtilityVariant } from './machine'

export interface MessageImageProps {
  image: ImageRef
  /** Машина, на которой шёл ход; используется, если в блоке своя не указана. */
  execAgentId?: string | null
  /** Нужна только операция чтения файла — берём её из общего контракта машин. */
  ops: Pick<MachineOps, 'read'>
  variant?: UtilityVariant
  onClose?: () => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
/** Исходный вид: без приближения и сдвига. */
const FLAT = { zoom: MIN_ZOOM, x: 0, y: 0 }

/** base64 → байты (atob отдаёт «бинарную строку», её и разворачиваем). */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Картинка из ответа модели: подгружает файл с машины и показывает в рамке тула. */
export function MessageImage({
  image,
  execAgentId = null,
  ops,
  variant = 'embedded',
  onClose
}: MessageImageProps): JSX.Element {
  const agentId = image.agentId ?? (execAgentId && execAgentId !== 'none' ? execAgentId : null)
  const name = imageName(image.path)
  const mime = imageMime(image.path)
  // Сам объект ops пересоздаётся на каждый рендер хоста — в зависимостях держим
  // только функцию чтения, иначе эффект перечитывал бы файл бесконечно.
  const { read } = ops

  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const bytes = useRef<Uint8Array | null>(null)

  useEffect(() => {
    if (!agentId) {
      setError('Файл на машине, а машина для этого ответа не выбрана')
      return
    }
    let alive = true
    setSrc(null)
    setError(null)
    void read(agentId, image.path)
      .then((res) => {
        if (!alive) return
        const b64 = res.dataBase64 ?? ''
        if (!b64) {
          setError('Файл пустой или недоступен')
          return
        }
        bytes.current = decodeBase64(b64)
        setSrc(`data:${mime};base64,${b64}`)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [agentId, image.path, mime, read])

  const download = (): void => {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const copy = (): void => {
    if (!bytes.current) return
    // Копия буфера: Blob не должен зависеть от переиспользования исходного массива.
    const blob = new Blob([bytes.current.slice()], { type: mime })
    void copyImage(blob).then((ok) => {
      setCopied(ok ? 'ok' : 'fail')
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const actions = (
    <>
      <button className="xbtn" title="Скачать" aria-label="Скачать картинку" disabled={!src} onClick={download}>
        ⬇
      </button>
      <button
        className="xbtn"
        title={copied === 'fail' ? 'Не удалось скопировать' : 'Копировать картинку'}
        aria-label="Копировать картинку"
        disabled={!src}
        onClick={copy}
      >
        {copied === 'ok' ? '✓' : copied === 'fail' ? '✕' : '⧉'}
      </button>
    </>
  )

  return (
    <ToolFrame
      // В шапке — имя файла; подпись модели живёт под картинкой, чтобы не дублировать.
      title={name}
      variant={variant}
      onClose={onClose}
      className="util-embed--img"
      testId={variant === 'modal' ? 'image-overlay' : 'image-embed'}
      actions={actions}
    >
      {(ctl) => (
        <div className="imgbody">
          {error ? (
            <p className="imgerr" role="alert">
              {error}
              <span className="imgpath">{image.path}</span>
            </p>
          ) : !src ? (
            <div className="imgload" data-testid="image-loading">
              <Dots />
              <span>Загрузка картинки…</span>
            </div>
          ) : (
            <ImageSurface src={src} alt={image.caption ?? name} ctl={ctl} />
          )}
          {image.caption && !error && <p className="imgcap">{image.caption}</p>}
        </div>
      )}
    </ToolFrame>
  )
}

/**
 * Полотно с картинкой. В обычном виде — превью, клик разворачивает на весь экран.
 * В развороте — зум колесом (к курсору), перетаскивание и сброс по двойному клику.
 */
function ImageSurface({
  src,
  alt,
  ctl
}: {
  src: string
  alt: string
  ctl: ToolFrameControl
}): JSX.Element {
  const { fullscreen, setFullscreen } = ctl
  const surface = useRef<HTMLDivElement>(null)
  // Масштаб и сдвиг — одним состоянием: зум к курсору меняет их согласованно.
  const [view, setView] = useState(FLAT)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // Свернули разворот — возвращаем масштаб, чтобы превью не осталось «уехавшим».
  useEffect(() => {
    if (!fullscreen) setView(FLAT)
  }, [fullscreen])

  // Колесо мыши: React вешает wheel пассивно, поэтому свой слушатель — иначе
  // preventDefault не сработает и вместе с зумом поедет страница под оверлеем.
  const applyWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const el = surface.current
    if (!el) return
    const box = el.getBoundingClientRect()
    // Точка под курсором в координатах полотна (центр — 0,0).
    const cx = e.clientX - box.left - box.width / 2
    const cy = e.clientY - box.top - box.height / 2
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY / 300)))
      if (zoom === v.zoom) return v
      if (zoom === MIN_ZOOM) return FLAT
      // Держим точку под курсором на месте: сдвиг пропорционален приросту масштаба.
      const k = zoom / v.zoom
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })
  }, [])

  useEffect(() => {
    const el = surface.current
    if (!el || !fullscreen) return
    el.addEventListener('wheel', applyWheel, { passive: false })
    return () => el.removeEventListener('wheel', applyWheel)
  }, [fullscreen, applyWheel])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!fullscreen || view.zoom === MIN_ZOOM) return
    drag.current = { x: e.clientX, y: e.clientY, px: view.x, py: view.y }
    // Захват указателя — не везде есть (jsdom), а перетаскивание работает и без него.
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    setView((v) => ({ ...v, x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) }))
  }
  const endDrag = (): void => {
    drag.current = null
  }

  // Двойной клик: приближает вдвое, а из приближённого возвращает к исходному.
  const onDoubleClick = (): void => {
    if (!fullscreen) return
    setView((v) => (v.zoom > MIN_ZOOM ? FLAT : { zoom: 2, x: 0, y: 0 }))
  }

  // Превью: клик разворачивает. В развороте клик занят зумом/перетаскиванием,
  // поэтому кнопкой оборачиваем только превью.
  if (!fullscreen) {
    return (
      <button
        className="imgprev"
        title="Открыть на весь экран"
        aria-label="Открыть картинку на весь экран"
        onClick={() => setFullscreen(true)}
      >
        <img src={src} alt={alt} data-testid="message-image" />
      </button>
    )
  }

  return (
    <div
      ref={surface}
      className={view.zoom > MIN_ZOOM ? 'imgsurf imgsurf--zoomed' : 'imgsurf'}
      data-testid="image-surface"
      data-zoom={view.zoom.toFixed(2)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
    >
      <img
        src={src}
        alt={alt}
        data-testid="message-image"
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      />
    </div>
  )
}
