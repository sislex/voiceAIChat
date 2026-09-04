/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Тот же лимит, что у @voicechat/ui: dom-тесты на загруженной релизной машине
    // не укладывались в 20 с (см. комментарий в packages/ui/vitest.config.ts).
    testTimeout: 60_000,
    include: ['src/**/*.test.{ts,tsx}']
  }
})
