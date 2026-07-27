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

describe('turns: остановка сервера (flushInterrupted)', () => {
  /** Мок «зависшего» хода: стримит активность и начало ответа, done не зовёт. */
  function hanging(): { client: LlmClient; cancelled: () => boolean } {
    let cancelled = false
    return {
      client: {
        send(_req, h) {
          h.onActivity?.({ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' })
          h.onDelta('Начало отве')
          return {
            cancel: () => {
              cancelled = true
            }
          }
        }
      },
      cancelled: () => cancelled
    }
  }

  it('частичный текст сохраняется в БД с пометкой interrupted и активностью', () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const { client, cancelled } = hanging()
    const turns = createTurnManager({ db, claude: client })
    turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })

    // Снапшот активного хода отдаёт активность — счётчик действий переживает reconnect.
    expect(turns.active(U)[0]?.activity).toHaveLength(1)

    turns.flushInterrupted()
    expect(cancelled()).toBe(true)
    expect(turns.active(U)).toHaveLength(0)
    const ai = db.listMessages(U, conv.id).find((m) => m.role === 'ai')
    expect(ai?.text).toBe('Начало отве')
    expect(ai?.meta?.interrupted).toBe(true)
    expect(ai?.meta?.activity).toHaveLength(1)
    db.close()
  })

  it('ход без набранного текста не оставляет сообщения', () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const client: LlmClient = { send: () => ({ cancel: () => {} }) }
    const turns = createTurnManager({ db, claude: client })
    turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })
    turns.flushInterrupted()
    expect(db.listMessages(U, conv.id).some((m) => m.role === 'ai')).toBe(false)
    db.close()
  })
})

describe('turns: автоматический контекст базы знаний', () => {
  const bundle = {
    query: 'как устроены ходы', confidence: 'high' as const, autoInjectAllowed: true,
    sections: [{ documentId:'project-knowledge-base',chunkId:'project-knowledge-base#flow',title:'База знаний проекта',heading:'Поток поиска',excerpt:'Сначала exact и BM25.',score:12,matchTypes:['symbol' as const],explanation:'Точное совпадение символа',freshness:'current' as const,sourcePath:'docs/kb/features/project-knowledge-base.md',anchor:'flow',symbols:[],relatedFiles:[] }],
    relatedFiles:[], relatedDocuments:['project-knowledge-base'], staleWarnings:[], estimatedTokens:20
  }
  const kb = { status: () => ({ available:true,mode:'source' as const,searchMode:'lexical' as const,version:'x',createdAt:'now',documents:1,chunks:1,staleDocuments:0 }), topics: () => [], document: () => null, search: async () => [], context: async () => bundle }

  it('режим auto добавляет только high-confidence bundle в промпт', async () => {
    const db = new VoiceChatDb(':memory:'); db.createUser(U,'','admin'); const conv=db.createConversation(U,'Чат'); const rec=recorder(); const turns=createTurnManager({db,claude:rec.client,kb})
    await turns.start({userId:U,conversationId:conv.id,segments:[{speakerId:1,text:'как устроены ходы'}]})
    expect(rec.last()?.prompt).toContain('Контекст базы знаний voiceAIChat')
    expect(rec.last()?.prompt).toContain('Сначала exact и BM25.')
    db.close()
  })

  it('режим off не вызывает KB и не меняет промпт', async () => {
    const db = new VoiceChatDb(':memory:'); db.createUser(U,'','admin'); const conv=db.createConversation(U,'Чат'); db.setConversationKbContextMode(U,conv.id,'off'); let calls=0; const offKb={...kb,context:async()=>{calls++;return bundle}}; const rec=recorder(); const turns=createTurnManager({db,claude:rec.client,kb:offKb})
    await turns.start({userId:U,conversationId:conv.id,segments:[{speakerId:1,text:'как устроены ходы'}]})
    expect(calls).toBe(0); expect(rec.last()?.prompt).not.toContain('Контекст базы знаний voiceAIChat')
    db.close()
  })
})

describe('turns: контекст проекта в промпте', () => {
  it('привязанный к проекту чат получает блок «Контекст проекта» с git/технологиями', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const p = db.createProject(U, { name: 'Мой проект', gitUrl: 'git@x:repo.git', technologies: ['ts', 'sqlite'] })
    const conv = db.createConversation(U, 'Чат')
    db.setConversationProject(U, conv.id, p.id)
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    const prompt = rec.last()!.prompt
    expect(prompt).toContain('Контекст проекта «Мой проект»')
    expect(prompt).toContain('git@x:repo.git')
    expect(prompt).toContain('ts, sqlite')
  })

  it('чат без проекта не получает блок проекта', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()!.prompt).not.toContain('Контекст проекта')
  })
})

describe('turns: чередование действий (смещение at)', () => {
  /** Мок стрима: «Привет » → действие → «мир», затем done с заданным текстом. */
  function streamer(finalText: string): LlmClient {
    return {
      send(_req, h) {
        h.onDelta('Привет ')
        h.onActivity?.({ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' })
        h.onDelta('мир')
        h.onDone(finalText)
        return { cancel: () => {} }
      }
    }
  }

  async function run(client: LlmClient, db: VoiceChatDb, conversationId: string): Promise<void> {
    const turns = createTurnManager({ db, claude: client })
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

  it('onActivity проставляет at = длине уже накопленного текста', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    // Пустой финальный текст → сервер берёт partial, смещения валидны.
    await run(streamer(''), db, conv.id)
    const ai = db.listMessages(U, conv.id).find((m) => m.role === 'ai')
    expect(ai?.text).toBe('Привет мир')
    expect(ai?.meta?.activity?.[0]?.at).toBe('Привет '.length)
    expect(typeof ai?.meta?.activity?.[0]?.ts).toBe('number')
    db.close()
  })

  it('финальный текст ≠ накопленному снимает at (fallback)', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    await run(streamer('Совсем другой итоговый текст'), db, conv.id)
    const ai = db.listMessages(U, conv.id).find((m) => m.role === 'ai')
    expect(ai?.text).toBe('Совсем другой итоговый текст')
    expect(ai?.meta?.activity?.[0]?.at).toBeUndefined()
    // ts не привязан к тексту и остаётся (для длительностей в кратком виде).
    expect(typeof ai?.meta?.activity?.[0]?.ts).toBe('number')
    db.close()
  })
})
