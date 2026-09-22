import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

// An explicit command keeps real credentials and provider availability out of the local gate.
export default mergeConfig(base, defineConfig({
  test: { include: ['e2e/settings.real-voice.test.ts'], exclude: ['e2e/**/*.e2e.test.ts'] }
}))
