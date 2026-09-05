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
import { MOBILE_QUERY, useMediaQuery } from '../lib/mediaQuery'

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
  /** Гистограммы по каналам R/G/B: перекос цвета по яркости не виден. */
  onChannels?: (path: string) => Promise<{ r: number[]; g: number[]; b: number[] }>
  /** Избранное открытого файла: пометить можно не выходя из просмотра. */
  starred?: boolean
  onToggleStar?: (path: string) => void
  /** Готовность открытого файла: пусто → черновик → готово. */
  status?: 'draft' | 'ready' | undefined
  onCycleStatus?: (path: string) => void
  /** В каких наборах лежит файл — видно в свойствах. */
  sets?: string[]
  /** Дерево версий: путь и уровень вложенности (правка правки — второй). */
  versions?: Array<{ path: string; depth: number }>
  /** Факты о содержимом: настоящий тип, прозрачность, число цветов. */
  onFacts?: (path: string) => Promise<{ type: string | null; mismatch: string | null; alpha: boolean; colors: number }>
  /** Найти этот кадр в сетке: закрыть просмотр и подсветить карточку. */
  onLocate?: (path: string) => void
  /** Открыли ради показа: слайдшоу запускается само, не дожидаясь кнопки. */
  autoSlideshow?: boolean
  onAutoSlideshowUsed?: () => void
  /** Открыли клавишей «i»: свойства раскрыты сразу. */
  autoProps?: boolean
  onAutoPropsUsed?: () => void
  onDelete: (path: string) => void
  onClose: () => void
}

/** Шаг слайдшоу: меньше — не успеваешь рассмотреть, больше — уже не показ. */
const SLIDESHOW_MS = 3000
/** Шаги показа: быстро пролистать пачку, рассмотреть или показать другому. */
const SLIDESHOW_STEPS = [3000, 6000, 10000] as const
/** Сколько кадров ленты держать по каждую сторону от текущего. */
const STRIP_RADIUS = 12
/** На телефоне лента уже: двадцать пять миниатюр там не нужны и не влезают. */
const STRIP_RADIUS_PHONE = 5
/** Фоны подложки: прозрачный PNG читается по-разному на каждом из них. */
const VIEWER_BACKGROUNDS = ['checker', 'light', 'dark'] as const
type ViewerBackground = (typeof VIEWER_BACKGROUNDS)[number]
const BACKGROUND_LABELS: Record<ViewerBackground, string> = { checker: 'шахматка', light: 'светлый', dark: 'тёмный' }

/** Виды направляющих: третей, центр, золотое сечение — и без них. */
const GUIDE_MODES = ['thirds', 'center', 'golden', 'none'] as const
type GuideMode = (typeof GUIDE_MODES)[number]
const GUIDE_LABELS: Record<GuideMode, string> = { thirds: 'трети', center: 'центр', golden: 'золотое сечение', none: 'выключены' }

export function ImageStudioViewer({ viewing, busy, files, previews, dimensions, compare, compareWith, compareGrid, formatBytes, canStep, onCompareChange, onView, onStep, onUsePrompt, onPickForEdit, onVariate, onCrop, onAnnotate, onDownload, onCopy, note, onNoteChange, onPalette, onHistogram, onChannels, starred, onToggleStar, status, onCycleStatus, sets, versions, onFacts, onLocate, autoSlideshow, onAutoSlideshowUsed, autoProps, onAutoPropsUsed, onDelete, onClose, position }: Props): JSX.Element {
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
  /**
   * Поворот **просмотра**, не файла: перевёрнутый кадр надо сначала увидеть
   * правильно, а уже потом решать, поворачивать ли его насовсем. Сбрасывается
   * при листании — к следующему файлу он отношения не имеет.
   */
  const [spin, setSpin] = useState(0)
  /**
   * Лента миниатюр под кадром: листать стрелками по одному — долго, когда
   * знаешь, что нужный кадр «где-то через пять». По умолчанию свёрнута:
   * лайтбокс открывают, чтобы смотреть картинку, а не список.
   */
  const [strip, setStrip] = useState(false)
  const phone = useMediaQuery(MOBILE_QUERY)
  /**
   * Инверсия **просмотра**: быстрый способ увидеть, как картинка ляжет на
   * тёмный фон и не потеряется ли контраст. Файл не меняется — для этого есть
   * трансформация «Инвертировать».
   */
  const [inverted, setInverted] = useState(false)
  /**
   * Лупа: круг с увеличенным фрагментом под курсором. Для «рассмотреть глаз
   * на портрете» зум с панорамированием — слишком много движений, а лупа
   * показывает деталь, не теряя всю картинку из вида.
   */
  const [loupe, setLoupe] = useState(false)
  const [probe, setProbe] = useState<{ x: number; y: number; px: number; py: number; color: string | null } | null>(null)
  /** Канва 1×1 для чтения цвета: пересоздавать её на каждое движение мыши дорого. */
  const probeCanvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => { setInverted(false) }, [viewing])
  useEffect(() => { setSpin(0) }, [viewing])
  /** Слайдшоу: сам листает вперёд, пока не выключат или не начнут править. */
  const [slideshow, setSlideshow] = useState(false)
  /** Скорость показа: три секунды на кадр — «пролистать», десять — «показать». */
  const [slideshowMs, setSlideshowMs] = useState<number>(SLIDESHOW_MS)
  // Открыли кнопкой «Показ» — начинаем сразу: иначе после открытия надо ещё
  // найти в шапке треугольник.
  useEffect(() => {
    if (!autoSlideshow) return
    setSlideshow(true)
    onAutoSlideshowUsed?.()
  }, [autoSlideshow, onAutoSlideshowUsed])
  useEffect(() => {
    if (!autoProps) return
    setPropsOpen(true)
    onAutoPropsUsed?.()
  }, [autoProps, onAutoPropsUsed])
  /** Меню «Ещё» шапки: вид, а не состояние картинки — держим здесь. */
  const [more, setMore] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!more) return
    const close = (event: PointerEvent): void => {
      if (!moreMenuRef.current?.contains(event.target as Node) && event.target !== moreButtonRef.current) setMore(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [more])
  // Переключились на соседний кадр — меню предыдущего закрываем: оно про него.
  useEffect(() => setMore(false), [viewing])
  /** Раскрытая панель свойств: полная мета и заметка одним списком. */
  const [propsOpen, setPropsOpen] = useState(false)
  /** Полный экран: браузерный fullscreen на теле лайтбокса. */
  const [fullscreen, setFullscreen] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  // Выход из полного экрана бывает и мимо нашей кнопки (Esc, жест системы) —
  // состояние обязано следовать за браузером, иначе подпись кнопки врёт.
  useEffect(() => {
    const sync = (): void => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  /** Доминирующие цвета открытой картинки; null — ещё не считали. */
  const [palette, setPalette] = useState<string[] | null>(null)
  /** Гистограмма яркости; null — ещё не считали. */
  const [histogram, setHistogram] = useState<number[] | null>(null)
  /** Гистограммы по каналам; null — ещё не считали (считаем по кнопке). */
  const [channels, setChannels] = useState<{ r: number[]; g: number[]; b: number[] } | null>(null)
  /** Факты о содержимом; null — ещё не спрашивали (чтение файла не бесплатно). */
  const [facts, setFacts] = useState<{ type: string | null; mismatch: string | null; alpha: boolean; colors: number } | null>(null)
  /**
   * Направляющие: раньше трети висели всегда, а они нужны не всем и не всегда.
   * Кнопка ведёт по кругу: трети → центр → золотое сечение → без них.
   */
  const [guides, setGuides] = useState<GuideMode>('thirds')
  // Листаем — палитра и гистограмма прежнего кадра к новому отношения не имеют.
  useEffect(() => { setPalette(null); setHistogram(null); setChannels(null); setFacts(null) }, [viewing])
  /** Черновик заметки: пишем в панель по «Сохранить», а не на каждый символ. */
  const [noteDraft, setNoteDraft] = useState(note ?? '')
  // Листаем — заметка в поле должна стать заметкой нового файла.
  useEffect(() => { setNoteDraft(note ?? '') }, [viewing, note])
  // Любой режим правки останавливает показ: иначе картинка уедет из-под кисти.
  const stopSlideshow = (): void => setSlideshow(false)
  useEffect(() => {
    if (!slideshow || !canStep) return
    const timer = setInterval(() => onStep(1), slideshowMs)
    return () => clearInterval(timer)
  }, [slideshow, canStep, onStep, slideshowMs])
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
      // Масштаб клавишами: «,» и «.» стоят рядом с «<» и «>» на латинской
      // раскладке, «0» — общепринятый сброс.
      if (event.key === ',' || event.key === '<') { zoomBy(-0.25); return }
      if (event.key === '.' || event.key === '>') { zoomBy(0.25); return }
      if (event.key === '0') { setZoom({ scale: 1, x: 0, y: 0 }); return }
      if (event.key.toLowerCase() === 'f' && onToggleStar) { onToggleStar(viewing); return }
      // Delete — то же удаление с confirm, что и кнопкой корзины.
      if (event.key === 'Delete' || event.key === 'Backspace') onDelete(viewing)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep, onDelete, viewing, onToggleStar])
  const meta = files.find((file) => file.path === viewing)
  const sourceInGallery = meta?.source && files.some((file) => file.path === meta.source)

  useEffect(() => { setZoom({ scale: 1, x: 0, y: 0 }) }, [viewing])
  useEffect(() => { if (!compare) setBlend(false) }, [compare])
  const positionLabel = position && position.total > 1 ? ` · ${position.index + 1} из ${position.total}` : ''
  return <ToolFrame
    title={compare ? `${viewing} — сравнение с исходником` : `${viewing}${positionLabel}`}
    onClose={onClose}
    /**
     * Esc при увеличении или повороте — «вернуться к целой картинке», а не
     * «закрыть»: закрывать лайтбокс, потеряв масштаб, приходилось по ошибке.
     * Свой слушатель тут не поможет — Esc забирает общий стек окон в фазе
     * перехвата, и перебить его можно только этим пропом.
     */
    onEscape={() => {
      // Открытое меню шапки съедает Esc первым: закрывать картинку, пока
      // человек смотрит список действий, — не то, чего он ждёт. Свой
      // слушатель на window тут не поможет: `ToolFrame` регистрируется
      // раньше меню и гасит событие до него — только этот контракт и работает.
      if (more) { setMore(false); moreButtonRef.current?.focus(); return true }
      if (zoom.scale === 1 && !spin) return false
      setZoom({ scale: 1, x: 0, y: 0 })
      setSpin(0)
      return true
    }}
    className="util-embed--img" testId="image-studio-viewer"
    actions={<>
      {canStep && <>
        <IconButton size="sm" aria-label="Предыдущая картинка" title="Предыдущая (←)" onClick={() => { onCompareChange(false); onStep(-1) }}>‹</IconButton>
        <IconButton size="sm" aria-label="Следующая картинка" title="Следующая (→)" onClick={() => { onCompareChange(false); onStep(1) }}>›</IconButton>
      </>}
      {!compare && !cropping && !annotating && <>
        <IconButton size="sm" aria-label="Уменьшить масштаб" title="Уменьшить (колесо мыши тоже)" disabled={zoom.scale <= 1} onClick={() => zoomBy(-0.25)}>−</IconButton>
        <IconButton size="sm" aria-label={`Масштаб ${Math.round(zoom.scale * 100)} процентов, сбросить к 100`} title="Сбросить масштаб" disabled={zoom.scale === 1} onClick={() => setZoom({ scale: 1, x: 0, y: 0 })}>{`${Math.round(zoom.scale * 100)}%`}</IconButton>
        <IconButton size="sm" aria-label="Увеличить масштаб" title="Увеличить (колесо мыши тоже)" disabled={zoom.scale >= 4} onClick={() => zoomBy(0.25)}>+</IconButton>
        {/* 1:1 — пиксель картинки в пиксель экрана: разглядеть шум и артефакты
            иначе нельзя, вписанная в окно картинка их сглаживает. */}
        <IconButton size="sm" aria-label="Натуральный размер, один к одному" title="1:1 — натуральный размер" onClick={() => {
          const img = imgRef.current
          if (!img || !img.naturalWidth || !img.clientWidth) return
          const natural = Math.min(4, Math.max(1, Math.round(img.naturalWidth / img.clientWidth * 100) / 100))
          setZoom(natural <= 1 ? { scale: 1, x: 0, y: 0 } : { scale: natural, x: 0, y: 0 })
        }}>1:1</IconButton>
      </>}
      {/* Режимные кнопки остаются в шапке, пока режим включён: выход из
          разметки или обрезки не должен требовать захода в меню. */}
      {annotating && <IconButton size="sm" aria-label="Выйти из режима разметки" title="Отменить разметку" aria-pressed onClick={() => { setAnnotating(false); setStrokes([]) }}>✏️</IconButton>}
      {cropping && <>
        <IconButton size="sm" aria-label="Выйти из режима обрезки" title="Отменить обрезку" aria-pressed onClick={() => { setCropping(false); setCropBox(null) }}>✂</IconButton>
        <IconButton size="sm" aria-label={`Направляющие: ${GUIDE_LABELS[guides]} — сменить`} title={`Направляющие: ${GUIDE_LABELS[guides]}`} onClick={() => setGuides((prev) => GUIDE_MODES[(GUIDE_MODES.indexOf(prev) + 1) % GUIDE_MODES.length]!)}>#</IconButton>
      </>}
      {canStep && slideshow && <>
        <IconButton size="sm" aria-label="Остановить слайдшоу" title="Стоп" aria-pressed onClick={() => setSlideshow(false)}>⏸</IconButton>
        <select
          aria-label="Секунд на кадр"
          title="Сколько держать кадр"
          value={slideshowMs}
          onChange={(event) => setSlideshowMs(Number(event.target.value))}
        >
          {SLIDESHOW_STEPS.map((step) => <option key={step} value={step}>{step / 1000} с</option>)}
        </select>
      </>}
      {onToggleStar && <IconButton size="sm" aria-label={starred ? `Убрать ${viewing} из избранного` : `В избранное ${viewing}`} title={starred ? 'Убрать из избранного' : 'В избранное'} aria-pressed={starred} onClick={() => onToggleStar(viewing)}>{starred ? '★' : '☆'}</IconButton>}
      <IconButton size="sm" aria-label={fullscreen ? 'Выйти из полного экрана' : 'Показать на весь экран'} title={fullscreen ? 'Обычный размер' : 'Полный экран'} aria-pressed={fullscreen} onClick={() => {
        const node = frameRef.current
        if (document.fullscreenElement) { void document.exitFullscreen?.().catch(() => undefined); return }
        void node?.requestFullscreen?.().catch(() => undefined)
      }}>⛶</IconButton>
      {/* В шапке было двадцать пять иконок подряд: подписей нет, порядок
          случайный, нужную ищут перебором. Частое осталось снаружи, остальное
          живёт в меню — том же по устройству, что у карточки галереи. */}
      <span className="image-studio-viewer-more">
        <IconButton size="sm" ref={moreButtonRef} aria-label="Ещё действия с картинкой" title="Ещё действия" aria-expanded={more} aria-haspopup="menu" onClick={() => setMore((open) => !open)}>⋯</IconButton>
        {more && <div
          className="image-studio-menu image-studio-viewer-menu"
          role="menu"
          aria-label={`Ещё действия: ${viewing}`}
          ref={(node) => {
            moreMenuRef.current = node
            node?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
          }}
          onKeyDown={(event) => {
            // Esc обрабатывается нативным перехватчиком выше — здесь только навигация.
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
            event.stopPropagation()
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
            if (!items.length) return
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const focus = (next: number): void => {
              event.preventDefault()
              items[(next + items.length) % items.length]?.focus()
            }
            if (event.key === 'ArrowDown') focus(index + 1)
            else if (event.key === 'ArrowUp') focus(index - 1)
            else if (event.key === 'Home') focus(0)
            else if (event.key === 'End') focus(items.length - 1)
            else focus(index + (event.shiftKey ? -1 : 1))
          }}
        >
          {(sourceInGallery || compareWith || (compareGrid?.length ?? 0) > 2) && <button type="button" role="menuitem" onClick={() => { setMore(false); onCompareChange(!compare) }}>{compare ? 'Скрыть исходник' : 'Сравнить с исходником'}</button>}
          <button type="button" role="menuitem" onClick={() => { setMore(false); stopSlideshow(); setAnnotating((prev) => !prev); setStrokes([]); setCropping(false); setCropBox(null); onCompareChange(false) }}>{annotating ? 'Отменить разметку' : 'Разметить (рисование поверх)'}</button>
          <button type="button" role="menuitem" onClick={() => { setMore(false); stopSlideshow(); setCropping((prev) => !prev); setCropBox(null); setAnnotating(false); setStrokes([]); onCompareChange(false) }}>{cropping ? 'Отменить обрезку' : 'Обрезать (выделите область)'}</button>
          <button type="button" role="menuitem" onClick={() => { setMore(false); onPickForEdit(viewing) }}>Править по промпту</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => { setMore(false); onVariate(viewing) }}>Вариация</button>
          {'EyeDropper' in globalThis && <button type="button" role="menuitem" onClick={() => {
            setMore(false)
            const Ctor = (globalThis as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
            if (!Ctor) return
            void new Ctor().open().then(({ sRGBHex }) => navigator.clipboard?.writeText(sRGBHex)).catch(() => undefined)
          }}>Пипетка (цвет в буфер)</button>}
          {!compare && !cropping && !annotating && <button type="button" role="menuitem" onClick={() => { setMore(false); setSpin((prev) => (prev + 90) % 360) }}>{spin ? `Повернуть ещё (сейчас ${spin}°)` : 'Повернуть просмотр (файл не меняется)'}</button>}
          <button type="button" role="menuitem" onClick={() => {
            setMore(false)
            setBackground((prev) => {
              const next = VIEWER_BACKGROUNDS[(VIEWER_BACKGROUNDS.indexOf(prev) + 1) % VIEWER_BACKGROUNDS.length]!
              try { localStorage.setItem(IMAGE_STUDIO_VIEWER_BG_KEY, next) } catch { /* приватный режим */ }
              return next
            })
          }}>{`Фон: ${BACKGROUND_LABELS[background]} — сменить`}</button>
          {canStep && !slideshow && <button type="button" role="menuitem" onClick={() => { setMore(false); setSlideshow(true) }}>{`Слайдшоу (${slideshowMs / 1000} с на кадр)`}</button>}
          {onCycleStatus && <button type="button" role="menuitem" onClick={() => { setMore(false); onCycleStatus(viewing) }}>
            {status === 'ready' ? 'Готово — снять пометку' : status === 'draft' ? 'Черновик — отметить готовым' : 'Отметить черновиком'}
          </button>}
          <button type="button" role="menuitem" onClick={() => { setMore(false); setLoupe((prev) => !prev); setProbe(null) }}>{loupe ? 'Убрать лупу' : 'Лупа (и цвет под курсором)'}</button>
          <button type="button" role="menuitem" onClick={() => { setMore(false); setInverted((prev) => !prev) }}>{inverted ? 'Обычные цвета' : 'Инверсия просмотра (файл не меняется)'}</button>
          {canStep && <button type="button" role="menuitem" onClick={() => { setMore(false); setStrip((prev) => !prev) }}>{strip ? 'Скрыть ленту кадров' : 'Лента кадров'}</button>}
          <button type="button" role="menuitem" onClick={() => { setMore(false); setPropsOpen((prev) => !prev) }}>{propsOpen ? 'Скрыть свойства' : 'Свойства и заметка'}</button>
          <button type="button" role="menuitem" onClick={() => { setMore(false); onCopy(viewing) }}>Копировать в буфер</button>
          <button type="button" role="menuitem" onClick={() => { setMore(false); onDownload(viewing) }}>Скачать</button>
          <button type="button" role="menuitem" onClick={() => { setMore(false); onDelete(viewing) }}>Удалить</button>
        </div>}
      </span>
    </>}>
    <div ref={frameRef} className={`imgbody image-studio-bg--${background}${fullscreen ? ' imgbody--fullscreen' : ''}`} tabIndex={-1}
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
              if (panStart.current) {
                const start = panStart.current
                setZoom((prev) => ({ ...prev, x: start.ox + (event.clientX - start.x), y: start.oy + (event.clientY - start.y) }))
                return
              }
              if (!loupe) return
              const img = imgRef.current
              if (!img || !img.naturalWidth) return
              const box = img.getBoundingClientRect()
              const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
              if (!inside) { setProbe(null); return }
              // Координаты и цвет — в пикселях исходника: «где именно артефакт»
              // на глаз в CSS-пикселях не назовёшь.
              const px = Math.floor((event.clientX - box.left) / box.width * img.naturalWidth)
              const py = Math.floor((event.clientY - box.top) / box.height * img.naturalHeight)
              let color: string | null = null
              try {
                const canvas = probeCanvas.current ?? (probeCanvas.current = document.createElement('canvas'))
                canvas.width = 1
                canvas.height = 1
                const ctx = canvas.getContext('2d')
                if (ctx) {
                  ctx.drawImage(img, px, py, 1, 1, 0, 0, 1, 1)
                  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
                  color = `#${[r, g, b].map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`
                }
              } catch { /* картинка из другого источника — цвет не прочитать */ }
              setProbe({ x: event.clientX - box.left, y: event.clientY - box.top, px, py, color })
            }}
            onPointerUp={() => { panStart.current = null }}
            onPointerLeave={() => setProbe(null)}
            role="presentation"
            title={zoom.scale > 1 ? 'Двойной клик — сбросить масштаб' : 'Колесо мыши — масштаб'}>
            <img ref={imgRef} className="image-studio-full" src={previews[viewing]} alt={viewing} draggable={false}
              style={zoom.scale > 1 || spin
                ? {
                    transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale}) rotate(${spin}deg)`,
                    ...(zoom.scale > 1 ? { cursor: 'grab' } : {}),
                    // На боку картинка вписывается в высоту, а не в ширину:
                    // иначе повёрнутый кадр вылезает за пределы окна.
                    ...(spin % 180 ? { maxWidth: 'none', maxHeight: 'min(78vw, 100%)' } : {})
                  }
                : undefined}
              data-zoom={zoom.scale > 1 ? zoom.scale.toFixed(2) : undefined} data-spin={spin || undefined} data-inverted={inverted || undefined} />
            {loupe && probe && <span
              className="image-studio-loupe"
              aria-hidden="true"
              style={{
                left: probe.x,
                top: probe.y,
                backgroundImage: `url(${previews[viewing]})`,
                // Фон сдвигаем так, чтобы точка под курсором оказалась в центре
                // круга: увеличение трёхкратное от натурального размера.
                backgroundSize: `${(imgRef.current?.naturalWidth ?? 0) * 3}px ${(imgRef.current?.naturalHeight ?? 0) * 3}px`,
                backgroundPosition: `${-probe.px * 3 + 60}px ${-probe.py * 3 + 60}px`
              }}
            />}
            {loupe && probe && <span className="image-studio-probe" role="status">
              {probe.px}×{probe.py}
              {probe.color && <>
                {' '}
                <span className="image-studio-swatch-inline" style={{ background: probe.color }} aria-hidden="true" />
                <button type="button" className="image-studio-cancel" onClick={() => void navigator.clipboard?.writeText(probe.color!).catch(() => undefined)}>{probe.color}</button>
              </>}
            </span>}
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
          {guides !== 'none' && <span className={`image-studio-thirds image-studio-thirds--${guides}`} aria-hidden="true" />}
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
        {sets && sets.length > 0 && <span className="image-studio-dim">В наборах: {sets.join(', ')}</span>}
        {versions && versions.length > 1 && <span className="image-studio-versions" role="group" aria-label="Дерево версий">
          {versions.map((node) => <span key={node.path} className="image-studio-dim" style={{ paddingLeft: node.depth * 12 }}>
            {node.depth > 0 ? '└ ' : ''}{node.path === viewing
              ? <strong>{node.path}</strong>
              : <button type="button" className="image-studio-cancel" onClick={() => { onCompareChange(false); onView(node.path) }}>{node.path}</button>}
          </span>)}
        </span>}
        {onFacts && (facts === null
          ? <button type="button" className="image-studio-cancel" onClick={() => void onFacts(viewing).then(setFacts).catch(() => setFacts({ type: null, mismatch: null, alpha: false, colors: 0 }))}>Что внутри файла</button>
          : <span className="image-studio-dim">
              {facts.type ? `Тип: ${facts.type.toUpperCase()}` : 'Тип: не распознан'}
              {' · '}{facts.alpha ? 'с прозрачностью' : 'без прозрачности'}
              {facts.colors ? ` · цветов примерно ${facts.colors}` : ''}
              {facts.mismatch ? ` · ${facts.mismatch}` : ''}
            </span>)}
        {onLocate && <button type="button" className="image-studio-cancel" onClick={() => onLocate(viewing)}>Показать в сетке</button>}
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
                  {/* Каналы отдельной кнопкой: по яркости перекос цвета не
                      видно, но и считать их каждому кадру незачем. */}
                  {onChannels && (channels === null
                    ? <button type="button" className="image-studio-cancel" onClick={() => void onChannels(viewing).then(setChannels).catch(() => setChannels({ r: [], g: [], b: [] }))}>Каналы R/G/B</button>
                    : <span className="image-studio-channels">
                        {(['r', 'g', 'b'] as const).map((channel) => <span
                          key={channel}
                          className={`image-studio-histogram image-studio-histogram--${channel}`}
                          role="img"
                          aria-label={`Гистограмма канала ${channel.toUpperCase()}`}
                        >
                          {channels[channel].map((height, index) => <span key={index} style={{ height: `${Math.max(2, height)}%` }} />)}
                        </span>)}
                      </span>)}
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
      {note && !propsOpen && <p className="image-studio-origin image-studio-note-line">
        <span className="image-studio-dim">Заметка:</span> {note}
      </p>}
      {strip && files.length > 1 && (() => {
        // Окно вокруг текущего кадра: на галерее в сотню файлов сто миниатюр
        // в ленте — это сотня <img> ради двадцати видимых.
        const current = Math.max(0, files.findIndex((file) => file.path === viewing))
        const radius = phone ? STRIP_RADIUS_PHONE : STRIP_RADIUS
        const from = Math.max(0, current - radius)
        const nearby = files.slice(from, current + radius + 1)
        return <div className="image-studio-strip" role="list" aria-label="Лента кадров">
        {/* Кнопке нельзя дать role="listitem": она перестанет быть кнопкой для
            читалки. Поэтому элемент списка — обёртка, кнопка внутри. */}
        {nearby.map((file) => <span key={file.path} role="listitem">
          <button
            type="button"
            className={`image-studio-strip-item${file.path === viewing ? ' image-studio-strip-item--current' : ''}`}
            aria-label={file.path}
            aria-current={file.path === viewing ? 'true' : undefined}
            title={file.path}
            // Текущий кадр подводим к центру ленты: иначе после нескольких
            // нажатий стрелки он уезжает за край и лента бесполезна.
            ref={(node) => { if (node && file.path === viewing) node.scrollIntoView?.({ block: 'nearest', inline: 'center' }) }}
            onClick={() => { setSlideshow(false); onView(file.path) }}
          >
            <img src={previews[file.path]} alt="" loading="lazy" />
          </button>
        </span>)}
        </div>
      })()}
      <p className="image-studio-origin"><span className="image-studio-dim">← → — листать · Delete — удалить · Esc — закрыть{slideshow ? ' · слайдшоу идёт' : ''}</span></p>
      {meta && <p className="imgcap image-studio-origin">
        {/* Разделитель — только если дальше есть что писать: строка кончалась
            висячей точкой «6 КБ · 400×300 ·» у файлов без источника и промпта. */}
        <span className="image-studio-dim">{formatBytes(meta.size)}{dimensions[meta.path] ? ` · ${dimensions[meta.path]}` : ''}</span>{meta.source || meta.prompt ? ' · ' : ''}
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
