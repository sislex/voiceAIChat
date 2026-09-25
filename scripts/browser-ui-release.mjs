// Run inside the installed Core container; UI-only activation never restarts it.
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { activateBrowserUi, installBrowserUi, listBrowserUiReleases, readBrowserUiActivation } from '../apps/server/src/browserUi/releases.ts'
import { BROWSER_UI_RUNTIME_PATH } from '../packages/shared/src/browserUiRelease.ts'

export async function main(args = process.argv.slice(2)) {
  const command = args[0]
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  if (command === 'describe') {
    const contract = { schemaVersion: 1, kind: 'sislexa-browser-ui-owner', version: 2, intentBoundGeneration: true, manifestBytes: true }
    console.log(JSON.stringify(contract)); return contract
  }
  const root = resolve(option('--root') ?? process.env.VC_BROWSER_UI_DIR ?? resolve(process.env.VC_DATA_DIR ?? '.voicechat', 'browser-ui'))
  const origin = option('--core') ?? 'http://127.0.0.1:' + (process.env.PORT ?? '8787')
  const response = await fetch(new URL(BROWSER_UI_RUNTIME_PATH, origin), { signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('Running Core does not support independent browser releases')
  const runtime = await response.json()
  if (runtime.schemaVersion !== 1 || typeof runtime.coreApi !== 'string' || typeof runtime.applicationHost !== 'string') throw Error('Invalid running Core compatibility response')
  if (command === 'status') { console.log(JSON.stringify(runtime, null, 2)); return runtime }
  const previous = readBrowserUiActivation(root)
  if (command === 'inspect') {
    const result = { runtime, activation: previous, installed: listBrowserUiReleases(root, runtime) }
    console.log(JSON.stringify(result, null, 2))
    return result
  }
  // Controlled callers bind the previous generation and active release to their
  // immutable intent. The same generation also reaches the activation CAS.
  const expectedOption = option('--expected-generation')
  const expectedGeneration = expectedOption === undefined ? runtime.configuredGeneration : JSON.parse(expectedOption)
  if (expectedGeneration !== null && (typeof expectedGeneration !== 'string' || !expectedGeneration)) throw Error('Invalid expected generation')
  if (runtime.configuredGeneration !== expectedGeneration) throw Error('Browser UI expected generation changed')
  const expectedActive = option('--expected-active')
  if (expectedActive !== undefined && runtime.active !== JSON.parse(expectedActive)) throw Error('Browser UI expected active release changed')
  if ((previous?.generation ?? null) !== runtime.configuredGeneration) throw Error('The deployment directory does not match running Core')
  let id
  if (command === 'install') {
    const source = option('--directory')
    if (!source) throw Error('Expected --directory with an owner-built browser release')
    const manifestHash = option('--manifest-sha256')
    if (manifestHash !== undefined && (!/^[a-f0-9]{64}$/.test(manifestHash) ||
      createHash('sha256').update(readFileSync(resolve(source, 'manifest.json'))).digest('hex') !== manifestHash)) throw Error('Browser UI manifest bytes changed')
    const target = option('--target-release')
    if (target !== undefined && JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8')).id !== target) throw Error('Browser UI target release changed')
    id = installBrowserUi(root, resolve(source), runtime).id
  } else if (command === 'activate') {
    id = option('--release')
    if (!id) throw Error('Expected --release ID or bundled')
    if (id === 'bundled') id = null
  } else if (command === 'rollback') {
    if (!previous) throw Error('No previous browser UI activation')
    id = previous.previous
  } else throw Error('Expected status, inspect, install, activate or rollback')
  const next = activateBrowserUi(root, id, runtime, option('--actor') ?? 'server-deploy', expectedGeneration)
  const check = await fetch(new URL(BROWSER_UI_RUNTIME_PATH, origin), { signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!check.ok || (await check.json()).generation !== next.generation) throw Error('Core did not acknowledge activation; inspect status before retrying')
  console.log(JSON.stringify(next, null, 2))
  return next
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
