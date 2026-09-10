/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// React UI tests use jsdom and Testing Library; shared contracts and logic live in @shared.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@shared\//, replacement: abs('../shared/src/') }]
  },
  test: {
    // Default to Node for pure logic tests. In the original 154-file UI package, environment
    // creation and setup consumed about a third of the roughly 364-second run. File naming already
    // distinguishes *.dom.test.tsx from *.test.ts, so only DOM tests need jsdom. Files requiring
    // jsdom despite their names can use // @vitest-environment jsdom.
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.dom.test.{ts,tsx}', 'jsdom']],
    globals: true,
    setupFiles: ['@voicechat/ui-foundation/test/setup'],
    // Use a 60-second timeout, matching server. Parallel workspace runs can starve DOM tests of
    // CPU: tests taking 0.4 seconds locally exceeded the old 20-second limit in releases 0.1.226
    // and 0.1.227. Sixty seconds still catches actual hangs.
    testTimeout: 60_000,
    include: ['src/**/*.test.{ts,tsx}'],

  }
})
