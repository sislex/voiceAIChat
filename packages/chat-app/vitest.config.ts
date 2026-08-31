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
       * Порог задан по каталогам, а не на пакет целиком, и это осознанно.
       *
       * `store/chatStore.ts` — 1994 строки, и в покрытии этого пакета у него 0%:
       * его гоняют dom-тесты `packages/ui` через свой домен-обёртку, а счётчик
       * покрытия чужие пакеты не видит. Порог на пакет целиком поэтому пришлось
       * бы поставить около 11% — он ничего бы не защищал.
       *
       * Чистая логика (`lib/`, `routes/`) закрыта на 100% и такой и обязана
       * остаться: это разбор состояний экрана, маршруты и телеметрия БЗ с
       * правилами против двойного счёта.
       */
      thresholds: {
        'src/lib/**': { statements: 100, functions: 100, lines: 100, branches: 96 },
        'src/routes/**': { statements: 100, functions: 100, lines: 100, branches: 100 }
      }
    }
  }
})
