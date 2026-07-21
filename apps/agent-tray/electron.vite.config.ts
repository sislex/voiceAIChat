import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Ядро агента (@agent) и общий код (@shared) бандлятся из исходников монорепо;
// ws остаётся внешней зависимостью (externalizeDepsPlugin) — из node_modules приложения.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('../../packages/shared/src'),
        '@agent': resolve('../agent/src')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          setup: resolve('src/renderer/setup.html'),
          log: resolve('src/renderer/log.html')
        }
      }
    }
  }
})
