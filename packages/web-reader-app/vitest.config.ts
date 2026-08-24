/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
const abs = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^@shared\//, replacement: abs('../shared/src/') }] },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/vitest.setup.ts'], include: ['src/**/*.test.{ts,tsx}'] }
})
