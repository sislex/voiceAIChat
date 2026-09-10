// Кэш превью студии картинок в IndexedDB: base64 каждой картинки при каждом
// открытии галереи — лишний трафик и ожидание; ключ (разговор, путь,
// updatedAt) делает записи самоинвалидирующимися. Без IndexedDB (jsdom,
// приватные режимы) все функции — безопасный no-op.

const DB_NAME = 'vc-imgstudio-previews'
const STORE = 'previews'
/** Не даём кэшу расти бесконечно: старше недели — не отдаём. */
const TTL_MS = 7 * 24 * 3600 * 1000

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Разделитель «|» безопасен: в путях галереи его не бывает (safeName). */
export function previewCacheKey(conversationId: string, path: string, updatedAt: number): string {
  return `${conversationId}|${path}|${updatedAt}`
}

export async function getCachedPreview(conversationId: string, path: string, updatedAt: number): Promise<Blob | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(previewCacheKey(conversationId, path, updatedAt))
      request.onsuccess = () => {
        const value = request.result as { blob: Blob; at: number } | undefined
        resolve(value && Date.now() - value.at < TTL_MS ? value.blob : null)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function putCachedPreview(conversationId: string, path: string, updatedAt: number, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ blob, at: Date.now() }, previewCacheKey(conversationId, path, updatedAt))
  } catch { /* квота/приватный режим — просто без кэша */ }
}
