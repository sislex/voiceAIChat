import { closeSync, openSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadComponentConfiguration } from './index.js'
import { ComponentTokenRegistry } from './registry.js'

/** Secrets are written once to a new private file, never to terminal or logs. */
export function runTokenCommand(argv: string[]): unknown {
  const [command, ...args] = argv
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    if (!['--contract', '--config', '--consumer', '--scopes', '--ttl', '--out', '--id'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw Error('Invalid token command options')
    options.set(args[i], args[i + 1])
  }
  const contractFile = options.get('--contract'), configFile = options.get('--config')
  if (!contractFile || !configFile || !['issue', 'revoke', 'list'].includes(command)) throw Error('Use issue|revoke|list with --contract and --config')
  const { contract, config } = loadComponentConfiguration(contractFile, configFile)
  const registry = new ComponentTokenRegistry(contract, config)
  try {
    if (command === 'list') return registry.list()
    if (command === 'revoke') {
      const tokenId = options.get('--id')
      if (!tokenId || !/^[a-f0-9]{32}$/.test(tokenId)) throw Error('A token ID is required')
      return { tokenId, revoked: registry.revoke(tokenId) }
    }
    const output = options.get('--out')
    if (!output?.startsWith('/')) throw Error('An absolute output file is required')
    const fd = openSync(output, 'wx', 0o600)
    let issued: ReturnType<ComponentTokenRegistry['issue']> | undefined
    try {
      issued = registry.issue(options.get('--consumer') ?? '', (options.get('--scopes') ?? '').split(',').filter(Boolean), Number(options.get('--ttl')))
      writeFileSync(fd, issued.token + '\n')
      return issued.principal
    } catch (error) { if (issued) registry.revoke(issued.principal.tokenId); throw error }
    finally { closeSync(fd) }
  } finally { registry.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runTokenCommand(process.argv.slice(2)))) }
  catch { console.error('Component token command failed; check arguments, grants and private storage.'); process.exitCode = 1 }
}
