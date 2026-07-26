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
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/@xterm')) return 'terminal'
            if (
              id.includes('node_modules/react-markdown') ||
              id.includes('node_modules/remark-') ||
              id.includes('node_modules/rehype-') ||
              id.includes('node_modules/highlight.js')
            )
              return 'markdown'
            if (id.includes('node_modules/qrcode')) return 'qrcode'
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom')) return 'react'
          }
        }
      }
    }
  }
})
