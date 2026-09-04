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
        assistantContext: { version: 1, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: { id: project.id, name: 'Board', description: '', technologies: [], skills: [], typeChain: project.typeChain }, selection: null, recentActions: [] }
      })
    })
    expect(rec.last()?.prompt).toContain('## Режим канбан-ассистента')
    expect(rec.last()?.prompt).toContain('"kind":"kanban"')
    expect(db.listMessages(U, conv.id)[0]?.text).toBe('Что делать?')
    db.close()
  })

  it('подключает инструменты канбана и приватному чату ассистента, и обычному чату проекта из его панели', async () => {
    const db = freshDb()
    const project = db.createProject(U, { name: 'Board' })
    const contexts: Array<{ conversationId: string; turnId: string }> = []
    const context = { version: 1 as const, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: null, selection: null, recentActions: [] }
    const run = async (conversationId: string): Promise<void> => {
      const rec = recorder()
      const turns = createTurnManager({
        db,
        claude: rec.client,
        kanbanMcpBaseUrl: 'http://127.0.0.1:8787/mcp/kanban?k=secret',
        widgetContexts: { remember: (id, turnId) => { contexts.push({ conversationId: id, turnId }) } }
      })
      await new Promise<void>((resolve) => {
        const off = turns.subscribe((message) => { if (message.t === 'claude.done') { off(); resolve() } })
        void turns.start({ userId: U, conversationId, segments: [{ speakerId: 1, text: 'Что на доске?' }], assistantContext: context })
      })
      expect(rec.last()?.kanbanMcpUrl).toContain(`conv=${conversationId}`)
    }

    const assistantChat = db.ensureKanbanAssistantConversation(U, project.id)!
    await run(assistantChat.id)

    // Обычный чат проекта, выбранный в селекторе панели: его признак — сам факт
    // присланного assistantContext, других отличий от чата сайдбара у него нет.
    const projectChat = db.createConversation(U, 'Обычный чат')
    db.setConversationProject(U, projectChat.id, project.id)
    await run(projectChat.id)

    expect(contexts.map((entry) => entry.conversationId)).toEqual([assistantChat.id, projectChat.id])
    db.close()
  })

  it('канбан-ход без машины: инструменты доски без ro=1, Claude — не в native plan и без встроенных инструментов', async () => {
    const db = freshDb()
    const project = db.createProject(U, { name: 'Board' })
    const conv = db.ensureKanbanAssistantConversation(U, project.id)!
    const context = { version: 1 as const, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: null, selection: null, recentActions: [] }
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, codex: rec.client, kanbanMcpBaseUrl: 'http://127.0.0.1:8787/mcp/kanban?k=secret' })
    const run = async (): Promise<void> => new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => { if (message.t === 'claude.done' || message.t === 'claude.error') { off(); resolve() } })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'Создай задачу' }], assistantContext: context, execTarget: 'none' })
    })
    await run()
    expect(rec.last()?.kanbanMcpUrl).toContain('conv=')
    expect(rec.last()?.kanbanMcpUrl).not.toContain('ro=1')
    expect(rec.last()?.permissionMode).toBe('default')
    expect(rec.last()?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'Read']))

    // Codex остаётся в plan (read-only sandbox), но доска по-прежнему не read-only.
    db.saveSettings(U, { ...db.getSettings(U), llmProvider: 'codex' })
    await run()
    expect(rec.last()?.permissionMode).toBe('plan')
    expect(rec.last()?.kanbanMcpUrl).not.toContain('ro=1')

    // Явный «План» этого разговора — единственное, что делает доску read-only.
    db.setConversationExecTarget(U, conv.id, 'none', undefined, undefined, undefined, undefined, 'plan')
    await run()
    expect(rec.last()?.kanbanMcpUrl).toContain('ro=1')
    db.close()
  })

  it('без базы MCP канбан-ход остаётся в режиме предложений', async () => {
    const db = freshDb()
    const project = db.createProject(U, { name: 'Board' })
    const conv = db.ensureKanbanAssistantConversation(U, project.id)!
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => { if (message.t === 'claude.done') { off(); resolve() } })
      void turns.start({
        userId: U,
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'Что на доске?' }],
        assistantContext: { version: 1, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: null, selection: null, recentActions: [] }
      })
    })
    expect(rec.last()?.kanbanMcpUrl).toBeUndefined()
    expect(rec.last()?.prompt).toContain('propose.task-update')
    db.close()
  })
})

describe('turns: claude.start', () => {
  it('в начале хода сервер сообщает движок, модель и машину', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.addMessage(U, conv.id, 'u0', 'привет', '10:00')
    db.saveSettings(U, { ...db.getSettings(U), llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, codex: rec.client, agents: onlineAgents, mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret' })
    const starts: unknown[] = []
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => {
        if (m.t === 'claude.start') starts.push(m)
        if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() }
      })
      turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })
    })
    expect(starts).toEqual([expect.objectContaining({ t: 'claude.start', conversationId: conv.id, provider: 'codex', model: 'gpt-5.6-sol', execTarget: null })])
    expect(turns.active(U)).toEqual([])
    db.close()
  })
})

describe('turns: актуальная main проекта', () => {
  function projectChat(db: VoiceChatDb) {
    const project = db.createProject(U, { name: 'P', gitUrl: 'https://example.test/p.git' })
    const agent = db.createAgent(U, 'Mac')
    db.linkMachine(U, project.id, agent.id)
    db.setProjectMachinePath(U, project.id, agent.id, '/srv/project')
    db.setProjectDefaultMachine(U, project.id, agent.id)
    const conv = db.createConversation(U, 'Проектный чат')
    db.setConversationProject(U, conv.id, project.id)
    db.addMessage(U, conv.id, 'u0', 'проверь код', '10:00')
    return { project, agent, conv }
  }

  it('до LLM подтверждает origin/main и добавляет фактический SHA в промпт', async () => {
    const db = freshDb()
    const { project, agent, conv } = projectChat(db)
    const rec = recorder()
    const calls: unknown[] = []
    const turns = createTurnManager({
      db, claude: rec.client, agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret',
      ensureProjectMainCurrent: async (args) => { calls.push(args); return { baseSha: 'a'.repeat(40) } }
    })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => { if (message.t === 'claude.done' || message.t === 'claude.error') { off(); resolve() } })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'проверь код' }] })
    })
    expect(calls).toEqual([expect.objectContaining({ projectId: project.id, agentId: agent.id, path: '/srv/project', branch: 'main', gitUrl: 'https://example.test/p.git' })])
    expect(rec.last()?.prompt).toContain(`main @ ${'a'.repeat(40)}`)
    db.close()
  })

  it('чат Git-проекта без привязанной машины не блокируется: preflight пропущен, модель предупреждена', async () => {
    const db = freshDb()
    // Свежий проект: gitUrl задан, машин к проекту не привязано, ход идёт на
    // машину пользователя по умолчанию.
    const project = db.createProject(U, { name: 'P', gitUrl: 'https://example.test/p.git' })
    db.createAgent(U, 'Mac')
    const conv = db.createConversation(U, 'Проектный чат')
    db.setConversationProject(U, conv.id, project.id)
    db.addMessage(U, conv.id, 'u0', 'проверь код', '10:00')
    const rec = recorder()
    const calls: unknown[] = []
    const turns = createTurnManager({
      db, claude: rec.client, agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret',
      ensureProjectMainCurrent: async (args) => { calls.push(args); return { baseSha: 'a'.repeat(40) } }
    })
    const errors: string[] = []
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => {
        if (message.t === 'claude.error') errors.push(message.message)
        if (message.t === 'claude.done' || message.t === 'claude.error') { off(); resolve() }
      })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'проверь код' }] })
    })
    expect(errors).toEqual([])
    expect(calls).toEqual([])
    expect(rec.last()?.prompt).toContain('не привязана к проекту')
    expect(rec.last()?.prompt).not.toContain('Системный preflight подтвердил')
    db.close()
  })

  it('рассказывает модели про автолечение копии, чтобы исчезнувшие правки не были загадкой', async () => {
    const db = freshDb()
    const { conv } = projectChat(db)
    const rec = recorder()
    const turns = createTurnManager({
      db, claude: rec.client, agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret',
      ensureProjectMainCurrent: async () => ({ baseSha: 'b'.repeat(40), autoHealed: 'незакоммиченные изменения (1 зап.: M app.css) спрятаны в stash «vc-autosync-20260904-105025»' })
    })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => { if (message.t === 'claude.done' || message.t === 'claude.error') { off(); resolve() } })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'проверь код' }] })
    })
    const prompt = rec.last()?.prompt ?? ''
    expect(prompt).toContain('Системный preflight подтвердил')
    expect(prompt).toContain('vc-autosync-20260904-105025')
    expect(prompt).toContain('Не восстанавливай спрятанное сам')
    db.close()
  })

  it('к отказу по грязной копии прикладывает готовое исправление для кнопки', async () => {
    const db = freshDb()
    const { conv } = projectChat(db)
    const rec = recorder()
    const turns = createTurnManager({
      db, claude: rec.client, agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret',
      ensureProjectMainCurrent: async () => { throw new Error('Рабочая копия проекта содержит локальные изменения; синхронизация с origin/main остановлена. Копия: /srv/project. Изменено записей: 2. Первые: M value.txt; ?? scratch.log.') }
    })
    let fix: { label: string; prompt: string; skipProjectSync?: boolean } | undefined
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => {
        if (message.t === 'claude.error') { fix = message.fix; off(); resolve() }
      })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'проверь код' }] })
    })
    // Пользователю остаётся нажать кнопку: промпт уже собран и помечен как
    // ход-исправление, иначе он упёрся бы в тот же самый отказ.
    expect(fix?.label).toBe('Исправить копию')
    expect(fix?.skipProjectSync).toBe(true)
    expect(fix?.prompt).toContain('/srv/project')
    expect(fix?.prompt).toContain('M value.txt')
    expect(fix?.prompt).toContain('status --porcelain')
    expect(rec.last()).toBeNull()
    db.close()
  })

  it('ход-исправление пропускает preflight и честно предупреждает модель', async () => {
    const db = freshDb()
    const { conv } = projectChat(db)
    const rec = recorder()
    const calls: unknown[] = []
    const turns = createTurnManager({
      db, claude: rec.client, agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret',
      ensureProjectMainCurrent: async (args) => { calls.push(args); return { baseSha: 'a'.repeat(40) } }
    })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => { if (message.t === 'claude.done' || message.t === 'claude.error') { off(); resolve() } })
      void turns.start({ userId: U, conversationId: conv.id, skipProjectSync: true, segments: [{ speakerId: 1, text: 'почини копию' }] })
    })
    expect(calls).toEqual([])
    expect(rec.last()?.prompt).toContain('preflight общей копии проекта пропущен')
    expect(rec.last()?.prompt).not.toContain('Системный preflight подтвердил')
    db.close()
  })

  it('не запускает LLM, если origin/main нельзя подтвердить', async () => {
    const db = freshDb()
    const { conv } = projectChat(db)
    const rec = recorder()
    const turns = createTurnManager({
      db, claude: rec.client, agents: onlineAgents,
      mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret',
      ensureProjectMainCurrent: async () => { throw new Error('dirty workspace') }
    })
    const errors: string[] = []
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((message) => {
        if (message.t === 'claude.error') { errors.push(message.message); off(); resolve() }
      })
      void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'проверь код' }] })
    })
    expect(rec.last()).toBeNull()
    expect(errors[0]).toContain('dirty workspace')
    db.close()
  })
})

describe('turns: инструкции чата', () => {
  it('по умолчанию модель получает подсказку про терминал; выключенная в настройках — нет', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    // Подсказки дописываются только к непустому промпту — нужна реплика в истории.
    db.addMessage(U, conv.id, 'u0', 'открой консоль', '10:00')
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).toContain('"kind": "console"')
    expect(rec.last()?.prompt).toContain('```questions')

    db.saveSettings(U, { ...db.getSettings(U), chatInstructions: db.getSettings(U).chatInstructions.map((item) => ['console', 'questions'].includes(item.id) ? { ...item, enabled: false } : item) })
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).not.toContain('"kind": "console"')
    expect(rec.last()?.prompt).not.toContain('```questions')
    // Проводник и картинки не трогали — остаются.
    expect(rec.last()?.prompt).toContain('"kind": "explorer"')
    expect(rec.last()?.prompt).toContain('```image')
    db.close()
  })

  it('у «Консоли с ассистентом» подсказки про tool-блок console нет, проводник остаётся', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Консоль', 'console-reader')
    db.addMessage(U, conv.id, 'u0', 'открой консоль', '10:00')
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).not.toContain('"kind": "console"')
    expect(rec.last()?.prompt).toContain('"kind": "explorer"')
    db.close()
  })

  it('у Make нет подсказок task-launch и console — ассистент сразу правит файлы инструментами make_*', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Проект', 'make')
    db.addMessage(U, conv.id, 'u0', 'сделай лендинг', '10:00')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, agents: onlineAgents, mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret', makeMcpBaseUrl: 'http://127.0.0.1:8787/mcp/make?k=secret' })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => { if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() } })
      turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'сделай лендинг' }] })
    })
    expect(rec.last()?.prompt).not.toContain('task-launch')
    expect(rec.last()?.prompt).not.toContain('"kind": "console"')
    expect(rec.last()?.prompt).toContain('```questions')
    expect(rec.last()?.makeMcpUrl).toMatch(/\/mcp\/make\?k=secret&conv=.+&turn=.+/)
    expect(rec.last()?.previewMcpUrl).toBeUndefined()
    db.close()
  })

  it('Make у не-admin без машины (Claude): ход идёт не в plan, встроенные инструменты запрещены, make MCP без ro (roadmap-3 п.2)', async () => {
    const db = freshDb()
    db.createUser('dev', '', 'developer')
    const conv = db.createConversation('dev', 'Проект', 'make')
    db.addMessage('dev', conv.id, 'u0', 'сделай лендинг', '10:00')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, agents: onlineAgents, mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret', makeMcpBaseUrl: 'http://127.0.0.1:8787/mcp/make?k=secret' })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => { if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() } })
      turns.start({ userId: 'dev', conversationId: conv.id, segments: [{ speakerId: 1, text: 'сделай лендинг' }] })
    })
    expect(rec.last()?.permissionMode).not.toBe('plan')
    expect(rec.last()?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'Read']))
    expect(rec.last()?.makeMcpUrl).not.toContain('ro=1')
    db.close()
  })

  it('Make с назначенной машиной всё равно не получает remote-мост и встроенные инструменты', async () => {
    const db = freshDb() // владелец — admin: раньше именно у него Make получал Bash и файлы
    const project = db.createProject(U, { name: 'Проект' })
    const agent = db.createAgent(U, 'Ноутбук')
    db.linkMachine(U, project.id, agent.id)
    db.setProjectMachinePath(U, project.id, agent.id, '/repo')
    // Машина проекта по умолчанию — то есть чат её наследует (прямую привязку
    // Make-чату БД теперь не даёт записать, см. database.test.ts).
    db.setUserProjectDefaultMachine(U, project.id, agent.id)
    const conv = db.createConversation(U, 'Витрина', 'make', project.id)!
    db.addMessage(U, conv.id, 'u0', 'поправь кнопку', '10:00')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, agents: onlineAgents, mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret', makeMcpBaseUrl: 'http://127.0.0.1:8787/mcp/make?k=secret' })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => { if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() } })
      turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'поправь кнопку' }] })
    })
    // Общая копия проекта принадлежит git-потоку: доступа к машине у Make нет.
    expect(rec.last()?.remote).toBeUndefined()
    expect(rec.last()?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'Read']))
    // Мастерская при этом работает: make_* остаются подключёнными и не read-only.
    expect(rec.last()?.makeMcpUrl).toContain('/mcp/make?k=secret')
    expect(rec.last()?.makeMcpUrl).not.toContain('ro=1')
    db.close()
  })

  it('Make на Codex остаётся в плане даже у admin: MCP в read-only sandbox недоступен', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Витрина', 'make')!
    db.saveSettings(U, { ...db.getSettings(U), llmProvider: 'codex' })
    db.addMessage(U, conv.id, 'u0', 'поправь кнопку', '10:00')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, codex: rec.client, agents: onlineAgents, mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret', makeMcpBaseUrl: 'http://127.0.0.1:8787/mcp/make?k=secret' })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => { if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() } })
      turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'поправь кнопку' }] })
    })
    expect(rec.last()?.permissionMode).toBe('plan')
    expect(rec.last()?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit']))
    db.close()
  })

  it('Make в режиме «План» по выбору пользователя получает хинт «Режим вопроса», а не плана (roadmap-4 п.4)', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Проект', 'make')
    db.setConversationExecTarget(U, conv.id, null, undefined, undefined, undefined, undefined, 'plan')
    db.addMessage(U, conv.id, 'u0', 'почему кнопка красная?', '10:00')
    const rec = recorder()
    const turns = createTurnManager({ db, claude: rec.client, agents: onlineAgents, mcpBaseUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=secret', makeMcpBaseUrl: 'http://127.0.0.1:8787/mcp/make?k=secret' })
    await new Promise<void>((resolve) => {
      const off = turns.subscribe((m) => { if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() } })
      turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'почему кнопка красная?' }] })
    })
    expect(rec.last()?.prompt).toContain('## Режим вопроса')
    expect(rec.last()?.prompt).not.toContain('## Режим плана')
    expect(rec.last()?.makeMcpUrl).toContain('ro=1')
    db.close()
  })

  it('инструкция, выключенная в инспекторе разговора, не попадает в промпт при включённой настройке', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.addMessage(U, conv.id, 'u0', 'открой консоль', '10:00')
    db.setConversationContextEnabled(U, conv.id, 'instruction-console', false)
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).not.toContain('"kind": "console"')
    expect(rec.last()?.prompt).toContain('"kind": "explorer"')
    db.close()
  })

  it('tool-блок выключенной консоли вырезается из сохранённого ответа', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.addMessage(U, conv.id, 'u0', 'открой консоль', '10:00')
    db.saveSettings(U, { ...db.getSettings(U), chatInstructions: db.getSettings(U).chatInstructions.map((item) => item.id === 'console' ? { ...item, enabled: false } : item) })
    const client: LlmClient = {
      send(_req, h) {
        h.onDone('Открываю.\n\n```tool\n{"kind":"console"}\n```')
        return { cancel: () => {} }
      }
    }
    await runTurn(client, db, conv.id)
    const last = db.listMessages(U, conv.id).at(-1)
    expect(last?.role).toBe('ai')
    expect(last?.text).toBe('Открываю.')
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

describe('turns: инспектор контекста — выключенное не попадает ассистенту', () => {
  it('выключенная персонализация не идёт в промпт, выключенный MCP-инструмент уходит в disallowedTools', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.saveSettings(U, { ...db.getSettings(U), personalization: { ...db.getSettings(U).personalization, preferredName: 'Лёша', responseStyle: 'brief', tone: 'friendly', responseLanguage: 'ru' } })
    // По умолчанию персонализация была бы в промпте — выключаем её и один инструмент.
    db.setConversationContextEnabled(U, conv.id, 'personalization', false)
    db.setConversationContextEnabled(U, conv.id, 'mcp-remote-bash', false)
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).not.toContain('## Персонализация пользователя')
    expect(rec.last()?.disallowedTools ?? []).toContain('mcp__remote__bash')
    db.close()
  })

  it('включённая персонализация остаётся в промпте (контроль)', async () => {
    const db = freshDb()
    const conv = db.createConversation(U, 'Чат')
    db.saveSettings(U, { ...db.getSettings(U), personalization: { ...db.getSettings(U).personalization, preferredName: 'Лёша' } })
    const rec = recorder()
    await runTurn(rec.client, db, conv.id)
    expect(rec.last()?.prompt).toContain('## Персонализация пользователя')
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
      readServerFile: async (_userId, path) => path.startsWith(dir) ? { name: 'pic.png', dataBase64: readFileSync(path).toString('base64') } : null,
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

  it('сохраняет полный порядок очереди и запускает сообщения строго по нему', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const active = db.addMessage(U, conversation.id, 'u1', 'Активный', '10:00')
    const queued = ['A', 'B', 'C'].map((text, index) => db.addMessage(U, conversation.id, 'u1', text, `10:0${index + 1}`))
    const llm = controlled()
    const turns = createTurnManager({ db, claude: llm.client })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: active.id, segments: [{ speakerId: 1, text: active.text }] })
    for (const message of queued) {
      await turns.start({ userId: U, conversationId: conversation.id, messageId: message.id, segments: [{ speakerId: 1, text: message.text }] })
    }
    const snapshot = db.listQueuedTurns(U, conversation.id)
    turns.reorderQueued(U, conversation.id, [snapshot[2]!.id, snapshot[0]!.id, snapshot[1]!.id])
    expect(db.listQueuedTurns(U, conversation.id).map((item) => item.text)).toEqual(['C', 'A', 'B'])

    llm.handlers[0]!.onDone('done')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(llm.handlers).toHaveLength(2)
    expect(llm.requests[1]?.prompt).toContain('C')
    expect(db.listQueuedTurns(U, conversation.id).map((item) => item.text)).toEqual(['A', 'B'])
    db.close()
  })

  it('ошибка активного хода фиксируется и однократно продвигает следующий элемент', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const active = db.addMessage(U, conversation.id, 'u1', 'Активный', '10:00')
    const queued = db.addMessage(U, conversation.id, 'u1', 'Следующий', '10:01')
    const llm = controlled()
    const turns = createTurnManager({ db, claude: llm.client })

    await turns.start({ userId: U, conversationId: conversation.id, messageId: active.id, segments: [{ speakerId: 1, text: active.text }] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: queued.id, segments: [{ speakerId: 1, text: queued.text }] })
    llm.handlers[0]!.onError('runner failed')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(llm.handlers).toHaveLength(2)
    expect(llm.requests[1]?.prompt).toContain('Следующий')
    expect(db.isTurnQueuePaused(U, conversation.id)).toBe(false)
    expect(db.listQueuedTurns(U, conversation.id)).toEqual([
      expect.objectContaining({ messageId: active.id, status: 'failed' })
    ])

    llm.handlers[1]!.onDone('Ответ следующего')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(llm.handlers).toHaveLength(2)
    expect(db.listQueuedTurns(U, conversation.id)).toEqual([
      expect.objectContaining({ messageId: active.id, status: 'failed' })
    ])
    db.close()
  })

  it('отклоняет reorder с неполным набором без потери очереди', () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const messages = ['A', 'B'].map((text) => db.addMessage(U, conversation.id, 'u1', text, '10:00'))
    messages.forEach((message) => db.enqueueTurn(U, conversation.id, message.id, { segments: [{ speakerId: 1, text: message.text }] }))
    const before = db.listQueuedTurns(U, conversation.id)
    db.reorderQueuedTurns(U, conversation.id, [before[1]!.id])
    expect(db.listQueuedTurns(U, conversation.id).map((item) => item.id)).toEqual(before.map((item) => item.id))
    db.close()
  })

  it('Отправить сейчас отменяет partial и перезапускает один объединённый запрос', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const duplicate = { uploadId: 'same-file', path: '/same.png', name: 'same.png', mimeType: 'image/png', size: 1 }
    const active = db.addMessage(U, conversation.id, 'u1', 'Базовый вопрос', '10:00', undefined, undefined, undefined, [duplicate])
    const first = db.addMessage(U, conversation.id, 'u1', 'Первый ожидающий', '10:01')
    const priority = db.addMessage(U, conversation.id, 'u1', 'Приоритетный', '10:02', undefined, undefined, undefined, [duplicate])
    const llm = controlled()
    const turns = createTurnManager({
      db,
      claude: llm.client,
      resolveUpload: (id) => ({ serverPath: `/uploads/${id}`, runnerName: id, dataBase64: 'eA==' })
    })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: active.id, segments: [{ speakerId: 1, text: active.text }], attachments: ['same-file'] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: first.id, segments: [{ speakerId: 1, text: first.text }] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: priority.id, segments: [{ speakerId: 1, text: priority.text }], attachments: ['same-file'] })
    llm.handlers[0].onDelta('Старый partial')
    const selected = db.listQueuedTurns(U, conversation.id)[1]
    turns.sendQueuedNow(U, conversation.id, selected.id)
    turns.sendQueuedNow(U, conversation.id, selected.id)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(llm.cancels()).toBe(1)
    expect(llm.handlers).toHaveLength(2)
    expect(db.listQueuedTurns(U, conversation.id).map((item) => item.messageId)).toEqual([first.id])
    const mergedMessages = db.listMessages(U, conversation.id)
    expect(mergedMessages).toHaveLength(1)
    expect(mergedMessages[0]).toMatchObject({ text: 'Базовый вопрос\n\nПриоритетный' })
    expect(mergedMessages[0]?.id).not.toBe(active.id)
    expect(mergedMessages[0]?.id).not.toBe(priority.id)
    expect(mergedMessages[0]?.attachments).toEqual([duplicate, duplicate])
    expect(llm.requests[1]?.prompt).toContain('Базовый вопрос')
    expect(llm.requests[1]?.prompt).toContain('Приоритетный')
    expect(llm.requests[1]?.attachments?.map((item) => item.runnerName)).toEqual(['same-file', 'same-file'])
    expect(db.getConversation(U, conversation.id)?.claudeSessionId).toBeNull()
    db.close()
  })

  it('ошибка отмены сохраняет объединённый запрос failed и не запускает второй ход', async () => {
    const db = freshDb()
    const conversation = db.createConversation(U, 'queue')
    const active = db.addMessage(U, conversation.id, 'u1', 'Активный', '10:00')
    const queued = db.addMessage(U, conversation.id, 'u1', 'Новый', '10:01')
    let starts = 0
    const client: LlmClient = {
      send() {
        starts += 1
        return { cancel: () => { throw new Error('cancel failed') } }
      }
    }
    const turns = createTurnManager({ db, claude: client })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: active.id, segments: [{ speakerId: 1, text: active.text }] })
    await turns.start({ userId: U, conversationId: conversation.id, messageId: queued.id, segments: [{ speakerId: 1, text: queued.text }] })
    turns.sendQueuedNow(U, conversation.id, db.listQueuedTurns(U, conversation.id)[0]!.id)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(starts).toBe(1)
    expect(db.isTurnQueuePaused(U, conversation.id)).toBe(true)
    expect(db.listQueuedTurns(U, conversation.id)).toEqual([
      expect.objectContaining({ status: 'failed', text: 'Активный\n\nНовый' })
    ])
    expect(db.listMessages(U, conversation.id)).toEqual([
      expect.objectContaining({ text: 'Активный\n\nНовый' })
    ])
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
