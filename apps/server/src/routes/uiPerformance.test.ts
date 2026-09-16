import { expect,it } from 'vitest'
import Fastify from 'fastify'
import { registerUiPerformanceRoutes } from './uiPerformance.js'
// @testCase T3
it('requires authentication for ingestion and the existing administrative permission for reports', async () => {
  const app=Fastify()
  app.addHook('preHandler',async req=>{
    const role=req.headers.authorization
    if(role) req.user={name:'fixture',role:role==='admin'?'admin':'observer'} as NonNullable<typeof req.user>
  })
  registerUiPerformanceRoutes(app)
  try {
    const body={schemaVersion:1,batchId:'a'.repeat(32),samples:[{metric:'chat_ready',route:'chat',duration:1,age:0,platform:'web',lifecycle:'cold',version:'unknown'}]}
    expect((await app.inject({method:'POST',url:'/api/ui-performance',payload:body})).statusCode).toBe(401)
    expect((await app.inject({method:'POST',url:'/api/ui-performance',headers:{authorization:'observer'},payload:body})).statusCode).toBe(204)
    const query={from:0,to:100,buckets:1}
    expect((await app.inject({method:'POST',url:'/api/ui-performance/report',headers:{authorization:'observer'},payload:query})).statusCode).toBe(403)
    expect((await app.inject({method:'POST',url:'/api/ui-performance/report',headers:{authorization:'admin'},payload:query})).statusCode).toBe(200)
    expect((await app.inject({method:'POST',url:'/api/ui-performance',headers:{authorization:'admin'},payload:{...body,userId:'forbidden'}})).statusCode).toBe(400)
  } finally {await app.close()}
})
import { UiPerformanceStore } from './uiPerformance.js'
import type { UiPerformanceBatch } from '@voicechat/shared'
// @testCase T3
it('aggregates raw distributions, exact periods and filters, deduplicates batches and retains empty buckets', () => {
  let now=1000
  const store=new UiPerformanceStore(()=>now)
  const batch=(id:number,platform:'web'|'desktop',values:number[]):UiPerformanceBatch=>({schemaVersion:1,batchId:id.toString(16).padStart(32,'0'),samples:values.map(duration=>({metric:'chat_ready',route:'chat',platform,lifecycle:'cold',version:'1.2.3',age:0,duration}))})
  store.accept(batch(1,'web',[0,10,20,30])); store.accept(batch(1,'web',[999]))
  now=2000;store.accept(batch(2,'desktop',[100,200]))
  const q={from:1000,to:3000,buckets:4}
  const report=store.report(q)
  expect(report.metrics.find(m=>m.metric==='chat_ready')).toMatchObject({count:6,p50:20,p95:200})
  expect(report.trend[1]!.metrics.find(m=>m.metric==='chat_ready')).toMatchObject({count:0,p50:null})
  expect(store.report({...q,platform:'web'}).metrics.find(m=>m.metric==='chat_ready')).toMatchObject({count:4,p50:10,p95:30})
  expect(store.report({...q,to:2000}).metrics.find(m=>m.metric==='chat_ready')?.count).toBe(4)
  expect(store.report({...q,version:'unknown'}).metrics.every(m=>m.count===0)).toBe(true)
  now=8*86400000;expect(store.report(q).metrics.every(m=>m.count===0)).toBe(true)
})
