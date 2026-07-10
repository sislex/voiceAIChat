import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve('../../packages/shared/src')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    // Интеграционные тесты (реальные whisper/claude/piper) грузят CPU; поднимаем
    // общий таймаут, чтобы тесты не срывались при параллельном прогоне.
    testTimeout: 20_000,
    // UI переехал в @voicechat/ui (свои тесты); в desktop остаются тесты main-процесса.
    include: ['src/main/**/*.{test,spec}.{ts,tsx}']
  }
})
