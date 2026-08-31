import { defineConfig } from 'vitest/config'

// Пакет чистой логики: без окружения браузера и без зависимостей. Конфиг
// появился ради порогов покрытия — на скорость он не влияет (проверено:
// дефолтный include vitest и так исключает node_modules и находит те же
// 780 тестов, чередующийся A/B дал 6,2/6,9 с против 6,7/5,7 с).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary'],
      // Пороги — «трещотка»: чуть ниже фактического уровня на день замера
      // (86,29% строк, 84,08% ветвей, 67,23% функций). Смысл в том, чтобы
      // покрытие нельзя было уронить, а не в том, чтобы достичь цифры.
      // Опустить порог можно только вместе с объяснением почему.
      thresholds: { statements: 85, branches: 83, functions: 66, lines: 85 }
    }
  }
})
