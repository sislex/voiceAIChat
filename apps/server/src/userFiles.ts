import { realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { readUserFile, resolveUserFile } from './serverFiles.js'

export function userFilesDirectory(dataDir: string, userId: string): string {
 return join(dataDir, 'user-files', Buffer.from(userId, 'utf8').toString('base64url') || 'anonymous')
}

/** Read Core outputs and legacy generated files without creating a CLI profile. */
export function readCoreUserFile(path: string, dataDir: string, userId: string, extraRoots: string[] = []): ReturnType<typeof readUserFile> {
 const current = readUserFile(path, [userFilesDirectory(dataDir, userId), ...extraRoots])
 if (current.ok || current.reason !== 'not-found') return current
 const legacy = join(dataDir, 'cli-users', Buffer.from(userId, 'utf8').toString('base64url') || 'anonymous')
 const absolute = resolveUserFile(path, [legacy])
 if (!absolute) return current
 // Legacy outputs may be at the profile root, but hidden auth/config directories
 // are private. Resolve links before checking this boundary.
 const parts = relative(realpathSync(legacy), absolute).split(sep)
 const generated = parts[0] === '.generated_images' || (parts[0] === '.codex' && parts[1] === 'generated_images')
 if (!parts[0] || (parts[0].startsWith('.') && !generated)) return current
 return readUserFile(absolute, [legacy])
}
