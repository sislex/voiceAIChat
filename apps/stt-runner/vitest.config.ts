import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary'],
      /**
       * Пороги по файлам, а не на пакет: `server.ts`, `index.ts`,
       * `models/download.ts` и `run/whisper.ts` — это HTTP-обвязка, точка входа,
       * сетевое скачивание и spawn whisper. Их дешёвыми юнит-тестами не закрыть,
       * и порог на пакет пришлось бы держать около 30% — он ничего не защищал бы.
       *
       * Перечисленные ниже — чистая логика, и она обязана оставаться закрытой:
       * раскладка WAV-заголовка (в неё смотрит валидатор nodejs-whisper),
       * сравнение токена за постоянное время и порог обрезанной загрузки модели.
       */
      thresholds: {
        'src/auth.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/run/wav.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/models/catalog.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
        'src/config.ts': { statements: 93, branches: 85, functions: 100, lines: 93 }
      }
    }
  }
})
