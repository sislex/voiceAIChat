import assert from 'node:assert/strict'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({urls,token}) {
  const request=contractHttp(token),core=urls.voicechat,studio=urls['image-studio']
  const {token:auth}=await request(core,'/api/session/login',{method:'POST',body:{name:'admin',password:token}})
  const conversation=await request(core,'/api/conversations',{method:'POST',auth,body:{title:'Studio compatibility',assistantKind:'images'}})
  const path=`/api/image-studio/${conversation.id}/file`,data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64')
  await request(studio,path,{method:'POST',auth,body:{path:'contract.png',dataBase64:data.toString('base64')}})
  assert.deepEqual(await request(studio,path+'?path=contract.png',{auth,binary:true}),data)
  assert.deepEqual(await request(core,path+'?path=contract.png',{auth,binary:true}),data)
  await request(studio,path,{method:'POST',auth:'invalid',body:{path:'contract.png',dataBase64:data.toString('base64')},status:401})
  await request(core,'/internal/image-studio/core',{method:'POST',body:{method:'conversation',args:['admin',conversation.id]}})
  await request(studio,path+'?path=contract.png',{method:'DELETE',auth})
  await request(studio,path+'?path=contract.png',{auth,status:404})
}
