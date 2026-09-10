import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({urls,token}) {
  const request=contractHttp(token),base=urls['stt-runner']
  await request(base,'/v1/health',{auth:'invalid',status:401})
  const health=await request(base,'/v1/health');assert.equal(health.whisper.available,true)
  const models=await request(base,'/v1/models');assert.ok(models.length>=3)
  await request(base,'/v1/models/invalid/download',{method:'POST',status:400})
  // Модели монтируются отдельно: отсутствие модели обязано возвращать
  // протокольную ошибку, а не запускать неограниченное скачивание во время релиза.
  await new Promise((resolve,reject)=>{
    const socket=new WebSocket(base.replace(/^http/,'ws')+'/v1/transcribe',{headers:{authorization:`Bearer ${token}`}})
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('STT не ответил по WS'))},10_000)
    socket.on('open',()=>socket.send(JSON.stringify({t:'start',schemaVersion:99,runId:'contract'})))
    socket.on('message',data=>{try{const result=JSON.parse(data.toString());assert.equal(result.t,'error');assert.equal(result.code,'invalid_request');clearTimeout(timer);socket.close();resolve()}catch(error){clearTimeout(timer);socket.terminate();reject(error)}})
    socket.on('error',error=>{clearTimeout(timer);reject(error)})
  })
}
