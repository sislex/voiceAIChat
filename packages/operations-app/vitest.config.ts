/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
const abs = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^@shared\//, replacement: abs('../shared/src/') }] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.stories.tsx'],
      reporter: ['text-summary'],
      /**
       * Пороги — на двух файлах, где цена ошибки не «неудобно», а «утечка».
       * `path.ts` — граница доступа к файлам чужой машины (обход `..` и
       * префикс-совпадение соседнего каталога), `redaction.ts` — вычистка
       * токенов из диагностики. Оба закрыты на 100% и обязаны такими остаться.
       * Остальное (`surfaces.tsx`, `navigation.ts`, контракты) — обвязка и
       * разметка, порогом не охвачена.
       */
      thresholds: {
        'src/path.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/redaction.ts': { statements: 100, branches: 100, functions: 100, lines: 100 }
      }
    }
  }
})
