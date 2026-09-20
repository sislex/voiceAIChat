import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'

export function assertPrivate(path: string, directory = false): void {
  const stat = lstatSync(path)
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 || (!directory && stat.nlink !== 1) ||
      (process.getuid && stat.uid !== process.getuid())) throw Error('Component credentials require private owner-controlled storage')
}
export function readSecret(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw Error('Invalid credential file')
    const value = readFileSync(fd, 'utf8').trim()
    if (!/^sc1_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(value)) throw Error('Invalid component credential')
    return value
  } finally { closeSync(fd) }
}
