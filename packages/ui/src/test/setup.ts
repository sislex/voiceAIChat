import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

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
