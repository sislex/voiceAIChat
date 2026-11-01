import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { createRemoteStorageRuntime, withStorageTenant } from './remote.js'
import Fastify from 'fastify'
import { registerFileStorageRoutes } from './routes.js'

let server: Server, root: string, runtime: Awaited<ReturnType<typeof createRemoteStorageRuntime>>
const seen: Array<{authorization?:string;user?:string;tenant?:string;range?:string;body:Buffer}> = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'remote-storage-'))
  const tokenFile = join(root, 'token'); await writeFile(tokenFile, 'service-secret\n')
  server = createServer(async (req,res) => {
    const chunks: Buffer[]=[]; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    seen.push({authorization:req.headers.authorization,user:req.headers['x-sislexa-user'] as string,
      tenant:req.headers['x-sislexa-tenant'] as string,range:req.headers.range,body:Buffer.concat(chunks)})
    if (req.url?.includes('missing')) { res.writeHead(404,{'content-type':'application/json'}).end(JSON.stringify({error:'not_found',message:'gone'})); return }
    if (req.method === 'PUT') { res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({path:'file',size:6,mimeType:'text/plain',revision:1,updatedAt:1,updatedBy:'alice'})); return }
    if (req.url?.includes('/files')) { res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({entries:[{path:'file',size:6,mimeType:'text/plain',revision:1,updatedAt:1,updatedBy:'alice'}]})); return }
    const ranged=req.headers.range; res.writeHead(ranged?206:200,{'content-type':'text/plain','content-length':ranged?'3':'6',...(ranged?{'content-range':'bytes 1-3/6'}:{})}); res.end(ranged?'bcd':'abcdef')
  })
  await new Promise<void>((resolve,reject) => server.listen(18799,'127.0.0.1',resolve).once('error',reject))
  runtime = await createRemoteStorageRuntime({mode:'remote',url:'http://127.0.0.1:18799',serviceTokenFile:tokenFile,nodes:[],defaultQuotaBytes:1})
})
afterAll(async () => { await runtime?.close(); await new Promise<void>(resolve=>server?.close(()=>resolve())); await rm(root,{recursive:true,force:true}) })

it('asserts user and tenant and streams uploads and ranged downloads', async () => {
  async function* body() { yield Buffer.from('abc'); yield Buffer.from('def') }
  await withStorageTenant('tenant-1', () => runtime.service.writeFile('alice','space','file',Readable.from(body()),{mimeType:'text/plain'}))
  expect(seen.at(-1)).toMatchObject({authorization:'Bearer service-secret',user:'alice',tenant:'tenant-1',body:Buffer.from('abcdef')})
  const opened=await runtime.service.openFile('alice','space','file','bytes=1-3')
  const chunks:Buffer[]=[]; for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toBe('bcd'); expect(opened).toMatchObject({contentLength:3,contentRange:'bytes 1-3/6'})
  expect(seen.at(-1)?.range).toBe('bytes=1-3')
})

it('maps storage errors and connection failures', async () => {
  await expect(runtime.service.statFile('alice','space','missing')).rejects.toMatchObject({code:'not_found'})
  const unavailable=await createRemoteStorageRuntime({mode:'remote',url:'http://127.0.0.1:18800',serviceTokenFile:join(root,'token'),nodes:[],defaultQuotaBytes:1})
  await expect(unavailable.service.listSpaces('alice')).rejects.toMatchObject({code:'storage_unavailable',statusCode:503})
})

it('preserves Core conditional GET behavior without opening the upstream body', async () => {
  const app=Fastify()
  app.addHook('preHandler', async req => { req.user={name:'alice',role:'developer',account:{tenantId:'tenant-1'}} as NonNullable<typeof req.user> })
  registerFileStorageRoutes(app,runtime.service)
  const before=seen.length
  const response=await app.inject({method:'GET',url:'/api/storage/spaces/space/file?path=file',headers:{'if-none-match':'"space:1"'}})
  expect(response.statusCode).toBe(304)
  expect(seen.slice(before)).toHaveLength(1)
  expect(seen.at(-1)).toMatchObject({user:'alice',tenant:'tenant-1'})
  await app.close()
})
