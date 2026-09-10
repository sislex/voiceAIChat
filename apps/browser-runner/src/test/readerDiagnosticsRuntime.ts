import type { BrowserCommand, BrowserInspectResult } from '@voicechat/shared'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserSessionManager } from '../sessionManager.js'
import { startReaderDiagnosticsFixture } from './readerDiagnostics.js'
const site = await startReaderDiagnosticsFixture(),
  root = await mkdtemp(join(tmpdir(), 'vc-diag-runtime-')),
  manager = new BrowserSessionManager(root, new Map([['diag.reader.test', new URL(site.origin).host]]))
try {
  const meta = await manager.start({ sessionId: 'test', userKey: 'test', conversationKey: 'test' })
  const send = (command: BrowserCommand) =>
    manager.command(meta.id, { requestId: 'test', incarnation: meta.incarnation, actor: 'assistant', command })
  await send({ type: 'navigate', url: 'http://diag.reader.test/' })
  await send({ type: 'selector', action: { kind: 'click', selector: '#logs' } })
  let result: BrowserInspectResult
  const deadline = Date.now() + 2000
  do {
    result = (await send({
      type: 'inspect',
      action: { kind: 'console', pattern: 'Payload', regex: false }
    })) as BrowserInspectResult
    if (!result.console?.[0]?.argsPending) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  assert.deepEqual(result.console![0].args![1], { nested: { detail: 'Вложенные данные' }, items: [1, 2, 3] })
  console.log('tsx console arguments verified')
} finally {
  await manager.close()
  await site.close()
  await rm(root, { recursive: true, force: true })
}
