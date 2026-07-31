import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom не реализует matchMedia. Дефолт — «десктоп»: ни одно условие не совпадает.
// Мобильные кейсы подставляют свой matchMedia в самом тесте (см. TaskModal.dom.test).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

// jsdom не реализует PointerEvent: без него fireEvent.pointerDown создаёт голый
// Event, и координаты (clientX/clientY) до обработчиков не доезжают — тесты
// pointer-переноса канбана проверяли бы не то. Подменяем минимальной версией
// поверх MouseEvent: она умеет всё, что читает lib/dnd.ts.
if (typeof window !== 'undefined' && typeof (window as { PointerEvent?: unknown }).PointerEvent !== 'function') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pointerType = init.pointerType ?? 'mouse'
      this.isPrimary = init.isPrimary ?? true
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent
}

// Захвата указателя в jsdom тоже нет — движок переноса его пробует и переживает
// отсутствие, но пусть тесты идут по «нормальной» ветке с капчуром.
if (typeof Element !== 'undefined' && typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
}

afterEach(() => {
  // cleanup нужен только в DOM-окружении.
  if (typeof document !== 'undefined') cleanup()
  // Адрес общий на весь файл тестов: App пишет туда чат (#/chat/:id) и раздел,
  // и без сброса следующий тест стартует на чужом маршруте.
  try {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  } catch {
    // тест подменил window.location своим объектом — чистить нечего
  }
})
