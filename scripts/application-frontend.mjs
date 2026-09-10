// Собирает только продуктовую панель. React и контексты приходят от оболочки;
// её bundle не содержит ни исходников панели, ни версии её выпуска.
import { build } from 'vite'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'
import { parseApplicationFrontendManifest } from '../packages/shared/src/applicationFrontend.ts'
const root = resolve(import.meta.dirname, '..')
export async function buildApplicationFrontend(
  id,
  { repo = root, version, commit } = {}
) {
  const app = APPLICATION_CATALOG.find((item) => item.id === id)
  if (app?.kind !== 'frontend' || !app.frontend)
    throw new Error(`Нет frontend-артефакта ${id}`)
  const directory = join(repo, app.paths[0]),
    pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const release = JSON.parse(
    readFileSync(join(directory, 'release.json'), 'utf8')
  )
  version ??= process.env.VC_APPLICATION_VERSION ?? pkg.version
  if (commit === undefined) {
    commit = process.env.VC_APPLICATION_COMMIT || process.env.VC_RELEASE_COMMIT
    if (!commit) {
      try {
        commit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repo,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
      } catch {
        commit = null
      }
    }
  }
  const output = join(directory, 'dist')
  await build({
    configFile: false,
    root: directory,
    esbuild: { jsx: 'automatic', jsxDev: false },
    base: './',
    experimental: {
      renderBuiltUrl(filename, { hostType }) {
        return hostType === 'js'
          ? { runtime: `__voicechatAssetUrl(${JSON.stringify(filename)})` }
          : { relative: true }
      }
    },
    resolve: {
      alias: [
        { find: /^@shared\//, replacement: join(repo, 'packages/shared/src/') }
      ]
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __APPLICATION_VERSION__: JSON.stringify(version),
      __APPLICATION_COMMIT__: JSON.stringify(commit)
    },
    build: {
      outDir: output,
      emptyOutDir: true,
      cssCodeSplit: false,
      sourcemap: false,
      lib: {
        entry: join(directory, app.frontend.entry),
        name: 'VoiceChatPanel',
        formats: ['iife'],
        fileName: () => 'panel.js'
      },
      rollupOptions: {
        external: [
          'react',
          'react-dom',
          'react/jsx-runtime',
          '@voicechat/ui-kit',
          '@voicechat/ui-foundation/runtime'
        ],
        output: {
          inlineDynamicImports: true,
          intro: `const __voicechatAssetBase = new URL('.', document.currentScript.src).href;
const __voicechatWorkerUrls = new Map();
function __voicechatAssetUrl(path) {
  const url = new URL(path, __voicechatAssetBase);
  if (!path.includes('.worker-') || url.origin === location.origin) return url.href;
  if (!__voicechatWorkerUrls.has(path)) __voicechatWorkerUrls.set(path, URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(url.href) + ')'], {type:'text/javascript'})));
  return __voicechatWorkerUrls.get(path);
}`,
          globals: {
            react: 'VoiceChatApplicationHost.react',
            'react-dom': 'VoiceChatApplicationHost.reactDom',
            'react/jsx-runtime': 'VoiceChatApplicationHost.jsx',
            '@voicechat/ui-kit': 'VoiceChatApplicationHost.uiKit',
            '@voicechat/ui-foundation/runtime':
              'VoiceChatApplicationHost.runtime'
          }
        }
      }
    }
  })
  const integrity = (path) =>
    'sha384-' +
    createHash('sha384')
      .update(readFileSync(join(output, path)))
      .digest('base64')
  // Entry и CSS имеют собственные неизменяемые имена; манифест можно обновить
  // независимо от уже загруженной страницы и от build оболочки.
  const rename = async (path) => {
    const content = readFileSync(join(output, path)),
      hash = createHash('sha256').update(content).digest('hex').slice(0, 20),
      name = path.replace(/\.(js|css)$/, `-${hash}.$1`)
    const { renameSync } = await import('node:fs')
    renameSync(join(output, path), join(output, name))
    return { path: name, integrity: integrity(name) }
  }
  const entry = await rename('panel.js'),
    styles = []
  for (const file of readdirSync(output))
    if (file.endsWith('.css')) styles.push(await rename(file))
  const manifest = parseApplicationFrontendManifest(
    {
      schemaVersion: 1,
      applicationId: id,
      version,
      apiVersion: release.apiVersion,
      commit,
      ...(commit === null ? { development: true } : {}),
      host: release.host,
      entry,
      styles
    },
    id
  )
  writeFileSync(
    join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  console.log(`[frontend] ${id} ${version}: ${relative(repo, output)}`)
  return manifest
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const ids = process.argv.slice(2)
  for (const id of ids.length
    ? ids
    : APPLICATION_CATALOG.filter((app) => app.frontend).map((app) => app.id))
    await buildApplicationFrontend(id)
}
