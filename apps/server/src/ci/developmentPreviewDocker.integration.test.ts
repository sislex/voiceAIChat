import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { DEFAULT_DEVELOPMENT_PREVIEW, DEFAULT_CI_BROWSER_CHECK } from '@voicechat/shared'
import { createDevelopmentDockerRuntime } from './developmentPreviewDocker.js'
import { previewResourceName, type PreviewRuntimeInput, type PreviewRuntimeHandle } from './developmentPreview.js'
import type { CommandExecutor } from './types.js'

const enabled = process.env.VC_TEST_DEVELOPMENT_DOCKER === '1'
const temp: string[]=[]
afterEach(()=>{for(const path of temp.splice(0))rmSync(path,{recursive:true,force:true})})
describe.skipIf(!enabled)('real development Docker isolation',()=>{
  it.each(['explicit','auto'] as const)('uses changed %s worktree code, creates an independent SQLite database, restricts egress and removes resources',async(mode)=>{
    const workspace=mkdtempSync(join(tmpdir(),'chat447-preview-'));temp.push(workspace)
    execFileSync('git',['init','-q'],{cwd:workspace})
    execFileSync('git',['-c','user.name=Preview','-c','user.email=preview@example.invalid','commit','--allow-empty','-qm','fixture'],{cwd:workspace})
    const serverSource = (value:string) => `const fs=require('node:fs'),http=require('node:http'),Database=require('better-sqlite3');
      const db=new Database('/preview-data/test.sqlite');db.exec("CREATE TABLE IF NOT EXISTS fixture(value TEXT); INSERT INTO fixture VALUES ('seed')");
      http.createServer(async(req,res)=>{if(req.url==='/gateway'){const reply=await fetch('http://gateway:8790/v1/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'fixture',userId:'other-user',cwd:'/production'})});res.end(await reply.text());return}if(req.url==='/egress'){try{await fetch('http://1.1.1.1',{signal:AbortSignal.timeout(500)});res.end('allowed')}catch{res.end('blocked')}return}
      res.end(JSON.stringify({value:${JSON.stringify(value)},seed:db.prepare('SELECT value FROM fixture').get().value,envFile:fs.existsSync('/app/.env'),home:fs.existsSync('/root/.ssh'),webBuilt:fs.existsSync('/app/apps/web/dist/index.html')}))}).listen(Number(process.env.PORT),'0.0.0.0');`
    const sourceFile = mode === 'auto' ? 'apps/server/src/index.ts' : 'demo.cjs'
    if (mode === 'auto') {
      mkdirSync(join(workspace,'apps/server/src'),{recursive:true})
      mkdirSync(join(workspace,'apps/web'),{recursive:true})
      writeFileSync(join(workspace,'package.json'),JSON.stringify({private:true,workspaces:['apps/web']}))
      writeFileSync(join(workspace,'apps/web/package.json'),JSON.stringify({name:'@voicechat/web',scripts:{build:'node build.cjs'}}))
      writeFileSync(join(workspace,'apps/web/build.cjs'),"const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','changed frontend')")
    }
    writeFileSync(join(workspace,sourceFile),serverSource('changed'))
    writeFileSync(join(workspace,'.env'),'VC_DB_URL=postgres://production/forbidden')
    const grantServer=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='DELETE'?{revoked:true}:req.url==='/v1/run'?{operation:'generate'}:{id:'grant-fixture',token:'test-scoped-capability'}))})
    await new Promise<void>((resolve)=>grantServer.listen(0,'0.0.0.0',resolve))
    const port=(grantServer.address() as {port:number}).port
    const address=Object.values(networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal)?.address
    if(!address)throw Error('no_test_network')
    const executor:CommandExecutor={run:(req,chunk,signal)=>new Promise((resolve,reject)=>{
      const child=spawn('/bin/bash',['-c',req.script],{cwd:req.workdir,env:{PATH:process.env.PATH,HOME:process.env.HOME},signal})
      child.stdout.on('data',(d:Buffer)=>void chunk(d.toString()));child.stderr.on('data',(d:Buffer)=>void chunk(d.toString()))
      child.on('error',reject);child.on('exit',exitCode=>resolve({exitCode,timedOut:false}))
    })}
    const image=execFileSync('docker',['image','inspect',process.env.VC_TEST_PREVIEW_IMAGE??'voicechat-app-test/core:1.0.0','--format','{{.Id}}'],{encoding:'utf8'}).trim()
    const guardImage=execFileSync('docker',['image','inspect','chat447-network-guard','--format','{{.Id}}'],{encoding:'utf8'}).trim()
    const runtime=createDevelopmentDockerRuntime({executor,enabled:true,image,guardImage,engine:async()=>({id:'fixture',baseUrl:'http://'+address+':'+port,token:'not-production'})})
    const input:PreviewRuntimeInput={projectId:'fixture',taskId:'task',runId:workspace,agentId:'test',userId:'user',workspace,kind:'claude',model:'sonnet',
      settings:{...DEFAULT_DEVELOPMENT_PREVIEW,enabled:true,application:mode === 'auto' ? 'auto' : 'fixture',startCommand:mode === 'auto' ? 'auto' : 'node demo.cjs',startupTimeoutMs:60000},check:{...DEFAULT_CI_BROWSER_CHECK,mode:'off'}}
    const handle:PreviewRuntimeHandle={resourceName:previewResourceName(input.projectId,input.taskId,input.runId),grantId:null,runnerId:null}
    try{
      const first=await runtime.prepare(input,handle,AbortSignal.timeout(60000),async()=>{})
      const url=first.url.replace('test.machine.internal','127.0.0.1')
      expect(await (await fetch(url)).json()).toEqual({value:'changed',seed:'seed',envFile:false,home:false,webBuilt:mode === 'auto'})
      expect(await (await fetch(url+'egress')).text()).toBe('blocked')
      expect(await (await fetch(url+'gateway')).json()).toEqual({operation:'generate'})
      await runtime.stop(input,handle)
      writeFileSync(join(workspace,sourceFile),serverSource('restarted'))
      const second=await runtime.prepare(input,handle,AbortSignal.timeout(60000),async()=>{})
      expect(second.configDigest).not.toBe(first.configDigest)
      expect((await (await fetch(second.url.replace('test.machine.internal','127.0.0.1'))).json() as {value:string}).value).toBe('restarted')
    }finally{await runtime.stop(input,handle);await new Promise<void>(resolve=>grantServer.close(()=>resolve()))}
    expect(execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project='+handle.resourceName],{encoding:'utf8'}).trim()).toBe('')
    expect(execFileSync('docker',['volume','ls','-q','--filter','label=com.docker.compose.project='+handle.resourceName],{encoding:'utf8'}).trim()).toBe('')
  },180000)
})
