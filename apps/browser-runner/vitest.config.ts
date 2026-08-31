import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // `describeElement.test.ts` поднимает настоящий Chromium в `beforeAll`, и на
    // загруженной машине запуск браузера не укладывается в дефолтные 10 с — в
    // полном гейте это давало красный прогон при 83 из 83 зелёных тестах.
    // Остальные таймауты остаются дефолтными: их поднимать не за что.
    hookTimeout: 60_000
  }
})
