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
      { find: '@voicechat/ui/styles.css', replacement: abs('../../packages/ui/src/styles/global.css') },
      { find: '@voicechat/ui', replacement: abs('../../packages/ui/src/index.ts') },
      { find: /^@shared\//, replacement: abs('../../packages/shared/src/') },
      { find: '@voicechat/shared', replacement: abs('../../packages/shared/src/index.ts') }
    ]
  },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 20000,
    include: ['src/**/*.test.{ts,tsx}']
  }
})
