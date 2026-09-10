import fastify, {type FastifyInstance} from 'fastify'
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest'
import {chromium,type Browser,type Page} from 'playwright'
import {registerPreviewProxy} from '../apps/web-reader/src/routes/previewProxy.js'
import {readerProjectResource} from '../apps/server/src/readerBridge/projectResource.js'
let project:FastifyInstance,reader:FastifyInstance,browser:Browser,page:Page,base:string
const doc=(text:string)=>'<!doctype html><meta charset="utf-8"><body>'+text+'</body>'
const inner=()=>page.frameLocator('iframe')
async function open(url:string){await page.goto(base+'/host?url='+encodeURIComponent(url));await inner().locator('body').waitFor()}
describe('Reader: текущее приложение по постоянному адресу',()=>{
 beforeAll(async()=>{
  project=fastify();project.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(_req,body,done)=>done(null,body))
  project.get('/',async(_req,reply)=>reply.type('text/html; charset=utf-8').send(doc('<h1>Текущий проект</h1><script>document.body.dataset.hash=location.hash</script>')))
  project.get('/api/data',async req=>({query:req.query,cookie:req.headers.cookie??null,auth:req.headers.authorization??null}))
  project.get('/api/private',async(req,reply)=>req.headers.cookie?.includes('sid=logged')?{user:'nested'}:reply.code(401).send({error:'login'}))
  project.post('/api/login',async(req,reply)=>{if((req.body as{password:string}).password!=='fixture')return reply.code(401).send({error:'bad'});return reply.header('set-cookie','sid=logged; Secure; HttpOnly; Path=/').send({ok:true})})
  project.patch('/api/upload',async req=>({body:Buffer.from(req.body as Buffer).toString('hex'),type:req.headers['content-type']}))
  project.get('/redirect',async(_req,reply)=>reply.code(302).header('location','/done').header('set-cookie','redirect=ok; Secure; Path=/').send(''))
  project.get('/done',async(req,reply)=>reply.type('text/html; charset=utf-8').send(doc('<h1>Готово</h1><output>'+req.headers.cookie+'</output>')))
  project.get('/large',async(_req,reply)=>reply.type('text/plain').send('x'.repeat(5*1024*1024+1)))
  reader=fastify();reader.addHook('onRequest',async req=>{;(req as unknown as{user:{name:string;role:string}}).user={name:'own-project',role:'user'}})
  reader.get<{Querystring:{url:string}}>('/host',async(req,reply)=>reply.type('text/html').send('<!doctype html><iframe style="width:950px;height:700px" src="/api/preview?url='+encodeURIComponent(req.query.url)+'"></iframe>'))
  registerPreviewProxy(reader,{projectResource:request=>readerProjectResource(project,request)});base=await reader.listen({host:'127.0.0.1',port:0});browser=await chromium.launch()
 })
 beforeEach(async()=>{page=await browser.newPage();page.setDefaultTimeout(5000);await fetch(base+'/api/preview/reset-cookies',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})});afterEach(async()=>{await page?.close()});afterAll(async()=>{await browser?.close();await reader?.close();await project?.close()})
 it('открывает hash-страницу без DNS и операторских алиасов',async()=>{await open('https://app.internal/#/machines');await inner().getByRole('heading',{name:'Текущий проект'}).waitFor();expect(await inner().locator('body').getAttribute('data-hash')).toBe('#/machines')})
 it('скопированный адрес самого Reader ведёт к текущему приложению',async()=>{await open(base+'/#/settings');await inner().getByRole('heading',{name:'Текущий проект'}).waitFor();expect(await inner().locator('body').getAttribute('data-hash')).toBe('#/settings')})
 it('вложенная страница не получает сессию внешней панели',async()=>{const response=await page.request.get(base+'/api/preview?url='+encodeURIComponent('https://app.internal/api/private'),{headers:{authorization:'Bearer outer-token',cookie:'outer=private'}});expect(response.status()).toBe(401)})
 it('выполняет вложенный вход и отправляет Secure cookie в последующие fetch',async()=>{await open('https://app.internal/');const result=await inner().locator('body').evaluate(async()=>{const login=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture'})});const me=await fetch('/api/private');return{login:login.status,me:await me.json()}});expect(result).toEqual({login:200,me:{user:'nested'}})})
 it('разрешает API с query из страницы проекта',async()=>{await open('https://app.internal/');const data=await inner().locator('body').evaluate(async()=>await(await fetch('/api/data?a=1&a=2')).json());expect(data).toMatchObject({query:{a:['1','2']},auth:null})})
 it('передаёт бинарное тело PATCH без JSON-перекодирования',async()=>{await open('https://app.internal/');const data=await inner().locator('body').evaluate(async()=>await(await fetch('/api/upload',{method:'PATCH',headers:{'content-type':'application/octet-stream'},body:new Uint8Array([0,255,1])})).json());expect(data).toEqual({body:'00ff01',type:'application/octet-stream'})})
 it('применяет redirect, hash и промежуточную cookie',async()=>{await open('https://app.internal/redirect#/projects');await inner().getByRole('heading',{name:'Готово'}).waitFor();expect(await inner().locator('output').textContent()).toContain('redirect=ok');expect(await inner().locator('body').evaluate(()=>new URL(location.href).searchParams.get('url'))).toBe('https://app.internal/done#/projects')})
 it('показывает понятную ошибку рекурсивного Reader вместо зависания',async()=>{await open('https://app.internal/api/preview?url=https://app.internal/');await inner().getByRole('heading',{name:'Сайт не загрузился'}).waitFor();expect(await inner().locator('body').textContent()).toContain('нельзя открыть')})
 it('ограничивает большой ответ приложения',async()=>{const response=await page.request.get(base+'/api/preview?url='+encodeURIComponent('https://app.internal/large'));expect(response.status()).toBe(413);expect((await response.json()).error).toContain('5 MiB')})
 it('встроенная диагностика остаётся доступной после канонизации своего адреса',async()=>{await open(base+'/api/preview/diagnostics');await inner().locator('#voicechat-preview-inspector').waitFor({state:'attached'});expect(await inner().locator('body').textContent()).not.toContain('Сайт не загрузился')})
})
