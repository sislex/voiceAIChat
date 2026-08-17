export function normalizeMachinePath(input: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(input) || input.includes('\\')
  const separator = windows ? '\\' : '/'
  const root = windows ? (input.match(/^[A-Za-z]:/)?.[0].toUpperCase() ?? '') + separator : separator
  const parts = input.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').split('/').filter(Boolean)
  const safe: string[] = []; for (const part of parts) { if (part === '.') continue; if (part === '..') safe.pop(); else safe.push(part) }
  return root + safe.join(separator)
}
export function isPathAllowed(path: string, allowedDirs: readonly string[]): boolean {
  const candidate = normalizeMachinePath(path).toLowerCase()
  return allowedDirs.some((dir) => { const root = normalizeMachinePath(dir).toLowerCase().replace(/[\\/]$/, ''); return candidate === root || candidate.startsWith(root + (root.includes('\\') ? '\\' : '/')) })
}
export function machineBreadcrumbs(path: string): string[] {
  const normalized = normalizeMachinePath(path); const separator = normalized.includes('\\') ? '\\' : '/'
  const root = /^[A-Z]:\\/.test(normalized) ? normalized.slice(0,3) : '/'
  const parts = normalized.slice(root.length).split(separator).filter(Boolean); return [root, ...parts.map((_, index) => root + parts.slice(0,index+1).join(separator))]
}
