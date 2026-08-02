import { useEffect, useRef } from 'react'
import { comboKeyMatches, comboMatches, hasModifier, parseCombo, type ParsedCombo } from './hotkeys'

/** Один биндинг карты горячих клавиш. */
export interface HotkeyBinding {
  /** Комбинация в записи `hotkeys.ts`: 'Space', 'Escape', 'mod+k', '?'. */
  combo: string
  /** Нажатие. */
  onDown?: (event: KeyboardEvent) => void
  /** Отпускание — только у клавиш-удержаний (push-to-talk). */
  onUp?: (event: KeyboardEvent) => void
  /**
   * Перехватывать, когда фокус в текстовом поле. По умолчанию — только
   * комбинации с модификатором: иначе в поле не набрать ни пробел, ни «?».
   */
  inInput?: boolean
  /**
   * Не смотреть на модификаторы. Нужно пробелу и Esc: до появления карты
   * биндингов они срабатывали при любом зажатом Ctrl/Alt, и push-to-talk не
   * должен зависеть от случайно нажатого модификатора.
   */
  ignoreModifiers?: boolean
  /** Биндинг сейчас активен. Проверяется в момент нажатия. */
  enabled?: () => boolean
}

export interface HotkeyHandlers {
  /** Нажат пробел (push-to-talk): начать запись. */
  onPushStart: () => void
  /** Отпущен пробел: завершить запись. */
  onPushEnd: () => void
  /** Нажат Escape: стоп/отмена по текущему состоянию. */
  onEscape: () => void
  /**
   * Остальные биндинги приложения (палитра, шпаргалка). У каждого свой `enabled`:
   * общий флаг ниже гасит только голосовые клавиши.
   */
  bindings?: HotkeyBinding[]
  /**
   * Голосовые клавиши (пробел/Esc) активны — например, выключены при открытом
   * модале настроек. На `bindings` не влияет.
   */
  enabled?: boolean
}

/** Фокус в текстовом поле — тогда клавиши без модификатора не перехватываем. */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/**
 * Глобальные горячие клавиши: карта биндингов, где пробел (удержание) —
 * push-to-talk запись, Esc — стоп/отмена, а остальное приходит от приложения
 * (`bindings`). Слушатели навешиваются один раз; актуальные колбэки берутся из
 * ref (без переподписки на каждый рендер).
 *
 * Первый подошедший биндинг забирает событие: карта читается сверху вниз,
 * голосовые клавиши в ней первые.
 */
export function useHotkeys(handlers: HotkeyHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers
  // Комбинации, зажатые прямо сейчас — чтобы автоповтор keydown не рестартовал
  // действие и чтобы keyup завершал именно начатое этой клавишей.
  const held = useRef(new Set<string>())

  useEffect(() => {
    // Карта собирается на каждое событие: колбэки берутся из свежего ref, а
    // список биндингов приложения между рендерами меняется.
    const table = (): HotkeyBinding[] => {
      const h = ref.current
      const voiceEnabled = (): boolean => h.enabled !== false
      return [
        { combo: 'Escape', ignoreModifiers: true, enabled: voiceEnabled, onDown: () => h.onEscape() },
        {
          combo: 'Space',
          ignoreModifiers: true,
          enabled: voiceEnabled,
          onDown: () => h.onPushStart(),
          onUp: () => h.onPushEnd()
        },
        ...(h.bindings ?? [])
      ]
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = isTyping()
      for (const binding of table()) {
        const combo: ParsedCombo = parseCombo(binding.combo)
        const hit = binding.ignoreModifiers ? comboKeyMatches(event, combo) : comboMatches(event, combo)
        if (!hit) continue
        if (binding.enabled && !binding.enabled()) continue
        if (typing && !(binding.inInput ?? hasModifier(combo))) continue
        if (binding.onUp) {
          if (event.repeat || held.current.has(binding.combo)) return
          held.current.add(binding.combo)
        }
        event.preventDefault()
        binding.onDown?.(event)
        return
      }
    }

    // Отпускание: модификаторы к этому моменту могли быть уже отпущены, поэтому
    // сверяем только клавишу. Условие срабатывания — что нажатие мы приняли.
    const onKeyUp = (event: KeyboardEvent): void => {
      for (const binding of table()) {
        if (!binding.onUp) continue
        if (!comboKeyMatches(event, parseCombo(binding.combo))) continue
        if (!held.current.delete(binding.combo)) return
        event.preventDefault()
        binding.onUp(event)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])
}
