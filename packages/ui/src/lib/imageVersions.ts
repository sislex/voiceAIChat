// Цепочка версий картинки студии: по мете source (правки пишут исходник)
// строится путь от корня до последнего потомка через указанный файл.
import type { ImageStudioFile } from '@shared/imageStudio'

/**
 * Путь версий через `path`: вверх по source до корня, вниз — по первому
 * потомку на каждом шаге (ветвления обрезаются: показываем одну нить).
 * Циклы защищены посещёнными узлами.
 */
export function versionChain(files: ImageStudioFile[], path: string): string[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  if (!byPath.has(path)) return []
  const visited = new Set<string>([path])
  const chain = [path]
  // Вверх к корню.
  let current = byPath.get(path)
  while (current?.source && byPath.has(current.source) && !visited.has(current.source)) {
    visited.add(current.source)
    chain.unshift(current.source)
    current = byPath.get(current.source)
  }
  // Вниз по потомкам (первый по времени создания — стабильно по updatedAt).
  let tail = path
  for (;;) {
    const children = files.filter((file) => file.source === tail && !visited.has(file.path)).sort((a, b) => a.updatedAt - b.updatedAt)
    const next = children[0]
    if (!next) break
    visited.add(next.path)
    chain.push(next.path)
    tail = next.path
  }
  return chain
}
