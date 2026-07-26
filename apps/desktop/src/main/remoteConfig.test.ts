import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isDesktopMigrationDone,
  markDesktopMigrationDone,
  readServerUrl,
  writeServerUrl
} from './remoteConfig'

describe('remoteConfig', () => {
  it('нет файла → null (сервер не настроен)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      expect(readServerUrl(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('write → read, обрезает хвостовой слэш', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      writeServerUrl(dir, 'http://host:8787/')
      expect(readServerUrl(dir)).toBe('http://host:8787')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('null/пусто → сброс адреса сервера', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      writeServerUrl(dir, 'http://host:8787')
      writeServerUrl(dir, null)
      expect(readServerUrl(dir)).toBeNull()
      writeServerUrl(dir, '   ')
      expect(readServerUrl(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('пометка миграции хранится отдельно для каждого сервера', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      writeServerUrl(dir, 'http://one:8787')
      markDesktopMigrationDone(dir, 'http://one:8787/')
      expect(isDesktopMigrationDone(dir, 'http://one:8787')).toBe(true)
      expect(isDesktopMigrationDone(dir, 'http://two:8787')).toBe(false)
      writeServerUrl(dir, 'http://two:8787')
      expect(isDesktopMigrationDone(dir, 'http://one:8787')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
