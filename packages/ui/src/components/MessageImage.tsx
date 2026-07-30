// Картинка, созданная моделью, прямо в сообщении. Путь абсолютный, и лежать файл
// может в двух местах: на СЕРВЕРЕ (встроенные генераторы CLI пишут в профиль
// пользователя) или на МАШИНЕ-агенте (модель сама создала файл там). Байты в обоих
// случаях приходят base64 и показываются как data-URL: обычный src с абсолютным
// путём браузер не откроет.
//
// Рамка — общая (ToolFrame): шапка с кнопками и разворот на весь экран. В
// развороте — зум колесом и перетаскивание, как в просмотрщике ChatGPT.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { imageMime, imageName, machineImageUrls, type ImageRef } from '@shared/images'
import type { ServerFileInfo } from '@shared/protocol'
import type { AgentInfo } from '@shared/agentProtocol'
import { copyImage } from '../lib/clipboard'
import { Dots } from './animations'
import { IconButton } from './ui/IconButton'
import { ToolFrame, type ToolFrameControl } from './ToolFrame'
import type { MachineOps, UtilityVariant } from './machine'

export interface MessageImageProps {
  image: ImageRef
  /** Машина, на которой шёл ход; используется, если в блоке своя не указана. */
  execAgentId?: string | null
  /** Нужна только операция чтения файла — берём её из общего контракта машин. */
  ops: Pick<MachineOps, 'read'>
  /** Чтение файла с диска сервера; null — сервер такого файла у себя не знает. */
  readServerFile?: (path: string) => Promise<ServerFileInfo | null>
  /** Машины: из живого AgentInfo берётся текущий адрес раздачи картинок. */
  agents?: AgentInfo[]
  /** Ход ещё идёт: файла может пока не быть — ждём его, а не ругаемся. */
  live?: boolean
  variant?: UtilityVariant
  onClose?: () => void
  /** Открыть расположение файла на выбранной машине. */
  onOpenInExplorer?: (agentId: string, path: string) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
/** Исходный вид: без приближения и сдвига. */
const FLAT = { zoom: MIN_ZOOM, x: 0, y: 0 }
/** Пауза между попытками дочитать файл, пока ход не завершён. */
const RETRY_MS = 700
/** Предохранитель от бесконечного опроса, если ход «завис» живым. */
const MAX_ATTEMPTS = 90
/** Сколько ждём картинку с прямого адреса машины, прежде чем идти к следующему. */
const DIRECT_URL_TIMEOUT_MS = 4000

/** Сохранение файла по ссылке (клик по временному <a download>). */
function saveAs(href: string, name: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** base64 → байты (atob отдаёт «бинарную строку», её и разворачиваем). */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Картинка из ответа модели: подгружает файл и показывает его в рамке тула. */
export function MessageImage({
  image,
  execAgentId = null,
  ops,
  readServerFile,
  agents = [],
  live = false,
  variant = 'embedded',
  onClose,
  onOpenInExplorer
}: MessageImageProps): JSX.Element {
  const agentId = image.agentId ?? (execAgentId && execAgentId !== 'none' ? execAgentId : null)
  const name = imageName(image.path)
  const mime = imageMime(image.path)
  // Сам объект ops пересоздаётся на каждый рендер хоста — в зависимостях держим
  // только функцию чтения, иначе эффект перечитывал бы файл бесконечно.
  const { read } = ops

  // Прямые адреса машины: собираются на каждый рендер из живого AgentInfo,
  // поэтому сменившийся IP подхватывается сразу после обновления списка машин.
  const hostUrls = machineImageUrls(
    image.path,
    agents.find((a) => a.id === agentId && a.online)?.imageHost
  )
  // Какой адрес пробуем сейчас; onError двигает к следующему, дальше — байты
  // через сервер (машина может быть недоступна из браузера — другая сеть/NAT).
  const [urlIndex, setUrlIndex] = useState(0)
  const directUrl = hostUrls[urlIndex]
  // Недоступный адрес (машина в другой сети, за NAT) браузер держит до своего
  // таймаута соединения — это десятки секунд НА КАЖДЫЙ адрес. Столько не ждём:
  // не пришла картинка за DIRECT_URL_TIMEOUT_MS — двигаемся к следующему адресу,
  // а после последнего откатываемся на байты через сервер.
  const directOk = useRef(false)
  useEffect(() => {
    if (!directUrl) return
    directOk.current = false
    const t = setTimeout(() => {
      if (!directOk.current) setUrlIndex((i) => i + 1)
    }, DIRECT_URL_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [directUrl])

  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  // Номер попытки: пока идёт ход, файл может ещё дописываться — перечитываем.
  const [attempt, setAttempt] = useState(0)
  const bytes = useRef<Uint8Array | null>(null)

  useEffect(() => {
    // Пока есть непроверенный адрес машины — байты не тянем вовсе.
    if (directUrl) return
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined

    // Где искать файл. Явный agentId в блоке — значит модель сама сказала «на
    // машине». Иначе сначала спрашиваем сервер: встроенные генераторы картинок
    // (напр. инструмент Codex) пишут их в профиль пользователя НА СЕРВЕРЕ, даже
    // когда команды хода уходили на машину. Сервер отвечает null, если такого
    // файла у себя не знает, — тогда пробуем машину.
    const load = async (): Promise<string> => {
      if (!image.agentId && readServerFile) {
        const onServer = await readServerFile(image.path)
        if (onServer?.dataBase64) return onServer.dataBase64
      }
      if (!agentId) {
        throw new Error('Файл не найден на сервере, а машина для этого ответа не выбрана')
      }
      const res = await read(agentId, image.path)
      const b64 = res.dataBase64 ?? ''
      if (!b64) throw new Error('Файл пустой или недоступен')
      return b64
    }

    void load()
      .then((b64) => {
        if (!alive) return
        bytes.current = decodeBase64(b64)
        setError(null)
        setSrc(`data:${mime};base64,${b64}`)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        // Ход ещё идёт — файл, скорее всего, просто не дописан: ждём и пробуем
        // снова. Ошибку покажем, только когда ход закончится, а файла всё нет.
        if (live && attempt < MAX_ATTEMPTS) {
          retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS)
        }
      })
    return () => {
      alive = false
      if (retry) clearTimeout(retry)
    }
  }, [directUrl, agentId, image.agentId, image.path, mime, read, readServerFile, live, attempt])

  // Показываем прямой адрес машины, если он есть; иначе — байты через сервер.
  const shownSrc = directUrl ?? src
  const ready = Boolean(shownSrc)

  /** Байты картинки для «скачать»/«копировать» (с машины — докачиваем по URL). */
  const blobOf = async (): Promise<Blob | null> => {
    if (bytes.current) return new Blob([bytes.current.slice()], { type: mime })
    if (!directUrl) return null
    // На агенте выставлен access-control-allow-origin: * — fetch пройдёт.
    const res = await fetch(directUrl)
    if (!res.ok) return null
    return res.blob()
  }

  const download = (): void => {
    if (!shownSrc) return
    // data-URL с сервера отдаём ссылке как есть. Для прямого адреса машины так
    // нельзя: у кросс-доменной ссылки браузер игнорирует download и просто
    // открывает картинку — поэтому сначала докачиваем байты в blob.
    if (!directUrl) {
      saveAs(shownSrc, name)
      return
    }
    void blobOf().then((blob) => {
      const url = blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
      saveAs(url ?? shownSrc, name)
      if (url) URL.revokeObjectURL(url)
    })
  }

  const copy = (): void => {
    void blobOf()
      .then((blob) => (blob ? copyImage(blob) : false))
      .catch(() => false)
      .then((ok) => {
        setCopied(ok ? 'ok' : 'fail')
        setTimeout(() => setCopied(null), 1500)
      })
  }

  const actions = (
    <>
      {agentId && onOpenInExplorer && (
        <IconButton size="sm"
          title="Показать в проводнике"
          aria-label="Показать картинку в проводнике"
          onClick={() => onOpenInExplorer(agentId, image.path)}
        >
          📂
        </IconButton>
      )}
      <IconButton size="sm" title="Скачать" aria-label="Скачать картинку" disabled={!ready} onClick={download}>
        ⬇
      </IconButton>
      <IconButton size="sm"
        title={copied === 'fail' ? 'Не удалось скопировать' : 'Копировать картинку'}
        aria-label="Копировать картинку"
        disabled={!ready}
        onClick={copy}
      >
        {copied === 'ok' ? '✓' : copied === 'fail' ? '✕' : '⧉'}
      </IconButton>
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
          {shownSrc ? (
            <ImageSurface
              src={shownSrc}
              alt={image.caption ?? name}
              ctl={ctl}
              // Машина недоступна из этой сети — пробуем следующий её адрес, а
              // когда они кончатся, откатываемся на чтение байтов через сервер.
              onFail={directUrl ? () => setUrlIndex((i) => i + 1) : undefined}
              onOk={() => {
                directOk.current = true
              }}
            />
          ) : error && !live ? (
            <p className="imgerr" role="alert">
              {error}
              <span className="imgpath">{image.path}</span>
            </p>
          ) : (
            // Пока файла нет — плитка-заглушка с бегущим бликом, как в ChatGPT.
            <div className="imgskel" data-testid="image-loading" aria-live="polite">
              <span className="imgskel-label">
                <Dots />
                {live ? 'Рисую картинку…' : 'Загрузка картинки…'}
              </span>
            </div>
          )}
          {image.caption && shownSrc && <p className="imgcap">{image.caption}</p>}
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
  ctl,
  onFail,
  onOk
}: {
  src: string
  alt: string
  ctl: ToolFrameControl
  /** Картинка не загрузилась по этому адресу (актуально для прямого URL машины). */
  onFail?: () => void
  /** Картинка по текущему src загрузилась (гасит таймаут перебора адресов). */
  onOk?: () => void
}): JSX.Element {
  const { fullscreen, setFullscreen } = ctl
  const surface = useRef<HTMLDivElement>(null)
  // Проявление: пока браузер не декодировал картинку, показываем её размытой и
  // уменьшенной, после onLoad снимаем размытие — тот же «unblur», что в ChatGPT.
  // Кэшированная картинка может успеть загрузиться до навешивания onLoad, поэтому
  // сверяемся с img.complete на монтировании.
  const [shown, setShown] = useState(false)
  const loaded = (): void => {
    setShown(true)
    onOk?.()
  }
  const reveal = (el: HTMLImageElement | null): void => {
    if (el?.complete) loaded()
  }
  const revealClass = shown ? 'imgfade imgfade--on' : 'imgfade'
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
        <img
          ref={reveal}
          className={revealClass}
          src={src}
          alt={alt}
          decoding="async"
          data-testid="message-image"
          onLoad={loaded}
          onError={onFail}
        />
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
        ref={reveal}
        className={revealClass}
        src={src}
        alt={alt}
        decoding="async"
        data-testid="message-image"
        onLoad={loaded}
        onError={onFail}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      />
    </div>
  )
}
