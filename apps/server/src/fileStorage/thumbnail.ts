import sharp from 'sharp'
import { MAX_STORAGE_THUMBNAIL_INPUT_BYTES, type StorageThumbnailSize } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'

/** Keeps libvips work bounded independently from request concurrency. */
export function createThumbnailGenerator(concurrency = 2) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid thumbnail concurrency')
  let active = 0
  const waiting: Array<() => void> = []
  const enter = () => active < concurrency
    ? (active++, Promise.resolve())
    : new Promise<void>(resolve => waiting.push(() => { active++; resolve() }))
  const leave = () => { active--; waiting.shift()?.() }
  return async (bytes: Uint8Array, size: StorageThumbnailSize) => {
    if (bytes.byteLength > MAX_STORAGE_THUMBNAIL_INPUT_BYTES) throw new StorageServiceError('unsupported_media_type')
    await enter()
    try {
      const image = sharp(bytes, { animated: false, failOn: 'warning', limitInputPixels: 64 * 1024 * 1024 })
        .rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true })
      const metadata = await image.metadata()
      if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? '')) throw new StorageServiceError('unsupported_media_type')
      try { return { bytes: new Uint8Array(await image.clone().webp({ quality: 82 }).toBuffer()), mimeType: 'image/webp' as const } }
      catch { return { bytes: new Uint8Array(await image.jpeg({ quality: 85 }).toBuffer()), mimeType: 'image/jpeg' as const } }
    } catch {
      throw new StorageServiceError('unsupported_media_type')
    } finally { leave() }
  }
}
