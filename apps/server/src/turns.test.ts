import { describe, it, expect } from 'vitest'
import { createTurnManager } from './turns.js'
import { VoiceChatDb } from './db/database.js'
import { DEFAULT_AGENT_POLICY, imageBlock } from '@voicechat/shared'
import type { LlmClient, LlmRequest } from './claude/types.js'
import { createKbUsageTracker } from './kb/usage.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** БД с пользователем-владельцем: телеметрия БЗ пишется на его чаты. */
function freshDb(): VoiceChatDb {
  const db = new VoiceChatDb(':memory:')
  db.createUser(U, '', 'admin')
  return db
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

  it('завершённый ход сохраняется при остановке сервера, пока перекладка картинок в полёте', async () => {
    // Регрессия: модель ЗАВЕРШИЛА ответ (onDone), но запись в БД идёт после
    // перекладки картинок на машину — сетевого шага. В этом окне ход уже убран
    // из активных, поэтому прежде flushInterrupted его не находил и последнее
    // сообщение пропадало насовсем при пересборке контейнера.
    const dir = mkdtempSync(join(tmpdir(), 'vc-relocate-'))
    const imgPath = join(dir, 'pic.png')
    writeFileSync(imgPath, Buffer.from('89504e470d0a1a0a', 'hex')) // PNG-заголовок
    const answer = `Готово.\n\n${imageBlock({ path: imgPath })}`

    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const agent = db.createAgent(U, 'Ноутбук')
    db.setConversationExecTarget(U, conv.id, agent.id)

    // Движок сразу отдаёт готовый ответ с картинкой.
    const client: LlmClient = {
      send: (_r, h) => {
        h.onDone(answer)
        return { cancel: () => {} }
      }
    }
    const turns = createTurnManager({
      db,
      claude: client,
      agents: {
        ...onlineAgents,
        fsList: () => new Promise(() => {}), // машина «зависла» — перекладка не завершается
        fsMkdir: async () => ({}),
        fsWrite: async () => ({})
      },
      serverFileRoots: () => [dir],
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret'
    })

    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'нарисуй' }] })

    // Ход уже не активен, но в БД его ещё нет (сохранение висит на перекладке).
    expect(turns.active(U)).toHaveLength(0)
    expect(db.listMessages(U, conv.id).some((m) => m.role === 'ai')).toBe(false)

    // Остановка сервера: аварийно сохраняем готовый ответ целиком, без interrupted.
    turns.flushInterrupted()
    const ai = db.listMessages(U, conv.id).find((m) => m.role === 'ai')
    expect(ai?.text).toBe(answer)
    expect(ai?.meta?.interrupted).toBeUndefined()

    rmSync(dir, { recursive: true, force: true })
    db.close()
  })
})

describe('turns: автоматический контекст базы знаний', () => {
  const bundle = {
    query: 'как устроены ходы', confidence: 'high' as const, autoInjectAllowed: true,
    sections: [{ documentId:'project-knowledge-base',chunkId:'project-knowledge-base#flow',title:'База знаний проекта',heading:'Поток поиска',excerpt:'Сначала exact и BM25.',text:'Сначала exact и BM25.',score:12,matchTypes:['symbol' as const],explanation:'Точное совпадение символа',freshness:'current' as const,sourcePath:'docs/kb/features/project-knowledge-base.md',anchor:'flow',symbols:[],relatedFiles:[] }],
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

  it('символы обращения совпадают с реально дописанным в промпт текстом', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder()
    const usage = createKbUsageTracker({ db })
    const turns = createTurnManager({ db, claude: rec.client, kb, kbUsage: usage })
    const before = rec.last()
    expect(before).toBeNull()
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    const report = db.kbUsageReport(U, conv.id)!
    expect(report.recent).toHaveLength(1)
    const q = report.recent[0]
    expect(q).toMatchObject({ source: 'auto', status: 'delivered', injected: true, confidence: 'high', sectionsCount: 1 })
    // Ровно длина блока «## Контекст базы знаний …» — его и увидела модель
    // (дальше в промпте идут хинты формата, они к БЗ не относятся).
    const prompt = rec.last()!.prompt
    const block = prompt.slice(prompt.indexOf('\n\n## Контекст базы знаний voiceAIChat'), prompt.indexOf('\n\n## Контекст базы знаний voiceAIChat') + q.chars)
    expect(block).toContain('Сначала exact и BM25.')
    expect(block.endsWith('Сначала exact и BM25.')).toBe(true)
    expect(q.sections[0]).toMatchObject({ documentId: 'project-knowledge-base', anchor: 'flow' })
    // Итоги хода дописаны: панель показывает долю БЗ в промпте.
    expect(q.promptChars).toBeGreaterThan(q.chars)
    expect(q.messageId).not.toBeNull()
    db.close()
  })

  it('низкая уверенность bundle → обращение записано как empty, промпт не тронут', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder()
    const weak = { ...kb, context: async () => ({ ...bundle, confidence: 'medium' as const, autoInjectAllowed: false }) }
    const turns = createTurnManager({ db, claude: rec.client, kb: weak, kbUsage: createKbUsageTracker({ db }) })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(rec.last()?.prompt).not.toContain('Контекст базы знаний voiceAIChat')
    expect(db.kbUsageReport(U, conv.id)!.recent[0]).toMatchObject({ status: 'empty', chars: 0 })
    db.close()
  })

  it('падение kb.context не ломает ход: ответ сохранён, обращение помечено error', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder()
    const broken = { ...kb, context: async () => { throw new Error('индекс недоступен') } }
    const turns = createTurnManager({ db, claude: rec.client, kb: broken, kbUsage: createKbUsageTracker({ db }) })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    // Ход завершён и ответ модели лежит в БД — БЗ его не уронила.
    expect(db.listMessages(U, conv.id).some((m) => m.role === 'ai' && m.text === 'ок')).toBe(true)
    expect(db.kbUsageReport(U, conv.id)!.recent[0]).toMatchObject({ status: 'error', error: 'индекс недоступен' })
    db.close()
  })
})

describe('turns: MCP-инструменты базы знаний и режимы kbContextMode', () => {
  const bundle = {
    query: 'как устроены ходы', confidence: 'high' as const, autoInjectAllowed: true,
    sections: [{ documentId:'project-knowledge-base',chunkId:'project-knowledge-base#flow',title:'База знаний проекта',heading:'Поток поиска',excerpt:'Сначала exact и BM25.',text:'Сначала exact и BM25.',score:12,matchTypes:['symbol' as const],explanation:'Точное совпадение символа',freshness:'current' as const,sourcePath:'docs/kb/features/project-knowledge-base.md',anchor:'flow',symbols:[],relatedFiles:[] }],
    relatedFiles:[], relatedDocuments:['project-knowledge-base'], staleWarnings:[], estimatedTokens:20
  }
  const kb = { status: () => ({ available:true,mode:'source' as const,searchMode:'lexical' as const,version:'x',createdAt:'now',documents:1,chunks:1,staleDocuments:0 }), topics: () => [], document: () => null, search: async () => [], context: async () => bundle }
  const KB_MCP = 'http://127.0.0.1:8787/mcp/kb?k=secret'

  /** Брокер токенов хода: следим за выдачей и — важнее — за освобождением. */
  function broker(): { register: (t: string, e: unknown) => void; unregister: (t: string) => void; live: () => string[] } {
    const live = new Set<string>()
    return { register: (t) => live.add(t), unregister: (t) => live.delete(t), live: () => [...live] }
  }

  it('auto: инструмент подключён и без машины, режим хинта — auto', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder(); const tool = broker()
    const turns = createTurnManager({ db, claude: rec.client, kb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: true, kbTool: tool })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(rec.last()?.remote).toBeUndefined() // машины нет — а инструмент БЗ есть
    expect(rec.last()?.kbMcpUrl).toContain('/mcp/kb?k=secret&turn=')
    expect(rec.last()?.kbMode).toBe('auto')
    expect(rec.last()?.prompt).toContain('Контекст базы знаний voiceAIChat')
    expect(tool.live()).toEqual([]) // ход завершился — токен снят
    db.close()
  })

  it('manual: авто-инъекции нет, инструмент есть, хинт усиленный', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); db.setConversationKbContextMode(U, conv.id, 'manual')
    let contextCalls = 0
    const manualKb = { ...kb, context: async () => { contextCalls++; return bundle } }
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, kb: manualKb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: true, kbTool: broker(), kbUsage: createKbUsageTracker({ db }) })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(contextCalls).toBe(0)
    expect(rec.last()?.prompt).not.toContain('Контекст базы знаний voiceAIChat')
    expect(rec.last()?.kbMcpUrl).toBeDefined()
    expect(rec.last()?.kbMode).toBe('manual')
    // Обращений нет: их создаёт сама модель через mcp__kb__*, а не сервер.
    expect(db.kbUsageReport(U, conv.id)!.totals.queries).toBe(0)
    db.close()
  })

  it('manual + VC_KB_TOOL=off вырождается в off: ни инъекции, ни инструмента', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); db.setConversationKbContextMode(U, conv.id, 'manual')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, kb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: false, kbTool: broker() })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(rec.last()?.kbMcpUrl).toBeUndefined()
    expect(rec.last()?.prompt).not.toContain('Контекст базы знаний voiceAIChat')
    db.close()
  })

  it('off: инструмент не подключается', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); db.setConversationKbContextMode(U, conv.id, 'off')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, kb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: true, kbTool: broker() })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(rec.last()?.kbMcpUrl).toBeUndefined()
    db.close()
  })

  it('недоступный индекс БЗ не даёт подключить инструмент', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder()
    const emptyKb = { ...kb, status: () => ({ ...kb.status(), available: false, documents: 0, chunks: 0 }) }
    const turns = createTurnManager({ db, claude: rec.client, kb: emptyKb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: true, kbTool: broker() })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(rec.last()?.kbMcpUrl).toBeUndefined()
    db.close()
  })

  it('отмена хода освобождает токен инструмента (иначе утечка на каждый cancel)', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const tool = broker()
    // Движок, который держит ход открытым: отмену делаем сами.
    const client = { send: () => ({ cancel: () => {} }) }
    const turns = createTurnManager({ db, claude: client, kb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: true, kbTool: tool })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(tool.live()).toHaveLength(1)
    turns.cancel(conv.id)
    expect(tool.live()).toEqual([])
    db.close()
  })

  it('остановка сервера тоже освобождает токен', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const tool = broker()
    const client = { send: (_req: LlmRequest, h: Parameters<LlmClient['send']>[1]) => { h.onDelta('часть'); return { cancel: () => {} } } }
    const turns = createTurnManager({ db, claude: client, kb, kbMcpBaseUrl: KB_MCP, kbToolEnabled: true, kbTool: tool })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'как устроены ходы' }] })
    expect(tool.live()).toHaveLength(1)
    turns.flushInterrupted()
    expect(tool.live()).toEqual([])
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
