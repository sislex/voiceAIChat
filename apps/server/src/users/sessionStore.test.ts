import { describe, it } from 'vitest'
import { sessionStoreContract, createContractClock } from '@voicechat/sessions-core/testing'
import { VoiceChatDb } from '../db/database.js'
import { createDbSessionStore } from './sessionStore.js'

// Тот же контракт, что проходит реализация в памяти. Если SQLite начнёт вести
// себя иначе (порядок, экономия записей, воскрешение отозванной строки),
// расхождение всплывёт здесь, а не в проде.
describe('SQLite-хранилище сессий: контракт ядра', () => {
  for (const item of sessionStoreContract) {
    it(item.name, async () => {
      const clock = createContractClock()
      const db = new VoiceChatDb(':memory:')
      try {
        await item.run({ store: createDbSessionStore(db, clock.now), clock })
      } finally {
        db.close()
      }
    })
  }
})
