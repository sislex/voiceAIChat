// Общий стек открытых окон. Он один на приложение, потому что вопросы «кто
// сверху» решаются между окнами, а не внутри одного: из карточки задачи
// открывается AI-помощник, из него — подтверждение, и Esc должен закрыть только
// верхнее, а скролл фона вернуться, когда закрылось последнее.
//
// Слой живёт столько, сколько открыто окно: z-index выдаётся по глубине, Esc
// достаётся верхнему слою, блокировка скролла считается по числу слоёв.

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'

/** Базовый слой окон: выше .ci-console (1000) и мобильного сайдбара — см. шкалу в app.css. */
export const DIALOG_Z_BASE = 1200
/** Шаг между вложенными окнами: с запасом на свои absolute-элементы внутри окна. */
export const DIALOG_Z_STEP = 10

interface Layer {
  /** Актуальный обработчик Esc в ref — слой не перерегистрируется на каждый рендер. */
  escape: MutableRefObject<(() => void) | undefined>
  /** Пересчитать глубину/верхность после изменения стека. */
  sync: () => void
}

const layers: Layer[] = []

/** Пересчёт после любого изменения стека: глубина сдвигается у всех, кто выше. */
function notify(): void {
  for (const layer of layers) layer.sync()
}

// ---- Esc: один слушатель на весь стек ----------------------------------------
// Слушатель по слою на окно не годится: каждый глушил бы событие своим
// stopPropagation, и порядок «кому достанется» зависел бы от порядка подписки.
// Фаза перехвата и stopPropagation — чтобы не срабатывали глобальные хоткеи
// (отмена записи в useHotkeys слушает всплытие на window).
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' && event.code !== 'Escape') return
  // Первый Esc в непустом поле поиска очищает поле, а не закрывает окно: иначе
  // человек, отфильтровавший список внутри модального окна, теряет всё окно
  // вместо запроса. Второй Esc (поле уже пустое) закрывает как обычно.
  const target = event.target as HTMLInputElement | null
  if (target && target.tagName === 'INPUT' && target.type === 'search' && target.value !== '') return
  const handler = layers[layers.length - 1]?.escape.current
  // Верхнее окно не закрывается по Esc — пропускаем событие дальше (так живут
  // встроенные карточки тулов: у них Esc — обычный хоткей приложения).
  if (!handler) return
  event.preventDefault()
  event.stopPropagation()
  handler()
}

function listenEscape(on: boolean): void {
  if (on) window.addEventListener('keydown', onKeyDown, true)
  else window.removeEventListener('keydown', onKeyDown, true)
}

// ---- Скролл фона -------------------------------------------------------------
let scrollLocks = 0
let savedScroll: { overflow: string; paddingRight: string } | null = null

function lockScroll(): void {
  scrollLocks += 1
  if (scrollLocks > 1) return
  const body = document.body
  savedScroll = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
  // Полоса прокрутки исчезает вместе с overflow: hidden, поэтому её ширину
  // возвращаем отступом — иначе контент под окном прыгает вбок. Без разметки
  // (jsdom, clientWidth === 0) компенсировать нечего.
  const viewport = document.documentElement.clientWidth
  const gap = viewport > 0 ? window.innerWidth - viewport : 0
  body.style.overflow = 'hidden'
  if (gap > 0) body.style.paddingRight = `${gap}px`
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks > 0 || !savedScroll) return
  document.body.style.overflow = savedScroll.overflow
  document.body.style.paddingRight = savedScroll.paddingRight
  savedScroll = null
}

export interface DialogStackOptions {
  /** Окно на экране. false — слой не занимает место в стеке (свёрнутая карточка тула). */
  active?: boolean
  /** Что делать по Esc, когда слой верхний. Не задан — Esc уходит дальше. */
  onEscape?: () => void
  /** Блокировать скролл фона: у слоёв без оверлея (страница тула) — не надо. */
  lockScroll?: boolean
}

export interface DialogStackLayer {
  /** z-index этого окна: по глубине в стеке. */
  zIndex: number
  /** Слой верхний — ему принадлежат Esc и ловушка фокуса. */
  top: boolean
}

/**
 * Регистрирует окно в общем стеке на время своей жизни и отдаёт его глубину.
 * Вызывается один раз на окно: и Dialog, и PopupFrame держат ровно один слой.
 */
export function useDialogStack({ active = true, onEscape, lockScroll: lock = true }: DialogStackOptions = {}): DialogStackLayer {
  const escape = useRef(onEscape)
  escape.current = onEscape

  const [layer, setLayer] = useState<DialogStackLayer>({ zIndex: DIALOG_Z_BASE, top: true })

  // useLayoutEffect, а не useEffect: глубина нужна до отрисовки, иначе вложенное
  // окно первый кадр показывается под родительским.
  useLayoutEffect(() => {
    if (!active) return
    const entry: Layer = {
      escape,
      sync: () => {
        const index = layers.indexOf(entry)
        if (index < 0) return
        const zIndex = DIALOG_Z_BASE + index * DIALOG_Z_STEP
        const top = index === layers.length - 1
        setLayer((prev) => (prev.zIndex === zIndex && prev.top === top ? prev : { zIndex, top }))
      }
    }
    layers.push(entry)
    if (layers.length === 1) listenEscape(true)
    if (lock) lockScroll()
    notify()
    return () => {
      const index = layers.indexOf(entry)
      if (index >= 0) layers.splice(index, 1)
      if (layers.length === 0) listenEscape(false)
      if (lock) unlockScroll()
      notify()
    }
  }, [active, lock])

  // Слой снят (например, карточка тула свернулась) — вернуть значения по умолчанию,
  // чтобы не остался z-index чужой глубины.
  useEffect(() => {
    if (!active) setLayer((prev) => (prev.zIndex === DIALOG_Z_BASE && prev.top ? prev : { zIndex: DIALOG_Z_BASE, top: true }))
  }, [active])

  return layer
}

/** Число открытых окон — для тестов и отладки. */
export function dialogStackDepth(): number {
  return layers.length
}
