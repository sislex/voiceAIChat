import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// `findBy*`/`waitFor` по умолчанию ждут 1 секунду, а половина экранов приложения
// грузится лениво (`Suspense` + dynamic import). На полном прогоне пакета — а
// тем более в release-gate, где параллельно идут другие наборы, — чанк успевает
// не всегда: тест видел fallback «Загрузка настроек проекта…» и падал на
// `findByTestId('project-settings')`, хотя изолированно проходил за 900 мс.
// Это ожидание загрузки, а не ожидание починки: пять секунд не маскируют
// сломанный экран (он не появится и за минуту), но убирают класс флейков,
// зависящих от загрузки машины. `testTimeout` теста остаётся 20 с.
configure({ asyncUtilTimeout: 5000 })

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

// jsdom не реализует ResizeObserver (его ждёт xterm в терминале машины) и
// Element.scrollTo (консоль рана прокручивает себя к последней строке). Оба
// нужны только прогону сториз: экраны в dom-тестах до них не доходят, а без
// заглушек сториз падает на рендере, и проверить её доступность нельзя.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo(): void {}
}

// xterm initializes its color table at import time and asks jsdom's canvas for a
// 2D context. The real canvas package is unnecessary for UI tests.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
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
