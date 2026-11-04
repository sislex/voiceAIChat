import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { deferredCoreFetch } from './deferredCoreFetch.js'

it('resolves Core after peer creation and preserves real HTTP request data', async () => {
  let coreUrl = ''
  const request = deferredCoreFetch(() => coreUrl)
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    res.end(JSON.stringify({ path: req.url, method: req.method, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No TCP address')
  coreUrl = `http://127.0.0.1:${address.port}`
  try {
    const response = await request(new Request('http://core.test/rpc?key=value', {
      method: 'POST', headers: { authorization: 'Bearer fixture' }, body: 'payload'
    }))
    expect(await response.json()).toEqual({ path: '/rpc?key=value', method: 'POST', auth: 'Bearer fixture', body: 'payload' })
    expect(await (await request(coreUrl + '/direct')).json()).toMatchObject({ path: '/direct' })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
