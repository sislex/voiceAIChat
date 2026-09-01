// Блокировка рабочей копии живёт в БД, а не в памяти процесса: панель открывают в двух
// вкладках, а сервер может перезапуститься посреди push. Тесты про то, что замок
// действительно исключающий, снимается владельцем и не запирает каталог навсегда.
import { describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

function db(now: () => number): VoiceChatDb {
  let id = 0
  return new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now })
}

describe('git_workspace_locks', () => {
  it('второй захват того же каталога не проходит, освобождение возвращает доступ', () => {
    const store = db(() => 1_000)
    expect(store.acquireGitWorkspaceLock('a1', '/repo', 'bob:1', 'status', 60_000)).toMatchObject({ expiresAt: 61_000 })
    expect(store.acquireGitWorkspaceLock('a1', '/repo', 'alice:2', 'commit', 60_000)).toBeNull()
    expect(store.gitWorkspaceLockHolder('a1', '/repo')).toMatchObject({ holder: 'bob:1', operation: 'status' })
    // Чужой владелец снять замок не может — иначе один процесс освобождал бы каталог другого.
    store.releaseGitWorkspaceLock('a1', '/repo', 'alice:2')
    expect(store.acquireGitWorkspaceLock('a1', '/repo', 'alice:2', 'commit', 60_000)).toBeNull()
    store.releaseGitWorkspaceLock('a1', '/repo', 'bob:1')
    expect(store.acquireGitWorkspaceLock('a1', '/repo', 'alice:2', 'commit', 60_000)).not.toBeNull()
    store.close()
  })

  it('разные каталоги и разные машины не мешают друг другу', () => {
    const store = db(() => 1_000)
    expect(store.acquireGitWorkspaceLock('a1', '/one', 'bob:1', 'status', 60_000)).not.toBeNull()
    expect(store.acquireGitWorkspaceLock('a1', '/two', 'bob:1', 'status', 60_000)).not.toBeNull()
    expect(store.acquireGitWorkspaceLock('a2', '/one', 'bob:1', 'status', 60_000)).not.toBeNull()
    store.close()
  })

  it('просроченный замок не запирает каталог: упавший процесс не оставляет его навсегда', () => {
    let clock = 1_000
    const store = db(() => clock)
    expect(store.acquireGitWorkspaceLock('a1', '/repo', 'ушедший:1', 'push', 1_000)).not.toBeNull()
    clock = 2_500
    expect(store.gitWorkspaceLockHolder('a1', '/repo')).toBeNull()
    expect(store.acquireGitWorkspaceLock('a1', '/repo', 'bob:2', 'push', 1_000)).not.toBeNull()
    store.close()
  })
})
