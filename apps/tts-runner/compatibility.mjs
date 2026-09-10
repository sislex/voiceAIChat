import assert from 'node:assert/strict'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({urls,token}) {
  const request=contractHttp(token),base=urls['tts-runner']
  await request(base,'/v1/health',{auth:'invalid',status:401})
  const voices=await request(base,'/v1/voices');assert.ok(voices.length>0,'Образу нужен хотя бы один голос')
  const run=await request(base,'/v1/runs',{method:'POST',status:202,body:{version:1,text:'Проверка независимого приложения.',voice:voices[0].id,engine:'piper',format:'wav'}})
  let result
  for(let attempt=0;attempt<60;attempt++){result=await request(base,`/v1/runs/${run.runId}`);if(['succeeded','failed','cancelled'].includes(result.status))break;await new Promise(resolve=>setTimeout(resolve,500))}
  assert.equal(result.status,'succeeded',JSON.stringify(result.error))
  const audio=await request(base,`/v1/runs/${run.runId}/audio`,{binary:true})
  assert.equal(audio.toString('ascii',0,4),'RIFF');assert.ok(audio.length>1000)
}
