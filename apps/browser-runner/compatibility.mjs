import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({urls,token}) {
  const request=contractHttp(token),base=urls['browser-runner'],sessionId=randomUUID()
  await request(base,'/v1/health',{auth:'invalid',status:401})
  const session=await request(base,'/v1/sessions',{method:'POST',body:{sessionId,userKey:'release-contract',conversationKey:sessionId,profileMode:'ephemeral',viewport:{width:800,height:600,deviceScaleFactor:1}}})
  assert.equal(session.id??session.sessionId,sessionId)
  const command=async(command,binary=false)=>request(base,`/v1/sessions/${sessionId}/commands`,{method:'POST',binary,body:{requestId:randomUUID(),incarnation:session.incarnation,actor:'assistant',command}})
  try {
    assert.equal((await command({type:'status'})).incarnation,session.incarnation)
    assert.equal((await command({type:'inspect',action:{kind:'evaluate',code:'1 + 2'}})).value,3)
    assert.ok((await command({type:'screenshot'},true)).length>100)
  } finally { assert.equal((await request(base,`/v1/sessions/${sessionId}`,{method:'DELETE'})).stopped,true) }
}
