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
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // `include` обязателен: без него v8 считает и весь граф зависимостей —
      // первый замер выдал 181 960 «строк пакета» и 17,5% покрытия, что просто
      // артефакт подсчёта, а не состояние кода.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.stories.tsx'],
      reporter: ['text-summary'],
      // Пороги — «трещотка»: чуть ниже фактического уровня на день замера
      // (85,01% строк, 82,41% ветвей, 58,6% функций). Функций мало не потому,
      // что код не проверен, а потому что v8 считает каждый обработчик и
      // колбэк отдельной функцией — в React-коде их кратно больше, чем
      // осмысленных точек входа. Смысл порога — не дать покрытию упасть.
      thresholds: { statements: 84, branches: 81, functions: 57, lines: 84 }
    }
  }
})
