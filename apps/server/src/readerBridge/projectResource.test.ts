import fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { readerProjectResource } from './projectResource.js'
import { HttpReaderCore } from '../reader/standalone/httpCore.js'
const decode = (body: string) => Buffer.from(body, 'base64').toString()
describe('текущее приложение без сетевого loopback', () => {
  it('передаёт сырое тело и авторизацию самой страницы, сохраняя ответ и Set-Cookie', async () => {
    const app = fastify();app.addContentTypeParser('application/octet-stream', {parseAs:'buffer'}, (_req,body,done)=>done(null,body))
    app.post('/upload', async (req,reply)=>reply.code(201).header('set-cookie',['a=1','b=2']).send({body:Buffer.from(req.body as Buffer).toString('hex'),authorization:req.headers.authorization,host:req.headers.host,forwarded:req.headers['x-forwarded-for']}))
    try { const response = await readerProjectResource(app,{method:'POST',path:'/upload',headers:{'content-type':'application/octet-stream',authorization:'Bearer page-token',host:'other','x-forwarded-for':'127.0.0.1'},bodyBase64:Buffer.from([0,255,1]).toString('base64')});expect(response.status).toBe(201);expect(response.headers['set-cookie']).toEqual(['a=1','b=2']);expect(JSON.parse(decode(response.bodyBase64))).toMatchObject({body:'00ff01',authorization:'Bearer page-token',host:'app.internal'});expect(JSON.parse(decode(response.bodyBase64))).not.toHaveProperty('forwarded') } finally { await app.close() }
  })
  it('не передаёт права внешней панели, когда вложенная страница ещё не вошла', async () => {
    const app=fastify();app.get('/api/private',async(req,reply)=>req.headers.authorization?{ok:true}:reply.code(401).send({error:'login'}))
    try {expect((await readerProjectResource(app,{method:'GET',path:'/api/private',headers:{}})).status).toBe(401)}finally{await app.close()}
  })
  it('служебные маршруты и большой запрос отклоняются до обработчика', async () => {
    const app=fastify();let calls=0;app.all('/*',async()=>{calls++;return'ok'})
    try {expect((await readerProjectResource(app,{method:'GET',path:'/internal/reader/core',headers:{}})).status).toBe(403);expect((await readerProjectResource(app,{method:'POST',path:'/upload',headers:{},bodyBase64:Buffer.alloc(5*1024*1024+1).toString('base64')})).status).toBe(413);expect(calls).toBe(0)}finally{await app.close()}
  })
  it('standalone передаёт тот же запрос через версионированный RPC ядра', async () => {
    let seen: unknown
    const result={status:200,headers:{'content-type':'text/html'},bodyBase64:'aGk='}
    const core=new HttpReaderCore({coreUrl:'http://core:8787',token:'internal',fetchImpl:async(_url,init)=>{seen=JSON.parse(String(init?.body));return new Response(JSON.stringify({result}),{headers:{'content-type':'application/json'}})}})
    const request={method:'GET',path:'/?x=1',headers:{}}
    expect(await core.projectResource(request)).toEqual(result);expect(seen).toEqual({method:'projectResource',args:[request]})
  })
})
