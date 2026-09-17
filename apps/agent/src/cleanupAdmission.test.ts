import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AgentToServer } from '@voicechat/shared'
const state=vi.hoisted(()=>({running:0,ptys:0,calls:[] as Array<{command:string;emit:(m:AgentToServer)=>void}>}))
const instances: FakeWS[]=[]
class FakeWS extends EventEmitter {
  static OPEN=1
  readyState=1
  sent: string[]=[]
  constructor(_url:string){super();instances.push(this)}
  send(s:string){this.sent.push(s)}
  close(){this.emit('close')}
}
vi.mock('ws',()=>({default:FakeWS}))
vi.mock('./exec.js',()=>({
  runningCount:()=>state.running,cancelCommand:vi.fn(),
  runCommand:(_id:string,command:string,_timeout:number,emit:(m:AgentToServer)=>void)=>{state.calls.push({command,emit})}
}))
vi.mock('./pty.js',()=>({ptyCount:()=>state.ptys,startPty:vi.fn(),writePty:vi.fn(),resizePty:vi.fn(),killPty:vi.fn()}))
vi.mock('./imageHost.js',()=>({ensureImageDir:vi.fn(),localAddresses:()=>[],startImageHost:async()=>null}))
vi.mock('./telemetry.js',()=>({createTelemetryCollector:()=>({collect:async()=>null})}))
const { startConnection } = await import('./connection.js')
afterEach(()=>{state.running=0;state.ptys=0;state.calls=[];instances.length=0})
const cleanup='# voicechat-cleanup-v1 12345678-1234-1234-1234-123456789abc\ntrue'
function send(ws:FakeWS,t:string,extra:Record<string,unknown>={}){ws.emit('message',JSON.stringify({t,...extra}))}
// @testCase TC-03
it.each(['running','ptys'] as const)('refuses cleanup while %s consumers exist',kind=>{
  state[kind]=1
  const conn=startConnection({serverUrl:'ws://x',token:'t',rootDir:'/tmp'})
  const ws=instances.at(-1)!
  send(ws,'exec.start',{execId:'cleanup',command:cleanup,timeoutMs:1000})
  expect(state.calls).toHaveLength(0)
  expect(ws.sent.map(s=>JSON.parse(s))).toContainEqual(expect.objectContaining({t:'exec.error',message:'cleanup_or_consumer_busy'}))
  conn.stop()
})
// @testCase TC-03
it('blocks new exec, PTY and filesystem writes until the cleanup process actually exits',()=>{
  const conn=startConnection({serverUrl:'ws://x',token:'t',rootDir:'/tmp'})
  const ws=instances.at(-1)!
  send(ws,'exec.start',{execId:'cleanup',command:cleanup,timeoutMs:1000})
  expect(state.calls[0].command).toContain('export VC_CLEANUP_ADMISSION=')
  send(ws,'exec.start',{execId:'new',command:'true',timeoutMs:1000})
  send(ws,'pty.start',{ptyId:'preview',cols:80,rows:24})
  send(ws,'fs.write',{opId:'write',path:'/tmp/not-created',dataBase64:''})
  send(ws,'fs.read',{opId:'read',path:'/tmp/not-created'})
  expect(state.calls).toHaveLength(1)
  const messages=ws.sent.map(s=>JSON.parse(s))
  expect(messages).toContainEqual(expect.objectContaining({t:'exec.error',execId:'new'}))
  expect(messages).toContainEqual(expect.objectContaining({t:'pty.error',ptyId:'preview'}))
  expect(messages).toContainEqual(expect.objectContaining({t:'fs.error',opId:'write'}))
  expect(messages).toContainEqual(expect.objectContaining({t:'fs.error',opId:'read'}))
  state.running = 1
  state.calls[0].emit({t:'exec.error',execId:'cleanup',message:'signal failed'})
  send(ws,'exec.start',{execId:'still-blocked',command:'true',timeoutMs:1000})
  expect(state.calls).toHaveLength(1)
  state.running = 0
  state.calls[0].emit({t:'exec.done',execId:'cleanup',exitCode:0})
  send(ws,'exec.start',{execId:'after',command:'true',timeoutMs:1000})
  expect(state.calls).toHaveLength(2)
  conn.stop()
})
