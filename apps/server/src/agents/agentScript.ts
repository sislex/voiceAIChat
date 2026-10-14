// Serve the owner-built script; installing Core never compiles companion source.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const SCRIPT = '@sislexa/agent/voicechat-agent.cjs'

/** Exact bundle bytes; `servedAgent().sha256` is computed over the same bytes. */
export function buildAgentScript(): Promise<Buffer> {
  return readFile(require.resolve(SCRIPT))
}

/** Version and SHA-256 (hex) of the agent bytes served at `/api/agents/script`. */
export interface ServedAgent { version: string; sha256: string }
let served: ServedAgent | undefined

/**
 * The served agent identity, computed once per process: the version comes from the
 * `@sislexa/agent` package manifest, the digest from the exact bundle bytes. Supervised
 * agents verify the digest before replacing themselves (stand-https-v1 C01).
 */
export function servedAgent(): ServedAgent {
  if (!served) {
    const { version } = require('@sislexa/agent/package.json') as { version: string }
    const sha256 = createHash('sha256').update(readFileSync(require.resolve(SCRIPT))).digest('hex')
    served = { version, sha256 }
  }
  return served
}
