import type { ConsoleHistoryStore } from '@voicechat/ui-foundation/components/machine'

export const COMMAND_HISTORY_LIMIT = 200
const memory = new Map<string, string[]>()
const unavailable = new Set<string>()
const key = (id: string): string => 'vc:console-history:' + encodeURIComponent(id)

export function readMachineHistory(id: string): string[] {
  try {
    const stored = localStorage.getItem(key(id))
    if (stored === null) return unavailable.has(id) ? memory.get(id) ?? [] : []
    const raw: unknown = JSON.parse(stored)
    if (Array.isArray(raw) && raw.every((s) => typeof s === 'string')) {
      const commands = raw.slice(-COMMAND_HISTORY_LIMIT)
      memory.set(id, commands)
      return commands
    }
  } catch { /* Restricted storage still permits an in-memory session. */ }
  return memory.get(id) ?? []
}

function write(id: string, commands: string[]): void {
  memory.set(id, commands)
  try { localStorage.setItem(key(id), JSON.stringify(commands)); unavailable.delete(id) } catch { unavailable.add(id) }
}

export const machineHistory: ConsoleHistoryStore = {
  get: readMachineHistory,
  push(id, command) {
    const commands = readMachineHistory(id)
    if (!command.trim() || commands[commands.length - 1] === command) return
    write(id, [...commands, command].slice(-COMMAND_HISTORY_LIMIT))
  },
  clear(id) { write(id, []) }
}
