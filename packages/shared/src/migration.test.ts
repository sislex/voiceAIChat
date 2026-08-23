import { describe, expect, it } from 'vitest'
import { isMigrationPathInside, migrationDestinationRelativePath, migrationPathKey } from './migration.js'

describe('storage migration contract', () => {
  it('builds canonical destinations for every assignment', () => {
    expect(migrationDestinationRelativePath({ kind: 'chat', conversationId: 'chat-1' }, 'photo.png')).toBe('chats/chat-1/attachments/photo.png')
    expect(migrationDestinationRelativePath({ kind: 'project', projectId: 'p1' }, 'a.zip')).toBe('projects/p1/artifacts/a.zip')
    expect(migrationDestinationRelativePath({ kind: 'task', projectId: 'p1', taskId: 't1' }, 'log.txt')).toBe('projects/p1/tasks/t1/artifacts/log.txt')
    expect(migrationDestinationRelativePath({ kind: 'environment', projectId: 'p1', environment: 'preview', taskId: 't1', previewId: 'v1' }, 'x.png')).toBe('projects/p1/tasks/t1/environments/preview/v1/artifacts/x.png')
  })

  it('rejects traversal and missing environment identity', () => {
    expect(() => migrationDestinationRelativePath({ kind: 'project', projectId: 'p1' }, '../secret')).toThrow()
    expect(() => migrationDestinationRelativePath({ kind: 'environment', projectId: 'p1', environment: 'test' }, 'x')).toThrow('taskId')
  })

  it.each([
    ['linux', '/data/store/projects/p', '/data/store', true],
    ['darwin', '/Users/a/store/chats/c', '/Users/a/store', true],
    ['android', '/data/data/com.termux/files/home/store/x', '/data/data/com.termux/files/home/store', true],
    ['win32', 'C:\\Store\\Chats\\A', 'c:\\store', true],
    ['win32', '\\\\server\\share\\Store2', '\\\\server\\share\\Store', false]
  ])('keeps paths inside storage on %s', (platform, path, root, expected) => {
    expect(isMigrationPathInside(path, root, platform)).toBe(expected)
  })

  it('folds Windows case for collision detection only', () => {
    expect(migrationPathKey('C:\\Store\\A.PNG', 'win32')).toBe(migrationPathKey('c:/store/a.png', 'win32'))
    expect(migrationPathKey('/Store/A', 'linux')).not.toBe(migrationPathKey('/store/a', 'linux'))
  })
})
