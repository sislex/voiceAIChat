/** Байты уже загруженной картинки: этот порт не выполняет HTTP-запросы API. */
export async function readBrowserBlob(url: string): Promise<Blob> {
  if (!/^(blob:|data:image\/)/.test(url)) throw new Error('Ожидалась локальная картинка')
  const response = await fetch(url)
  if (!response.ok) throw new Error('Картинка недоступна')
  return response.blob()
}
/** Прямой Storybook проверяется только на loopback и только по настроенному порту. */
export async function probeLocalStorybook(port: number, storyIds: string[]): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof window === 'undefined') return false
  try {
    const response = await fetch(`http://127.0.0.1:${port}/index.json`, { signal: AbortSignal.timeout(1500), mode: 'cors' })
    if (!response.ok) return false
    const index = await response.json() as { entries?: Record<string, unknown>; stories?: Record<string, unknown> }
    const stories = index.entries ?? index.stories
    return !stories || storyIds.some(id => Object.hasOwn(stories, id))
  } catch { return false }
}
