import { defineConfig } from 'vitest/config'

// E2E Make в реальном Chromium (playwright из node_modules). Запуск: `npm run e2e:make`.
// Не входит в `npm test`: нужны собранный apps/web/dist и установленный браузер.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Несколько переходов UI → REST → Chromium не обязаны уложиться в 1 с
    // на занятой машине; poll остаётся ограниченным и завершается по условию.
    expect: { poll: { timeout: 10_000 } },
    fileParallelism: false,
    environment: 'node'
  }
})
