/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Пакет общего UI (React). Тесты — jsdom + Testing Library. Контракт/логика — @shared.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@shared\//, replacement: abs('../shared/src/') }]
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20000,
    include: ['src/**/*.test.{ts,tsx}']
  }
})
