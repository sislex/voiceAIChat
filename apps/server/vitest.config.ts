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
    testTimeout: 30_000
  }
})
