import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Тридцать секунд с запасом хватает самому долгому интеграционному тесту.
    // Было 600_000 — десять минут маскировали зависший listen/ws вместо быстрого
    // падения, а обоснование «параллельный merge-гейт сажает пакет на один
    // воркер» отменилось: affected-check делит пул по числу CPU.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__fixtures__/**'],
      reporter: ['text-summary'],
      // Пороги — «трещотка»: чуть ниже фактического уровня на день замера
      // (85,39% строк, 74,84% ветвей, 84,8% функций). Ветвей заметно меньше
      // строк — это необработанные ветки ошибок в маршрутах и оркестраторах.
      thresholds: { statements: 84, branches: 73, functions: 83, lines: 84 }
    }
  }
})
