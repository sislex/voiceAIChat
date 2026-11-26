// The production file storage overlay must stay inert until provisioned and never hard-code the host address.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8')
const overlay = read('deploy/compose.storage.yml')
const caddyfile = read('Caddyfile')
const provision = read('scripts/prod/storage-provision.sh')

describe('production storage overlay', () => {
  it('needs the provisioned variables instead of defaults for secrets and paths', () => {
    for (const name of ['VC_APPLICATIONS_WITH_STORAGE', 'VC_STORAGE_DIR', 'VC_STORAGE_DB_URL', 'VC_APPLICATION_STORAGE_TOKEN']) {
      expect(overlay).toMatch(new RegExp('\\$\\{' + name + ':\\?'))
    }
    expect(overlay.replaceAll('0.0.0.0', '')).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
  })
  it('limits the node and keeps Core on the remote storage mode', () => {
    expect(overlay).toContain('VC_FILE_STORAGE_MODE: remote')
    expect(overlay).toContain('VC_FILE_STORAGE_CAPACITY_BYTES: ${VC_STORAGE_CAPACITY_BYTES:-3221225472}')
    expect(overlay).toContain('STORAGE_AUTH_MODE: legacy')
  })
  it('publishes the storage port through Caddy with the same local CA and no hard-coded host', () => {
    expect(overlay).toContain('- "8799:8799"')
    expect(caddyfile).toMatch(/https:\/\/\{\$VC_PUBLIC_HOST\}:8799 \{\n\ttls internal\n\treverse_proxy \{\$VC_CADDY_STORAGE_UPSTREAM:storage:8799\}/)
  })
  it('provisioning is restart-free and keeps secrets out of its output', () => {
    expect(provision).not.toMatch(/^\s*docker (compose )?(restart|stop|rm|down)\b/m)
    expect(provision).toContain('--dry-run')
    expect(provision).toContain('# >>> storage')
    expect(provision).not.toMatch(/echo [^\n]*(DB_PASS|app\.token|\$token)/)
  })
})
