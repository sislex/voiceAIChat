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
