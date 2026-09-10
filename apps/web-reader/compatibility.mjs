// Реальные опубликованные приложения; все учётные данные принадлежат одноразовой матрице.
import assert from 'node:assert/strict'
import { createPreviewTurnTokens } from '@voicechat/web-reader-contracts'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({ urls, token }) {
  const request = contractHttp(token), core = urls.voicechat, reader = urls['web-reader']
  assert.ok(core && reader, 'Матрице нужны Web Reader и ядро')
  const { token: auth } = await request(core, '/api/session/login', { method: 'POST', body: { name: 'admin', password: token } })
  const conversation = await request(core, '/api/conversations', { method: 'POST', auth, body: { title: 'Web Reader compatibility', assistantKind: 'web-recorder' } })
  const rpc = async (userId) => (await request(core, '/internal/reader/core', { method: 'POST', body: { method: 'context', args: [{ userId, conversationId: conversation.id }] } })).result
  assert.deepEqual((await rpc('admin')).testUsers, [])
  assert.equal(await rpc('not-a-member'), null)
  const preview = '/api/preview?url=' + encodeURIComponent('https://app.internal/api/health')
  for (const base of [reader, core]) {
    assert.equal((await request(base, preview, { auth })).ok, true)
    await request(base, preview, { auth: 'invalid', status: 401 })
    const response = await fetch(base + '/web-recorder/', { signal: AbortSignal.timeout(15_000) })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /\/web-recorder\/assets\//)
  }
  await request(reader, '/api/preview?url=' + encodeURIComponent('https://app.internal/internal/reader/core'), { auth, status: 403 })
  const turn = createPreviewTurnTokens(token).issue({ userId: 'admin', conversationId: conversation.id })
  const response = await fetch(reader + '/mcp/preview?k=' + encodeURIComponent(token) + '&turn=' + encodeURIComponent(turn), {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test-users', arguments: {} } }), signal: AbortSignal.timeout(15_000)
  })
  assert.equal(response.status, 200)
  const result = (await response.json()).result
  assert.ok(!result.isError, JSON.stringify(result))
  assert.ok(result.content.length)
}
