// Core owns the chat renderer; Electron clients consume its immutable release.
import { build } from 'vite'
import { build as esbuild } from 'esbuild'
import { rollup } from 'rollup'
import { dts } from 'rollup-plugin-dts'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'artifacts/chat-client')
const versionIndex = process.argv.indexOf('--version')
const version = versionIndex < 0 ? '1.0.2' : process.argv[versionIndex + 1]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw Error('Expected a semantic version')
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim())
if (process.argv.includes('--pack') && dirty) throw Error('Release requires clean committed source')
mkdirSync(output, { recursive: true })
await build({
  configFile: false,
  root: join(root, 'packages/ui/desktop-client'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': join(root, 'packages/shared/src') } },
  build: {
    // Match the previous Electron renderer and avoid unnecessary browser polyfills.
    target: 'chrome126',
    modulePreload: { polyfill: false },
    outDir: join(output, 'renderer'),
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('commonjsHelpers') || id.includes('vite/preload-helper')) return 'react'
      if (id.includes('node_modules/@xterm')) return 'terminal'
      if (['react-markdown', 'remark-', 'rehype-', 'highlight.js'].some(name => id.includes('node_modules/' + name))) return 'markdown'
      if (id.includes('node_modules/qrcode')) return 'qrcode'
      if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom')) return 'react'
    } } }
  }
})
const entry = join(output, 'legacy-entry.ts')
const typesSource = JSON.stringify(join(root, 'packages/shared/src/types.ts'))
const protocolSource = JSON.stringify(join(root, 'packages/shared/src/protocol.ts'))
writeFileSync(entry, `export { DEFAULT_SETTINGS } from ${typesSource}\nexport type { Conversation, LlmProvider, Message, MessageRole, Settings, TurnMeta } from ${typesSource}\nexport type { DesktopMigrationBundle } from ${protocolSource}\n`)
await esbuild({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: join(output, 'legacy.js') })
const types = await rollup({ input: entry, plugins: [dts({ respectExternal: true, compilerOptions: { skipLibCheck: true, moduleResolution: 100, module: 99 } })] })
try { await types.write({ file: join(output, 'legacy.d.ts'), format: 'es' }) } finally { await types.close() }
writeFileSync(join(output, 'package.json'), JSON.stringify({
  name: '@sislexa/chat-client', version, type: 'module',
  exports: {
    './renderer/index.html': './renderer/index.html',
    './legacy': { types: './legacy.d.ts', default: './legacy.js' },
    './release-source.json': './release-source.json'
  },
  files: ['renderer', 'legacy.js', 'legacy.d.ts', 'release-source.json']
}, null, 2) + '\n')
writeFileSync(join(output, 'release-source.json'), JSON.stringify({
  repository: 'https://github.com/sislex/voiceAIChat',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  version, dirty, requires: { coreApi: '^1.0.0', desktopHost: '^1.0.0' }
}, null, 2) + '\n')
if (process.argv.includes('--pack')) execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output], { cwd: output, stdio: 'inherit' })
