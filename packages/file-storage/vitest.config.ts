import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { exclude: ['**/node_modules/**', '**/.stand/**'], environment: 'node', include: ['src/**/*.test.ts'] } })
