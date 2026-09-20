import {afterEach,expect,it} from 'vitest'
import {VoiceChatDb} from './db/database.js'
import {createIdentityStoreClient} from '@sislexa/identity/client/rpc'
import {readFileSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
const databases:VoiceChatDb[]=[]
afterEach(async()=>{for(const db of databases.splice(0))await db.close()})
it('uses the remote identity port from both public and neighboring repository calls',async()=>{
 const calls:string[]=[]
 const remote=createIdentityStoreClient({url:'http://identity.test',token:'service-token',fetchImpl:async(_input,init)=>{const {method}=JSON.parse(String(init?.body));calls.push(method);return Response.json({result:method==='getUser'?{name:'alice',role:'admin'}:null})}})
 const db=new VoiceChatDb(':memory:',{ports:{identity:()=>remote}});databases.push(db);await db.ready
 expect(await db.identity.getUser('alice')).toMatchObject({name:'alice'})
 // Project visibility consults identity through ctx.repos rather than db.identity.
 const context=(db as unknown as {ctx:{repos:{identity:typeof remote}}}).ctx
 expect(await context.repos.identity.getUser('alice')).toMatchObject({role:'admin'})
 expect(calls).toEqual(['getUser','getUser'])
})
it('keeps relocated authentication and storage source as compatibility exports only',()=>{
 for(const dir of ['users','db/sql'])for(const name of readdirSync(join(__dirname,dir))){
  if(!name.endsWith('.ts')||name.includes('.test.'))continue
  expect(readFileSync(join(__dirname,dir,name),'utf8').trim(),dir+'/'+name).toMatch(/^export \* from ["']@sislexa\/identity\/[\w/-]+["']$/)
 }
 expect(readFileSync(join(__dirname,'db/repos/identity.ts'),'utf8').trim()).toMatch(/^export \* from/)
})

it('enforces live tariff and tenant context across the real Identity RPC boundary', async () => {
 const {default: Fastify} = await import('fastify')
 const {buildIdentityServer} = await import('@sislexa/identity/server/server')
 const {registerRemoteIdentity} = await import('@sislexa/identity/client/server')
 const {signToken} = await import('./users/accounts.js')
 const {registerAccountAccess} = await import('./accountAccess.js')
 const db = new VoiceChatDb(':memory:'); databases.push(db); await db.ready
 await db.identity.createUser('alice', '', 'developer')
 await db.identity.createUser('bob', '', 'developer')
 const {app: identity} = await buildIdentityServer({database: db, secret: 'integration-secret', authorize: header => header === 'Bearer service-grant' ? {ok: true} : {ok: false, status: 401}})
 const core = Fastify()
 const fetchImpl: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const result = await identity.inject({method: request.method as 'POST', url: new URL(request.url).pathname + new URL(request.url).search, headers: Object.fromEntries(request.headers), ...(request.method === 'POST' ? {payload: await request.text()} : {})})
  return new Response(result.body, {status: result.statusCode, headers: {'content-type': 'application/json'}})
 }
 try {
  await registerRemoteIdentity(core, db, {url: 'http://identity.test', token: 'service-grant', fetchImpl}, 'integration-secret')
  registerAccountAccess(core, db)
  let executions = 0
  core.post('/api/conversations', req => ({user: req.user, executions: ++executions}))
  core.post('/api/make/workspaces', () => ({executions: ++executions}))
  const token = signToken({name: 'alice', role: 'developer'}, 'integration-secret')
  const headers = {authorization: 'Bearer ' + token}
  expect((await core.inject({method: 'POST', url: '/api/conversations', headers, payload: {assistantKind: 'make'}})).statusCode).toBe(200)
  await db.identity.saveTariffPlan({id: 'chat', name: 'Chat', capabilities: ['chat.use']})
  await db.identity.assignUserTariff('alice', 'chat')
  expect((await core.inject({method: 'POST', url: '/api/conversations', headers, payload: {assistantKind: 'make'}})).statusCode).toBe(403)
  expect((await core.inject({method: 'POST', url: '/api/make/workspaces', headers, payload: {}})).statusCode).toBe(403)
  expect((await core.inject({method: 'POST', url: '/api/conversations', headers, payload: {}})).json()).toMatchObject({user: {role: 'developer', account: {tariffId: 'chat', capabilities: ['chat.use']}}})
  const foreignTenant = (await db.identity.getAccountAccess('bob'))!.tenant.id
  expect((await core.inject({method: 'POST', url: '/api/conversations', headers: {...headers, 'x-sislexa-tenant-id': foreignTenant}, payload: {}})).statusCode).toBe(403)
  expect((await core.inject({method: 'POST', url: '/api/conversations', headers: {authorization: 'Bearer service-grant'}, payload: {}})).statusCode).toBe(401)
  expect(executions).toBe(2)
 } finally { await core.close(); await identity.close() }
})
