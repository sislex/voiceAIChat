import { defineConfig } from 'vitest/config'

// Тесты пакета поднимают настоящий Chromium (describeElement.test.ts), а на
// это дефолтных 10 с хука хватает только на свободной машине: под полным
// гейтом, где воркспейсы идут подряд, запуск и закрытие браузера стабильно
// не укладывались, хотя сам пакет проходит за три секунды.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000
  }
})
