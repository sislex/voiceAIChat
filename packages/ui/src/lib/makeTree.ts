// Чистая логика дерева файлов Make: куда переедет файл при переносе в папку.
export function moveTargetPath(path: string, dir: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return dir ? `${dir}/${name}` : name
}

export function dirOfPath(path: string): string {
  const slash = path.indexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}
