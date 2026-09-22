// Serve the owner-built script; installing Core never compiles companion source.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export function buildAgentScript(): Promise<string> {
  return readFile(require.resolve('@sislexa/agent/voicechat-agent.cjs'), 'utf8')
}
