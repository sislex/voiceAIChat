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
