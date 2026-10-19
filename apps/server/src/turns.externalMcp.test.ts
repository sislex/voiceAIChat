import { describe, it, expect } from 'vitest'
import { TrustedCoreRegistry, verifyCoreMcpToken } from '@sislexa/component-runtime'
import type { ApplicationId } from '@voicechat/shared'
import { createTurnManager } from './turns.js'
import { VoiceChatDb } from './db/database.js'
import type { LlmClient, LlmRequest } from './claude/types.js'
import { externalMcpUrls } from './sharedServices/externalService.js'

const U = 'admin'
const SECRETS: Partial<Record<ApplicationId, string>> = { 'web-reader': 'reader-mcp', projects: 'kanban-mcp' }
const URLS: Partial<Record<ApplicationId, string>> = { 'web-reader': 'https://reader.example.org', projects: 'https://kanban.example.org' }

function recorder(): { client: LlmClient; last: () => LlmRequest | null } {
  let last: LlmRequest | null = null
  return { client: { send(req, h) { last = req; void h.onDone('ok'); return { cancel: () => {} } } }, last: () => last }
}
/** Claims of the core MCP token in an MCP URL, verified like the service does. */
function claimsOf(url: string | undefined, application: ApplicationId) {
  const registry = new TrustedCoreRegistry(ref => ({ call: 'x', mcp: SECRETS[application]! } as Record<string, string>)[ref]!)
  registry.add({ coreId: 'core-a', url: 'https://core-a.example.org', credentialRef: 'call', mcpSecretRef: 'mcp' })
  return verifyCoreMcpToken(registry, new URL(url!).searchParams.get('k')!)
}
async function turn(db: VoiceChatDb, conversationId: string, extra: Partial<Parameters<ReturnType<typeof createTurnManager>['start']>[0]> = {},
  deps: Partial<Parameters<typeof createTurnManager>[0]> = {}) {
  const rec = recorder()
  const turns = createTurnManager({ db, claude: rec.client,
    externalMcpUrl: externalMcpUrls({ coreId: 'core-a', url: id => URLS[id], secrets: SECRETS }), ...deps })
  await new Promise<void>(resolve => {
    const off = turns.subscribe(m => { if (m.t === 'claude.done' || m.t === 'claude.error') { off(); resolve() } })
    void turns.start({ userId: U, conversationId, segments: [{ speakerId: 1, text: 'hi' }], ...extra })
  })
  await turns.idle()
  return rec.last()
}

describe('turns: external application MCP', () => {
  it('gives an external Kanban its tools with a core MCP token instead of the shared secret', async () => {
    const db = new VoiceChatDb(':memory:')
    try {
      await db.identity.createUser(U, '', 'admin')
      const project = await db.projects.createProject(U, { name: 'Board' })
      const conv = (await db.chat.ensureKanbanAssistantConversation(U, project.id))!
      const context = { version: 1 as const, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: null, selection: null, recentActions: [] }
      const remembered: string[] = []
      const request = await turn(db, conv.id, { assistantContext: context }, { widgetContexts: { remember: id => { remembered.push(id) } } })
      expect(new URL(request!.kanbanMcpUrl!).origin + new URL(request!.kanbanMcpUrl!).pathname).toBe('https://kanban.example.org/mcp/kanban')
      expect(request!.kanbanMcpUrl).toContain(`&conv=${conv.id}&turn=`)
      expect(claimsOf(request!.kanbanMcpUrl, 'projects')).toMatchObject({ coreId: 'core-a', application: 'projects', userId: U, conversationId: conv.id })
      expect(request!.prompt).toContain('mcp__kanban__')
      expect(remembered).toEqual([conv.id])
    } finally { db.close() }
  })
  it('gives an external Web Reader its preview tools with a core MCP token for the conversation', async () => {
    const db = new VoiceChatDb(':memory:')
    try {
      await db.identity.createUser(U, '', 'admin')
      const conv = await db.chat.createConversation(U, 'Reader', 'web-recorder')
      const request = await turn(db, conv.id, {}, { previewMcpBaseUrl: 'http://127.0.0.1:8787/mcp/preview?k=secret', previewTurns: { issue: () => 'local', verify: () => null } as never })
      expect(request!.previewMcpUrl).toMatch(/^https:\/\/reader\.example\.org\/mcp\/preview\?k=sxm1\./)
      expect(claimsOf(request!.previewMcpUrl, 'web-reader')).toMatchObject({ application: 'web-reader', userId: U, conversationId: conv.id })
    } finally { db.close() }
  })
  it('keeps local tools when the application is not external', async () => {
    const db = new VoiceChatDb(':memory:')
    try {
      await db.identity.createUser(U, '', 'admin')
      const project = await db.projects.createProject(U, { name: 'Board' })
      const conv = (await db.chat.ensureKanbanAssistantConversation(U, project.id))!
      const context = { version: 1 as const, widget: { kind: 'kanban', instanceId: project.id, title: 'Board' }, project: null, selection: null, recentActions: [] }
      const request = await turn(db, conv.id, { assistantContext: context },
        { externalMcpUrl: externalMcpUrls({ coreId: 'core-a', url: () => undefined, secrets: SECRETS }), kanbanMcpBaseUrl: 'http://127.0.0.1:8787/mcp/kanban?k=secret' })
      expect(request!.kanbanMcpUrl).toMatch(/^http:\/\/127\.0\.0\.1:8787\/mcp\/kanban\?k=secret&conv=/)
    } finally { db.close() }
  })
})

describe('external MCP URLs', () => {
  it('cover Web Reader preview and Kanban, but not Playwright Reader (its tools come through Web Reader)', () => {
    const urls = externalMcpUrls({ coreId: 'core-a', url: () => 'https://svc.example.org', secrets: { 'web-reader': 'r', projects: 'k', 'playwright-reader': 'p' } })
    expect(urls('web-reader', { userId: U, conversationId: 'c1' })).toMatch(/^https:\/\/svc\.example\.org\/mcp\/preview\?k=sxm1\./)
    expect(urls('projects', { userId: U, conversationId: 'c1' })).toMatch(/^https:\/\/svc\.example\.org\/mcp\/kanban\?k=sxm1\./)
    expect(urls('playwright-reader', { userId: U, conversationId: 'c1' })).toBeUndefined()
  })
})
