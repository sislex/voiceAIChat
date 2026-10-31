import { DEFAULT_STORAGE_QUOTA_BYTES } from '@voicechat/shared/fileStorage'
export interface FileStorageConfig {
  mode: 'off' | 'embedded'
  nodes: Array<{id: string; url: string; tokenFile: string; publicUrl?: string; directSecretFile?: string}>
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
    if (node.publicUrl !== undefined) {
      if (typeof node.publicUrl !== 'string' || typeof node.directSecretFile !== 'string' || !node.directSecretFile.trim())
        throw new Error('Public storage nodes require directSecretFile')
      const publicUrl = new URL(node.publicUrl)
      if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash)
        throw new Error('Invalid public storage node URL')
    }
    ids.add(node.id)
  }
  const defaultQuotaBytes = Number(env.VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES ?? DEFAULT_STORAGE_QUOTA_BYTES)
  if (!Number.isSafeInteger(defaultQuotaBytes) || defaultQuotaBytes < 0) throw new Error('Invalid VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES')
  return { mode, nodes, defaultQuotaBytes }
}
