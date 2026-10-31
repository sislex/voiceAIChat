import { DEFAULT_STORAGE_QUOTA_BYTES } from '@voicechat/shared/fileStorage'
export interface FileStorageConfig {
  partSize?: number
  mode: 'off' | 'embedded'
  nodes: Array<{id: string; url: string; tokenFile: string}>
  defaultQuotaBytes: number
}
export function fileStorageConfig(env: NodeJS.ProcessEnv): FileStorageConfig {
  const mode = env.VC_FILE_STORAGE_MODE ?? 'off'
  if (mode !== 'off' && mode !== 'embedded') throw new Error('Invalid VC_FILE_STORAGE_MODE')
  const nodes: unknown = JSON.parse(env.VC_FILE_STORAGE_NODES ?? '[]')
  if (!Array.isArray(nodes)) throw new Error('Invalid VC_FILE_STORAGE_NODES')
  const ids = new Set<string>()
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id) ||
        typeof node.url !== 'string' || typeof node.tokenFile !== 'string' || !node.tokenFile.trim())
      throw new Error('Invalid VC_FILE_STORAGE_NODES')
    const url = new URL(node.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Invalid storage node URL')
    ids.add(node.id)
  }
  const defaultQuotaBytes = Number(env.VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES ?? DEFAULT_STORAGE_QUOTA_BYTES)
  if (!Number.isSafeInteger(defaultQuotaBytes) || defaultQuotaBytes < 0) throw new Error('Invalid VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES')
  const partSize = Number(env.VC_FILE_STORAGE_PART_SIZE_BYTES ?? 8 * 1024 * 1024)
  if (!Number.isSafeInteger(partSize) || partSize < 1 || partSize > 64 * 1024 * 1024) throw new Error('Invalid VC_FILE_STORAGE_PART_SIZE_BYTES')
  return { mode, nodes, defaultQuotaBytes, partSize }
}
