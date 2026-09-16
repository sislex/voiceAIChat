import { expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import type { TemporaryCleanup } from './service.js'
import { registerCleanupRoutes } from './module.js'

// @testCase TC-07
it('authorizes the actual read-only route by both project and task and exposes no path deletion API', async () => {
  const app=Fastify()
  app.addHook('preHandler', async (req, reply) => {
    if (!req.headers.authorization) return reply.code(401).send({error:'unauthorized'})
    req.user={name:req.headers.authorization} as NonNullable<typeof req.user>
  })
  const getCiTask=vi.fn(async (user: string,project: string,task: string) => user==='member'&&project==='p'&&task==='t'?{id:'t'}:null)
  const snapshot=vi.fn(async () => ({candidates:[],attempts:[]}))
  registerCleanupRoutes(app,{tasks:{getCiTask}} as unknown as VoiceChatDb,{snapshot,acquire:async()=>async()=>{}} as unknown as TemporaryCleanup)
  const url='/api/projects/p/tasks/t/temporary-resources'
  try {
    expect((await app.inject({method:'GET',url})).statusCode).toBe(401)
    expect((await app.inject({method:'GET',url,headers:{authorization:'stranger'}})).statusCode).toBe(404)
    expect((await app.inject({method:'GET',url:url.replace('/t/','/foreign/'),headers:{authorization:'member'}})).statusCode).toBe(404)
    expect(snapshot).not.toHaveBeenCalled()
    expect((await app.inject({method:'GET',url,headers:{authorization:'member'}})).json()).toEqual({candidates:[],attempts:[]})
    expect(snapshot).toHaveBeenCalledOnce()
    expect(snapshot).toHaveBeenCalledWith('p','t')
    expect((await app.inject({method:'DELETE',url,headers:{authorization:'member'},payload:{path:'/tmp'}})).statusCode).toBe(404)
  } finally { await app.close() }
})
