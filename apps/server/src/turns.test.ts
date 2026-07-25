import { describe, it, expect } from 'vitest'
import { createTurnManager } from './turns.js'
import { VoiceChatDb } from './db/database.js'
import { DEFAULT_AGENT_POLICY } from '@voicechat/shared'
import type { LlmClient, LlmRequest } from './claude/types.js'

const U = 'admin'

/** Мок движка: запоминает запрос и сразу завершает ход. */
function recorder(): { client: LlmClient; last: () => LlmRequest | null } {
  let last: LlmRequest | null = null
  return {
    client: {
      send(req, h) {
        last = req
        h.onDone('ок')
        return { cancel: () => {} }
      }
    },
    last: () => last
  }
}

/** Реестр «машина всегда онлайн» — чтобы ход пошёл по удалённой ветке. */
const onlineAgents = {
  isOnline: () => true,
  nameOf: () => 'Ноутбук',
  policyOf: () => DEFAULT_AGENT_POLICY
}

async function runTurn(client: LlmClient, db: VoiceChatDb, conversationId: string): Promise<void> {
  const turns = createTurnManager({
    db,
    claude: client,
    agents: onlineAgents,
    mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret'
  })
  await new Promise<void>((resolve) => {
    const off = turns.subscribe((m) => {
      if (m.t === 'claude.done' || m.t === 'claude.error') {
        off()
        resolve()
      }
    })
    turns.start({ userId: U, conversationId, segments: [{ speakerId: 1, text: 'привет' }] })
  })
}

describe('turns: рабочий каталог разговора принадлежит машине, а не серверу', () => {
  // Регрессия: `conversations.workdir` выбирается через проводник МАШИНЫ — это
  // путь на её хосте. Подставленный спавну claude в контейнере, он роняет chdir
  // ещё до запуска CLI («spawn claude EACCES» на /root, ENOENT на чужом пути),
  // то есть ломает вообще любой ход, где каталог задан.
  it('workdir машины не уходит в cwd локального CLI', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const agent = db.createAgent(U, 'Ноутбук')
    db.setConversationExecTarget(U, conv.id, agent.id, '/root/dir-on-machine')

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.remote).toBeDefined() // ход действительно пошёл на машину
    expect(rec.last()?.cwd).toBeUndefined()
    db.close()
  })

  it('каталог машины уходит в MCP-мост — там `cd` делается на агенте', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const agent = db.createAgent(U, 'Ноутбук')
    db.setConversationExecTarget(U, conv.id, agent.id, '/root/dir-on-machine')

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.remote?.mcpUrl).toContain(`cwd=${encodeURIComponent('/root/dir-on-machine')}`)
    db.close()
  })
})

describe('turns: движок и модель разговора приоритетнее общих настроек', () => {
  function managers(db: VoiceChatDb) {
    const claude = recorder()
    const codex = recorder()
    const turns = createTurnManager({ db, claude: claude.client, codex: codex.client })
    const run = (conversationId: string): Promise<void> =>
      new Promise((resolve) => {
        const off = turns.subscribe((m) => {
          if (m.t === 'claude.done' || m.t === 'claude.error') {
            off()
            resolve()
          }
        })
        turns.start({ userId: U, conversationId, segments: [{ speakerId: 1, text: 'привет' }] })
      })
    return { claude, codex, run }
  }

  it('разговор с llmProvider=codex идёт в codex со своей моделью при общих настройках claude', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    db.setConversationExecTarget(U, conv.id, null, undefined, undefined, 'codex', 'gpt-5-codex')

    const { claude, codex, run } = managers(db)
    await run(conv.id)

    expect(claude.last()).toBeNull()
    expect(codex.last()?.model).toBe('gpt-5-codex')
    db.close()
  })

  it('модель claude разговора переопределяет модель из настроек', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    db.setConversationExecTarget(U, conv.id, null, undefined, undefined, 'claude', 'haiku')

    const { claude, run } = managers(db)
    await run(conv.id)

    expect(claude.last()?.model).toBe('haiku')
    db.close()
  })

  it('без переопределения действуют общие настройки (модель из settings)', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')

    const { claude, codex, run } = managers(db)
    await run(conv.id)

    expect(codex.last()).toBeNull()
    expect(claude.last()?.model).toBe('opus')
    db.close()
  })
})
