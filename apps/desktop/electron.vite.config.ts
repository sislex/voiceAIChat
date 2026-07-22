import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('../../packages/shared/src')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@voicechat/ui/styles.css': resolve('../../packages/ui/src/styles/global.css'),
        '@voicechat/ui': resolve('../../packages/ui/src/index.ts'),
        '@shared': resolve('../../packages/shared/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'agent-setup': resolve('src/renderer/agent-setup.html'),
          'agent-log': resolve('src/renderer/agent-log.html'),
          'remote-setup': resolve('src/renderer/remote-setup.html')
        }
      }
    }
  }
})
