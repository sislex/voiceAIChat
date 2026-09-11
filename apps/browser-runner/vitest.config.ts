import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Each file owns real Chromium processes. Bounding file concurrency avoids
    // starving navigation and download observations during an all-app gate.
    maxWorkers: 4,
    minWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 15_000
  }
})
