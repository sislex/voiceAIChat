import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Deployment checks both directions without making static health recursively depend on peers. */
export async function verifyComponentReadiness({ configFile, port = 8787, fetchImpl = fetch }) {
  if (!configFile) return { managed: false, ready: true }
  const config = JSON.parse(readFileSync(configFile, 'utf8'))
  const targets = [{ applicationId: 'core', url: `http://127.0.0.1:${port}` }, ...config.dependencies]
  const results = await Promise.all(targets.map(async ({ applicationId, url }) => {
    try {
      const response = await fetchImpl(url + '/v1/ready', { redirect: 'error', signal: AbortSignal.timeout(5000) })
      const body = await response.json()
      return { applicationId, ready: response.ok && body.ok === true }
    } catch { return { applicationId, ready: false } }
  }))
  return { managed: true, ready: results.every(result => result.ready), components: results }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyComponentReadiness({ configFile: process.env.SISLEXA_COMPONENT_CONFIG, port: Number(process.env.PORT || 8787) })
    console.log(JSON.stringify(result)); if (!result.ready) process.exitCode = 1
  } catch { console.error('Managed component readiness could not be verified'); process.exitCode = 1 }
}
