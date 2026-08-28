/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Порты dev-режима вынесены в окружение, чтобы рядом с чужим уже запущенным
// dev-сеансом можно было поднять второй (проверка фичи, отладка) без правки
// конфига и без EADDRINUSE. Значения по умолчанию — прежние, поэтому обычный
// `npm run dev:web` ведёт себя как раньше.
const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback
}
const WEB_PORT = num(process.env.VC_WEB_PORT, 5273)
const API_PORT = num(process.env.VC_API_PORT, 8787)
const RECORDER_PORT = num(process.env.VC_RECORDER_PORT, 5274)

// Веб-клиент: тонкая оболочка вокруг общего UI (@voicechat/ui) + мосты REST+WS.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@voicechat/ui/styles.css',
        replacement: abs('../../packages/ui/src/styles/global.css')
      },
      {
        find: '@voicechat/ui',
        replacement: abs('../../packages/ui/src/index.ts')
      },
      { find: /^@shared\//, replacement: abs('../../packages/shared/src/') },
      {
        find: '@voicechat/shared',
        replacement: abs('../../packages/shared/src/index.ts')
      }
    ]
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xterm')) return 'terminal'
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) return 'monaco'
          if (id.includes('node_modules/html2canvas')) return 'screenshot'
          if (id.includes('node_modules/prettier')) return 'prettier'
          if (
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark-') ||
            id.includes('node_modules/rehype-') ||
            id.includes('node_modules/highlight.js')
          )
            return 'markdown'
          if (id.includes('node_modules/qrcode')) return 'qrcode'
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom')) return 'react'
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    proxy: {
      // ws: true — HMR-сокет Reader тоже идёт через same-origin путь /web-recorder/.
      '/web-recorder/': { target: `http://127.0.0.1:${RECORDER_PORT}`, changeOrigin: true, ws: true },
      // Host не переписываем: previewProxy сверяет host диагностической страницы
      // с Host запроса — с changeOrigin=true самодиагностика в dev получала SSRF-отказ.
      '/api': { target: `http://127.0.0.1:${API_PORT}` },
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
      // Компаньон-агент подключается по /agent — в dev проксируем на бэкенд,
      // иначе строка подключения указывает на порт Vite, где такого маршрута нет.
      '/agent': { target: `ws://127.0.0.1:${API_PORT}`, ws: true }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 20000,
    include: ['src/**/*.test.{ts,tsx}'],
    // Юнит-тесты мостов переехали в @voicechat/ui (src/remote); тонкий слой web
    // (main.tsx + config) без собственных тестов — не считаем это ошибкой.
    passWithNoTests: true
  }
})
