import { describe, expect, it } from 'vitest'
import { createRemotePlaywrightReader, createHttpPlaywrightReaderCore } from './index.js'
describe('HTTP-контракты Playwright без импорта API/Chromium', () => {
  it('сохраняет null для iframe и точный адрес службы', async () => {
    let seen: unknown
    const client = createRemotePlaywrightReader({baseUrl:'http://reader/',token:'internal',fetchImpl:async(url,init)=>{seen={url,headers:init?.headers,body:JSON.parse(String(init?.body))};return new Response(JSON.stringify({result:null}))}})
    expect(await client.execute('u','c',{kind:'read'})).toBeNull()
    expect(seen).toMatchObject({url:'http://reader/internal/playwright-reader/service',headers:{authorization:'Bearer internal'},body:{method:'execute',args:['u','c',{kind:'read'}]}})
  })
  it('недоступность Chromium не превращается в успешный iframe fallback', async () => {
    const client=createRemotePlaywrightReader({baseUrl:'http://reader',token:'internal',fetchImpl:async()=>new Response(JSON.stringify({error:'runner offline'}),{status:503})})
    await expect(client.control('u','c',{type:'status'})).rejects.toThrow('runner offline')
  })
  it('HTTP-порт ядра сохраняет отказ в доступе к разговору', async () => {
    const client=createHttpPlaywrightReaderCore({coreUrl:'http://core',token:'internal',fetchImpl:async()=>new Response(JSON.stringify({result:null}))})
    expect(await client.conversation('other','private')).toBeNull()
  })
})
