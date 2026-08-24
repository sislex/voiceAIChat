import { describe, it, expect } from 'vitest'
import { createTurnManager, ProjectMainSnapshotCoordinator } from './turns.js'
import { VoiceChatDb } from './db/database.js'
import { DEFAULT_AGENT_POLICY, imageBlock } from '@voicechat/shared'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from './claude/types.js'
import { createKbUsageTracker } from './kb/usage.js'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { buildPublicMcpUrl } from './mcp/publicBase.js'
import { REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { KB_MCP_PATH } from './kb/kbMcp.js'

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

describe('turns: канбан-ассистент', () => {
  it('инъектирует безопасный контекст виджета в обычный LLM-ход, но не в историю', async () => {
    const db = freshDb()
    const project = db.createProject(U, { name: 'Board' })
    const conv = db.ensureKanbanAssistantConversation(U, project.id)!
    db.addMessage(U, conv.id, 'u0', 'Что делать?', '10:00')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => { if (message.t === 'claude.done') { off(); resolve() } })
      void turns.start({
        userId: U,
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'Что делать?' }],
        assistantContext: { version: 1, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: { id: project.id, name: 'Board', description: '', technologies: [], skills: [] }, selection: null, recentActions: [] }
      })
    })
    expect(rec.last()?.prompt).toContain('## Режим канбан-ассистента')
    expect(rec.last()?.prompt).toContain('"kind":"kanban"')
    expect(db.listMessages(U, conv.id)[0]?.text).toBe('Что делать?')
    db.close()
  })
})

describe('turns: персонализация', () => {
  it('добавляет короткие предпочтения и возраст, но не полную дату рождения', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.saveSettings(U, { ...db.getSettings(U), personalization: { preferredName: 'Лёша', birthDay: 12, birthMonth: 4, birthYear: 1990, responseLanguage: 'ru', responseStyle: 'brief', tone: 'friendly' } })
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).toContain('## Персонализация пользователя')
    expect(rec.last()?.prompt).toContain('Обращение к пользователю: Лёша')
    expect(rec.last()?.prompt).toContain('явная просьба в текущем сообщении имеет приоритет')
    expect(rec.last()?.prompt).toContain('Возраст пользователя:')
    expect(rec.last()?.prompt).not.toContain('12.04.1990')
    db.close()
  })

  it('одинаково передаёт персонализацию клиенту Codex', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.saveSettings(U, { ...db.getSettings(U), llmProvider: 'codex', personalization: { ...db.getSettings(U).personalization, tone: 'business' } })
    const claude = recorder()
    const codex = recorder()
    const turns = createTurnManager({ db, claude: claude.client, codex: codex.client })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => { if (m.t === 'claude.done') { off(); resolve() } })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })
    })
    expect(codex.last()?.prompt).toContain('Тон общения: деловой')
    expect(claude.last()).toBeNull()
    db.close()
  })
})

describe('turns: рабочий каталог разговора принадлежит машине, а не серверу', () => {
  it('серверный settings.workdir уходит исполнителю как желаемый cwd без локальной проверки', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    db.saveSettings(U, { ...db.getSettings(U), workdir: '/definitely/missing/workdir' })

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.cwd).toBe('/definitely/missing/workdir')
    db.close()
  })

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

  it('план с машиной запускает CLI вне native plan, а remote-мост — только для чтения', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const agent = db.createAgent(U, 'Ноутбук')
    db.setConversationExecTarget(U, conv.id, agent.id, '/root/dir-on-machine')
    db.saveSettings(U, { ...db.getSettings(U), permissionMode: 'plan' })

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.permissionMode).toBe('default')
    expect(rec.last()?.readOnlyRemote).toBe(true)
    expect(rec.last()?.remote?.mcpUrl).toContain('&ro=1')
    db.close()
  })
})

describe('turns: наследование персональной машины чата', () => {
  it('offline default проектного чата заменяет первой доступной online-машиной', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    const offline = db.createAgent(U, 'Offline')
    const fallback = db.createAgent(U, 'Fallback')
    const project = db.createProject(U, { name: 'P' })
    db.linkMachine(U, project.id, offline.id)
    db.linkMachine(U, project.id, fallback.id)
    db.setConversationProject(U, conv.id, project.id)
    db.setUserProjectDefaultMachine(U, project.id, offline.id)
    expect(db.getConversation(U, conv.id)?.execTarget).toBeNull()

    const rec = recorder()
    const turns = createTurnManager({
      db,
      claude: rec.client,
      agents: {
        isOnline: (id) => id === fallback.id,
        nameOf: (id) => id === fallback.id ? 'Fallback' : 'Offline',
        policyOf: () => DEFAULT_AGENT_POLICY
      },
      mcpBaseUrl: 'http://127.0.0.1/mcp'
    })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => {
        if (message.t === 'claude.done' || message.t === 'claude.error') { off(); resolve() }
      })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })
    })

    expect(rec.last()?.remote?.mcpUrl).toContain(`agent=${fallback.id}`)
    expect(db.getConversation(U, conv.id)?.execTarget).toBeNull()
    db.close()
  })
})

describe('turns: машины проекта в remote MCP', () => {
  it('чат проекта несёт project в mcpUrl и имена других машин для хинта', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    const mac = db.createAgent(U, 'Мак')
    const srv = db.createAgent(U, 'Сервер')
    const project = db.createProject(U, { name: 'P' })
    db.linkMachine(U, project.id, mac.id)
    db.linkMachine(U, project.id, srv.id)
    db.setProjectMachinePath(U, project.id, srv.id, '/srv/proj')
    db.setConversationProject(U, conv.id, project.id)
    db.setConversationExecTarget(U, conv.id, mac.id, '/Users/dev/proj')

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.remote?.mcpUrl).toContain(`&project=${encodeURIComponent(project.id)}`)
    expect(rec.last()?.remote?.projectMachines).toEqual(['Сервер'])
    db.close()
  })

  it('чат без проекта — прежний mcpUrl без project и списка машин', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    const agent = db.createAgent(U, 'Ноутбук')
    db.setConversationExecTarget(U, conv.id, agent.id, '/root/dir-on-machine')

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.remote?.mcpUrl).not.toContain('&project=')
    expect(rec.last()?.remote?.projectMachines).toBeUndefined()
    db.close()
  })

  it('единственная машина проекта не включает адресацию: project и список не передаются', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    const mac = db.createAgent(U, 'Мак')
    const project = db.createProject(U, { name: 'P' })
    db.linkMachine(U, project.id, mac.id)
    db.setConversationProject(U, conv.id, project.id)
    db.setConversationExecTarget(U, conv.id, mac.id, '/Users/dev/proj')

    const rec = recorder()
    await runTurn(rec.client, db, conv.id)

    expect(rec.last()?.remote?.mcpUrl).not.toContain('&project=')
    expect(rec.last()?.remote?.projectMachines).toBeUndefined()
    db.close()
  })
})

describe('turns: VC_MCP_PUBLIC_BASE', () => {
  it('remote mcpUrl и kbMcpUrl строятся от публичной базы, секрет сохраняется', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    const agent = db.createAgent(U, 'Ноутбук')
    db.setConversationExecTarget(U, conv.id, agent.id, '/root/dir-on-machine')
    db.setConversationKbContextMode(U, conv.id, 'manual')
    const kb = {
      status: () => ({
        available: true,
        mode: 'source' as const,
        searchMode: 'lexical' as const,
        version: 'x',
        createdAt: 'now',
        documents: 1,
        chunks: 1,
        staleDocuments: 0
      }),
      topics: () => [],
      document: () => null,
      search: async () => [],
      context: async () => ({
        query: 'q',
        confidence: 'high' as const,
        autoInjectAllowed: true,
        sections: [],
        relatedFiles: [],
        relatedDocuments: [],
        staleWarnings: [],
        estimatedTokens: 0
      })
    }

    const config = loadConfig({ PORT: '8787', VC_MCP_PUBLIC_BASE: 'http://voicechat:8787' })
    const rec = recorder()
    const turns = createTurnManager({
      db,
      claude: rec.client,
      kb,
      kbToolEnabled: true,
      agents: onlineAgents,
      mcpBaseUrl: buildPublicMcpUrl(config, REMOTE_BASH_MCP_PATH, 'secret'),
      kbMcpBaseUrl: buildPublicMcpUrl(config, KB_MCP_PATH, 'secret')
    })

    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => {
        if (m.t === 'claude.done' || m.t === 'claude.error') {
          off()
          resolve()
        }
      })
      turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })
    })

    expect(rec.last()?.remote?.mcpUrl).toContain('http://voicechat:8787/mcp/remote-bash?k=secret')
    expect(rec.last()?.kbMcpUrl).toContain('http://voicechat:8787/mcp/kb?k=secret&turn=')
    db.close()
  })
})

describe('turns: вложения для удалённого исполнителя', () => {
  it('передаёт вложение байтами вместе с исходным serverPath', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const dir = mkdtempSync(join(tmpdir(), 'vc-attachment-'))
    const file = join(dir, 'report.txt')
    writeFileSync(file, 'attachment-body')

    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, resolveUpload: () => file })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'прочитай' }], attachments: ['a1'] })

    expect(rec.last()?.prompt).toContain(file)
    expect(rec.last()?.attachments).toEqual([
      {
        serverPath: file,
        runnerName: 'report.txt',
        dataBase64: Buffer.from('attachment-body').toString('base64')
      }
    ])

    rmSync(dir, { recursive: true, force: true })
    db.close()
  })

  it('принимает уже прочитанное с пользовательской машины вложение', async () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser(U, '', 'admin')
    const conv = db.createConversation(U, 'Чат')
    const remote = {
      serverPath: '/home/user/.voicechat_uploads/photo.png',
      runnerName: 'photo.png',
      dataBase64: Buffer.from('remote-image').toString('base64'),
      preserveServerPath: true
    }
    const agent = db.createAgent(U, 'Windows test')
    db.setConversationExecTarget(U, conv.id, agent.id, 'C:\\repos\\task')
    const registered: Array<{ path: string; name: string; dataBase64: string }> = []
    const rec = recorder()
    const turns = createTurnManager({
      db,
      claude: rec.client,
      resolveUpload: async () => remote,
      agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1/mcp?k=test',
      remoteFileTool: { register: (_token, files) => registered.push(...files), unregister: () => {} }
    })

    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'измени фото' }], attachments: ['a1'] })

    expect(rec.last()?.prompt).toContain(remote.serverPath)
    expect(rec.last()?.attachments).toEqual([remote])
    expect(rec.last()?.remote?.mcpUrl).toMatch(/agent=.*&files=/)
    expect(registered).toEqual([{ path: remote.serverPath, name: remote.runnerName, dataBase64: remote.dataBase64 }])
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
    expect(claude.last()?.model).toBe('default')
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
      readServerFile: async (userId, path) => path.startsWith(dir) ? { name: 'pic.png', dataBase64: readFileSync(path).toString('base64') } : null,
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

describe('turns: MCP-инструменты веб-превью (mcp__browser__*)', () => {
  const PREVIEW_MCP = 'http://127.0.0.1:8787/mcp/preview?k=secret'

  function broker(): { register: (t: string, e: { userId: string; conversationId: string }) => void; unregister: (t: string) => void; live: () => string[]; entries: Array<{ userId: string; conversationId: string }> } {
    const live = new Set<string>()
    const entries: Array<{ userId: string; conversationId: string }> = []
    return {
      register: (t, e) => { live.add(t); entries.push(e) },
      unregister: (t) => live.delete(t),
      live: () => [...live],
      entries
    }
  }

  it('ход разговора получает previewMcpUrl, токен привязан к чату и снят после завершения', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder(); const tool = broker()
    const turns = createTurnManager({ db, claude: rec.client, previewMcpBaseUrl: PREVIEW_MCP, previewTool: tool })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'открой сайт' }] })
    expect(rec.last()?.previewMcpUrl).toContain('/mcp/preview?k=secret&turn=')
    expect(tool.entries).toEqual([{ userId: U, conversationId: conv.id }])
    expect(tool.live()).toEqual([]) // ход завершился — токен снят
    db.close()
  })

  it('без previewMcpBaseUrl инструменты превью не подключаются', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, previewTool: broker() })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'открой сайт' }] })
    expect(rec.last()?.previewMcpUrl).toBeUndefined()
    db.close()
  })

  it('отмена хода освобождает токен превью (иначе утечка на каждый cancel)', async () => {
    const db = freshDb(); const conv = db.createConversation(U, 'Чат'); const tool = broker()
    const client = { send: () => ({ cancel: () => {} }) }
    const turns = createTurnManager({ db, claude: client, previewMcpBaseUrl: PREVIEW_MCP, previewTool: tool })
    await turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'открой сайт' }] })
    expect(tool.live()).toHaveLength(1)
    turns.cancel(conv.id)
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

describe('turns: управляемая персистентная очередь', () => {
  function controlled() {
    const handlers: LlmStreamHandlers[] = []
    const requests: Parameters<LlmClient['send']>[0][] = []
    let cancels = 0
    const client: LlmClient = {
      send(req, next) {
        requests.push(req)
        handlers.push(next)
        return { cancel: () => { cancels += 1 } }
      }
    }
    return { client, handlers, requests, cancels: () => cancels }
  }

  it('Stop завершает CLI, сохраняет partial и однократно продвигает очередь', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const activeMessage = db.addMessage(U, conversation.id, 'u1', 'Активный', '10:00')
    const queuedMessage = db.addMessage(U, conversation.id, 'u1', 'Следующий', '10:01')
    const llm = controlled()
    const turns = createTurnManager({ db, claude: llm.client })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: activeMessage.id, segments: [{ speakerId: 1, text: 'Активный' }] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: queuedMessage.id, segments: [{ speakerId: 1, text: 'Следующий' }] })
    llm.handlers[0].onDelta('Часть ответа')
    turns.cancel(conversation.id)
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(llm.cancels()).toBe(1)
    expect(llm.handlers).toHaveLength(2)
    expect(db.listMessages(U, conversation.id).find((message) => message.role === 'ai' && message.meta?.interrupted)).toMatchObject({ role: 'ai', text: 'Часть ответа', meta: { interrupted: true } })
    expect(db.isTurnQueuePaused(U, conversation.id)).toBe(false)
    expect(db.listQueuedTurns(U, conversation.id)).toEqual([])
    expect(db.listMessages(U, conversation.id).at(-1)).toMatchObject({ id: queuedMessage.id, text: 'Следующий' })
    llm.handlers[0].onDelta(' поздний токен')
    expect(db.listMessages(U, conversation.id).find((message) => message.role === 'ai' && message.meta?.interrupted)?.text).toBe('Часть ответа')
    db.close()
  })

  it('два одновременных start дают один CLI-ход и один элемент очереди', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const first = db.addMessage(U, conversation.id, 'u1', 'Первый', '10:00')
    const second = db.addMessage(U, conversation.id, 'u1', 'Второй', '10:01')
    const llm = controlled()
    const turns = createTurnManager({ db, claude: llm.client })
    await Promise.all([
      turns.start({ userId: U, conversationId: conversation.id, messageId: first.id, segments: [{ speakerId: 1, text: 'Первый' }] }),
      turns.start({ userId: U, conversationId: conversation.id, messageId: second.id, segments: [{ speakerId: 1, text: 'Второй' }] }),
      turns.start({ userId: U, conversationId: conversation.id, messageId: second.id, segments: [{ speakerId: 1, text: 'Второй' }] })
    ])
    expect(llm.handlers).toHaveLength(1)
    expect(db.listQueuedTurns(U, conversation.id)).toHaveLength(1)
    expect(db.listMessages(U, conversation.id).map((message) => message.text)).toEqual(['Первый'])

    llm.handlers[0].onDone('Ответ 1')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(llm.handlers).toHaveLength(2)
    expect(db.listMessages(U, conversation.id).map((message) => message.text)).toEqual(['Первый', 'Ответ 1', 'Второй'])
    expect(db.listMessages(U, conversation.id)[2]?.id).toBe(second.id)
    db.close()
  })

  it('Отправить сейчас отменяет partial и перезапускает один объединённый запрос', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const active = db.addMessage(U, conversation.id, 'u1', 'Базовый вопрос', '10:00')
    const first = db.addMessage(U, conversation.id, 'u1', 'Первый ожидающий', '10:01')
    const priority = db.addMessage(U, conversation.id, 'u1', 'Приоритетный', '10:02')
    const llm = controlled()
    const turns = createTurnManager({
      db,
      claude: llm.client,
      resolveUpload: (id) => ({ serverPath: `/uploads/${id}`, runnerName: id, dataBase64: 'eA==' })
    })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: active.id, segments: [{ speakerId: 1, text: active.text }], attachments: ['base-file'] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: first.id, segments: [{ speakerId: 1, text: first.text }] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: priority.id, segments: [{ speakerId: 1, text: priority.text }], attachments: ['image-1'] })
    llm.handlers[0].onDelta('Старый partial')
    const selected = db.listQueuedTurns(U, conversation.id)[1]
    turns.sendQueuedNow(U, conversation.id, selected.id)
    turns.sendQueuedNow(U, conversation.id, selected.id)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(llm.cancels()).toBe(1)
    expect(llm.handlers).toHaveLength(2)
    expect(db.listQueuedTurns(U, conversation.id).map((item) => item.messageId)).toEqual([first.id])
    expect(db.listMessages(U, conversation.id).map((message) => [message.id, message.text])).toEqual([
      [active.id, 'Базовый вопрос\n\nПриоритетный']
    ])
    expect(llm.requests[1]?.prompt).toContain('Базовый вопрос')
    expect(llm.requests[1]?.prompt).toContain('Приоритетный')
    expect(llm.requests[1]?.attachments?.map((item) => item.runnerName)).toEqual(['base-file', 'image-1'])
    expect(db.getConversation(U, conversation.id)?.claudeSessionId).toBeNull()
    db.close()
  })

  it('Отправить сейчас запускает выбранный элемент, если активного хода уже нет', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const queued = db.addMessage(U, conversation.id, 'u1', 'Ожидающий вопрос', '10:00')
    db.enqueueTurn(U, conversation.id, queued.id, {
      segments: [{ speakerId: 1, text: queued.text }]
    })
    const llm = controlled()
    const turns = createTurnManager({ db, claude: llm.client })
    const item = db.listQueuedTurns(U, conversation.id)[0]

    turns.sendQueuedNow(U, conversation.id, item.id)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(llm.handlers).toHaveLength(1)
    expect(db.listQueuedTurns(U, conversation.id)).toEqual([])
    expect(db.listMessages(U, conversation.id)).toEqual([
      expect.objectContaining({ id: queued.id, text: 'Ожидающий вопрос' })
    ])
    db.close()
  })
})

describe('ProjectMainSnapshotCoordinator', () => {
  const identity = { projectId: 'p-1', machineId: 'm-1', storageId: 's-1' }
  it('coalesces concurrent refresh and gives parallel readers one pinned SHA', async () => {
    let resolve!: (value: { baseSha: string; path: string }) => void
    let calls = 0
    const manager = new ProjectMainSnapshotCoordinator({ refresh: async () => {
      calls++
      return await new Promise((done) => { resolve = done })
    } })
    const first = manager.acquireReadSnapshot(identity)
    const second = manager.acquireReadSnapshot(identity)
    await Promise.resolve()
    expect(calls).toBe(1)
    resolve({ baseSha: 'a'.repeat(40), path: '/storage/projects/p-1/worktree' })
    const [a, b] = await Promise.all([first, second])
    expect(a.baseSha).toBe(b.baseSha)
    a.release(); b.release()
  })

  it('waits for active readers before refreshing', async () => {
    const shas = ['a'.repeat(40), 'b'.repeat(40)]
    let calls = 0
    const manager = new ProjectMainSnapshotCoordinator({ refresh: async () => ({ baseSha: shas[calls++]!, path: '/worktree' }) })
    const reader = await manager.acquireReadSnapshot(identity)
    let updated = false
    const update = manager.invalidateProjectMain(identity).then((value) => { updated = true; return value })
    await Promise.resolve()
    expect(updated).toBe(false)
    reader.release(); reader.release()
    expect((await update).baseSha).toBe(shas[1])
  })
})
