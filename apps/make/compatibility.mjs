// Verify MakeCore and the user workflow across two published images. Test data lives in an
// ephemeral compatibility environment; no external account is required.
import assert from 'node:assert/strict'
export async function verifyCompatibility({urls,token}) {
  const core=urls.voicechat,make=urls.make
  assert.ok(core&&make,'Матрице Make нужны ядро и приложение')
  const request=async(base,path,{method='GET',body,auth=token,status=200}={})=>{
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json',authorization:`Bearer ${auth}`},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15_000)})
    const text=await response.text();assert.equal(response.status,status,`${method} ${path}: ${text.slice(0,1000)}`)
    return text?JSON.parse(text):null
  }
  const login=await request(core,'/api/session/login',{method:'POST',body:{name:'admin',password:token}})
  assert.equal(typeof login.token,'string')
  const auth=login.token
  const project=await request(core,'/api/projects',{method:'POST',auth,body:{name:'Compatibility Make'}})
  const created=await request(core,'/api/conversations',{method:'POST',auth,body:{title:'Compatibility Make',assistantKind:'make',projectId:project.id}})
  const conversationId=created.id??created.conversation?.id
  assert.equal(typeof conversationId,'string')
  const rpc=async(method,...args)=>(await request(core,'/internal/make/core',{method:'POST',body:{method,args}})).result
  assert.equal((await rpc('conversation','admin',conversationId)).id,conversationId)
  assert.equal(await rpc('conversation','not-a-member',conversationId),null)
  assert.equal(await rpc('conversationOwner',conversationId),'admin')
  assert.equal(await rpc('conversationOwner','missing-conversation'),null)
  assert.equal(await rpc('conversationProject',conversationId),project.id)
  assert.equal(await rpc('isProjectViewer','not-a-member',conversationId),false)
  assert.ok((await rpc('makeConversationIdsOf','admin')).includes(conversationId))
  assert.equal((await rpc('project','admin',project.id)).id,project.id)
  assert.equal(await rpc('project','not-a-member',project.id),null)
  assert.equal(await rpc('userExists','admin'),true)
  assert.equal(await rpc('userExists','missing-user'),false)
  assert.deepEqual(await rpc('taskLinks',conversationId),[])
  assert.deepEqual(await rpc('linkableTasks','admin',conversationId),[])
  assert.equal(await rpc('taskDesigns','admin',project.id,'missing-task'),null)
  assert.equal(await rpc('machineFs.isOnline','missing-machine'),false)
  await rpc('boardChanged',project.id)
  await request(core,'/internal/make/core',{method:'POST',body:{method:'userExists',args:['admin']},auth:'wrong-token',status:401})
  const who=await request(core,'/internal/whoami',{method:'POST',body:{method:'GET',url:`/api/make/${conversationId}`,headers:{authorization:`Bearer ${auth}`}}})
  assert.equal(who.ok,true);assert.equal(who.user.name,'admin')
  await request(make,`/api/make/${conversationId}`,{auth:'wrong-token',status:401})
  const source='<html><head><title>Make compatibility</title></head><body>Independent Make</body></html>'
  await request(make,`/api/make/${conversationId}/file`,{method:'PUT',auth,body:{path:'index.html',content:source}})
  assert.equal((await request(make,`/api/make/${conversationId}/file?path=index.html`,{auth})).content,source)
  // Read the same file through the older core's HTTP bridge without rebuilding core.
  assert.equal((await request(core,`/api/make/${conversationId}/file?path=index.html`,{auth})).content,source)
  await request(make,`/api/make/${conversationId}/snapshots`,{method:'POST',auth,body:{label:'Compatibility'}})
  const snapshots=await request(make,`/api/make/${conversationId}/snapshots`,{auth})
  assert.ok(snapshots.some(item=>typeof item.id==='string'&&item.label==='Compatibility'))
  await request(core,'/internal/make/events',{method:'POST',body:{events:[{kind:'changed',userId:'admin',conversationId,rev:1,paths:['index.html']}]}})
  return {conversationId,auth,projectId:project.id,content:source}
}
