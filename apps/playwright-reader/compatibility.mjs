import assert from 'node:assert/strict'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({urls,token}) {
  const request=contractHttp(token),core=urls.voicechat,reader=urls['playwright-reader']
  const {token:auth}=await request(core,'/api/session/login',{method:'POST',body:{name:'admin',password:token}})
  const conversation=await request(core,'/api/conversations',{method:'POST',auth,body:{title:'Reader compatibility',assistantKind:'playwright-reader'}})
  const path=`/api/browser/${conversation.id}`,session=await request(reader,path+'/start',{method:'POST',auth,body:{viewport:{width:800,height:600}}})
  assert.equal(typeof session.incarnation,'string')
  try {
    const status=await request(core,path+'/command',{method:'POST',auth,body:{incarnation:session.incarnation,command:{type:'status'}}})
    assert.equal(status.incarnation,session.incarnation)
    await request(reader,path+'/command',{method:'POST',auth:'invalid',body:{command:{type:'status'}},status:401})
    const result=await request(reader,path+'/command',{method:'POST',auth,body:{incarnation:session.incarnation,command:{type:'inspect',action:{kind:'evaluate',code:'1+2'}}}})
    assert.equal(result.value,3)
  }finally{await request(reader,path,{method:'DELETE',auth})}
}
