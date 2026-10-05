import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { KbFiles } from '../../../../packages/knowledge/src/ports.js'
export function listMarkdown(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory() && entry.name !== 'log') walk(path); else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') out.push(path) } }
  walk(root); return out.sort()
}

export const kbFiles: KbFiles = { exists: existsSync, read: path => readFileSync(path, 'utf8'), listMarkdown }
