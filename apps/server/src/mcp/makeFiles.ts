import type { MachinesService } from '../machines/service.js'

export const MAKE_FILE_MAX_BYTES = 10 * 1024 * 1024

export function checkedBytes(dataBase64: string | undefined, truncated = false): string {
  if (truncated || dataBase64 === undefined) throw new Error('Incomplete file')
  if (Buffer.byteLength(dataBase64, 'base64') > MAKE_FILE_MAX_BYTES) throw new Error('File exceeds 10 MiB')
  return dataBase64
}

/** Fixed agent-side validation; no model-supplied program is executed. */
export async function confinedPath(registry: MachinesService, agent: string, root: string | undefined, path: string): Promise<string> {
  if (!agent || !root) throw new Error('Configure a machine and workdir in chat settings')
  const args = Buffer.from(JSON.stringify({ root, path })).toString('base64')
  const program = [
    "const fs = require('node:fs'), p = require('node:path');",
    "const {root,path:input} = JSON.parse(Buffer.from(process.argv[1], 'base64').toString());",
    "const base = p.resolve(root), target = p.resolve(base,input);",
    "if (!p.isAbsolute(root) || base === p.parse(base).root || input.includes('\\0') ||",
    "p.relative(base,target).split(p.sep).includes('..') ||",
    "p.relative(base,target).split(p.sep).includes('.git')) throw Error('Path outside workdir');",
    "let current = p.parse(target).root;",
    "for (const part of target.slice(current.length).split(p.sep).filter(Boolean)) {",
    "current = p.join(current,part);",
    "try { if(fs.lstatSync(current).isSymbolicLink()) throw Error('Symlinks are forbidden'); }",
    "catch(e) { if(e.code !== 'ENOENT') throw e; }",
    "}",
    "try { const s = fs.statSync(target); if ((!s.isFile() && !s.isDirectory()) || s.size > 10 * 1024 * 1024) throw Error('Unsupported or oversized file'); } catch(e) { if(e.code !== 'ENOENT') throw e; }",
    "process.stdout.write(target);"
  ].join('\n')
  const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
  const result = await registry.exec(agent, 'node -e ' + quote(program) + ' ' + quote(args), 120000)
  if (result.exitCode !== 0 || result.timedOut || !result.output.trim()) throw new Error('Path validation failed: ' + result.output)
  return result.output.trim()
}

export interface MakeFileTransfer {
  available(conversationId: string): Promise<boolean>
  read(conversationId: string, path: string): Promise<string>
  write(conversationId: string, path: string, dataBase64: string, turn?: string): Promise<void>
}

export function makeFilePath(path: string): string {
  if (!path || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path) ||
      path.includes('\0') || path.split('/').some(p => !p || p === '..' || p === '.' || p === '.git' || p === '.make'))
    throw new Error('Invalid Make project path')
  return path
}
