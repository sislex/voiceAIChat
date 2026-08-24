/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

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
    port: 5273,
    proxy: {
      '/web-recorder/': { target: 'http://127.0.0.1:5274', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      // Компаньон-агент подключается по /agent — в dev проксируем на бэкенд,
      // иначе строка подключения указывает на порт Vite, где такого маршрута нет.
      '/agent': { target: 'ws://127.0.0.1:8787', ws: true }
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
