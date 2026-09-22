import type { FsEntry } from '@sislexa/agent-contracts'

const listings = new Map<string, FsEntry[]>()
const normalize = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
const key = (agentId: string, cwd: string): string => JSON.stringify([agentId, normalize(cwd)])

export function rememberListing(agentId: string, cwd: string, entries: FsEntry[]): void {
  listings.set(key(agentId, cwd), entries.map((entry) => ({ ...entry })))
}

export function completePath(agentId: string, cwd: string, value: string, directoriesOnly = false): string[] {
  const normalized = value.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const parent = slash < 0 ? cwd : normalized.slice(0, slash + 1)
  const absoluteParent = /^(\/|[A-Za-z]:\/)/.test(parent) ? parent : cwd.replace(/[/\\]+$/, '') + '/' + parent
  const listing = listings.get(key(agentId, slash < 0 ? cwd : absoluteParent))
  if (!listing) return []
  const prefix = normalized.slice(slash + 1)
  return listing.filter((e) => (!directoriesOnly || e.kind === 'dir') && e.name.startsWith(prefix))
    .map((e) => value.slice(0, slash + 1) + e.name + (e.kind === 'dir' ? '/' : ''))
}

export function completeCommand(agentId: string, cwd: string, command: string): string[] {
  // Refuse shell operators and substitutions rather than guessing their context.
  if (/[\x60$;|&<>]/.test(command)) return []
  const match = /(?:^|\s)(?:'([^']*)'?|"([^"]*)"?|([^\s"']*))$/.exec(command)
  if (!match) return []
  const word = match[1] ?? match[2] ?? match[3] ?? ''
  const start = match.index + (/^\s/.test(match[0]) ? 1 : 0)
  return completePath(agentId, cwd, word).map((path) => command.slice(0, start) + "'" + path.replace(/'/g, "'\\''") + "'")
}
