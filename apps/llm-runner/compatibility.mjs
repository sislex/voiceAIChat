import assert from 'node:assert/strict'
import { contractHttp } from '../../scripts/application-contract-http.mjs'
export async function verifyCompatibility({urls,token}) {
  const request=contractHttp(token)
  for(const service of ['runner-work','runner-personal']) {
    const base=urls[service],health=await request(base,'/v1/health')
    assert.equal(health.ok,true);assert.ok(health.bins.claude.present||health.bins.codex.present)
    await request(base,'/v1/run',{method:'POST',body:{},status:400})
    await request(base,'/v1/health',{auth:'invalid',status:401})
    // Работа с пустым профилем не требует внешнего аккаунта и не запускает LLM.
    assert.ok(Array.isArray(await request(base,'/v1/fs/cc/projects?userId=release-contract')))
  }
}
