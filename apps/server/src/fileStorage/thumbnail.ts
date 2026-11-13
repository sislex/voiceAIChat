import sharp from 'sharp'
import type { StorageThumbnailSize } from '@voicechat/shared/fileStorage'

/** Keeps libvips work bounded independently from request concurrency. */
export function createThumbnailGenerator(concurrency = 2) {
  let active = 0
  const waiting: Array<() => void> = []
  const enter = () => active < concurrency
    ? (active++, Promise.resolve())
    : new Promise<void>(resolve => waiting.push(() => { active++; resolve() }))
  const leave = () => { active--; waiting.shift()?.() }
  return async (bytes: Uint8Array, size: StorageThumbnailSize) => {
    await enter()
    try {
      const image = sharp(bytes, { animated: false, failOn: 'warning', limitInputPixels: 64 * 1024 * 1024 })
        .rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true })
      try { return { bytes: new Uint8Array(await image.clone().webp({ quality: 82 }).toBuffer()), mimeType: 'image/webp' as const } }
      catch { return { bytes: new Uint8Array(await image.jpeg({ quality: 85 }).toBuffer()), mimeType: 'image/jpeg' as const } }
    } finally { leave() }
  }
}
