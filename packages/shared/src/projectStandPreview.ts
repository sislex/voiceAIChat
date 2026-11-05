/**
 * Owner-configured preview stand of an ordinary web project: Core runs `command` in the
 * project's working copy on a machine and exposes `port` through the stand proxy.
 */
export interface ProjectStandPreview {
  command: string
  port: number
  workdir?: string
  readinessPath?: string
}

/** Validates an untrusted config; null when invalid. `reservedPorts` are Core's stand proxy ports. */
export function parseProjectStandPreview(input: unknown, reservedPorts: readonly number[] = []): ProjectStandPreview | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const { command, port, workdir, readinessPath, ...rest } = input as Record<string, unknown>
  if (Object.keys(rest).length) return null
  if (typeof command !== 'string' || !command.trim() || command.length > 2000 || /[\0\r\n]/.test(command)) return null
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535 || reservedPorts.includes(port)) return null
  const result: ProjectStandPreview = { command, port }
  if (workdir !== undefined) {
    if (typeof workdir !== 'string' || !workdir || workdir.length > 500 || workdir.startsWith('/') || /[\0\\\r\n]/.test(workdir)) return null
    if (workdir !== '.' && workdir.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) return null
    result.workdir = workdir
  }
  if (readinessPath !== undefined) {
    if (typeof readinessPath !== 'string' || !readinessPath.startsWith('/') || readinessPath.length > 500 || /[\0\s]/.test(readinessPath)) return null
    result.readinessPath = readinessPath
  }
  return result
}
