import { vi } from 'vitest'
// jsdom не исполняет загружаемые script с SRI. Интеграция shell использует
// настоящие компоненты пакетов; HTTP/SRI/смену артефакта проверяет Chromium E2E.
vi.mock('../runtime/applicationHost', async importOriginal => {
  const original = await importOriginal<typeof import('../runtime/applicationHost')>()
  const { lazy } = await import('react')
  return { ...original, createApplicationPanel: (id: string, component = 'default') => {
    switch (id) {
      case 'make-ui': if (component === 'shared') return lazy(async () => ({ default: (await import('@sislexa/make/ui/components/MakeSharedView')).MakeSharedView })); return lazy(async () => ({ default: (await import('@sislexa/make/ui/components/MakePane')).MakePane }))
      case 'image-studio-ui': return lazy(async () => ({ default: (await import('@sislexa/image-studio/ui/components/ImageStudioPane')).ImageStudioPane }))
      case 'playwright-reader-ui': return lazy(async () => ({ default: (await import('@sislexa/playwright-reader/ui/components/BrowserSessionPane')).BrowserSessionPane }))
      case 'web-reader-ui': return lazy(async () => ({ default: (await import('@sislexa/web-reader/ui/index')).WebReaderFrame }))
      default: throw new Error(`Неизвестная панель ${id}`)
    }
  } }
})
