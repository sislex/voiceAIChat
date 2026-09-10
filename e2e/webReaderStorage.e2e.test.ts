import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page, type FrameLocator } from 'playwright'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'
let app: FastifyInstance, browser: Browser, page: Page, base: string
const site = 'http://storage-cycle.machine.internal:5173'
const a = () => page.frameLocator('iframe[title=a]'), peer = () => page.frameLocator('iframe[title=peer]'), b = () => page.frameLocator('iframe[title=b]')
const db = async (frame: FrameLocator, name: string): Promise<string> => frame.locator('body').evaluate((_el, name) => new Promise<string>((resolve, reject) => { const req=indexedDB.open(name);req.onsuccess=()=>{const name=req.result.name;req.result.close();resolve(name)};req.onerror=()=>reject(req.error) }), name)

describe('Reader: настоящий Storage и IndexedDB в Chromium', () => {
  beforeAll(async () => {
    app=fastify();app.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user={name:'storage-e2e',role:'user'} })
    app.get<{Querystring:{blocked?:string}}>('/host', async (req,reply)=>reply.type('text/html').send('<!doctype html><script>localStorage.setItem("host-token","host-private")</script>'+[['a',site+(req.query.blocked?'/blocked':'/a')],['peer',site+'/peer'],['b','http://other-storage.machine.internal:5173/b']].map(([title,url])=>'<iframe title="'+title+'" src="/api/preview?url='+encodeURIComponent(url)+'"></iframe>').join('')))
    registerPreviewProxy(app,{machines:{canUse:async()=>true,bridge:{isOnline:()=>true,http:async()=>({status:200,headers:{'content-type':'text/html'},bodyBase64:Buffer.from('<!doctype html><h1>Storage QA</h1>').toString('base64')})}}})
    base=await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch()
  })
  beforeEach(async()=>{page=await browser.newPage();page.setDefaultTimeout(5000);await page.goto(base+'/host');await a().getByRole('heading').waitFor();await peer().getByRole('heading').waitFor();await b().getByRole('heading').waitFor()})
  afterEach(async()=>{await page?.close()});afterAll(async()=>{await browser?.close();await app?.close()})
  it('читает сохранённое значение через свойство Storage',async()=>{expect(await a().locator('body').evaluate(()=>{localStorage.setItem('name','Аня');return localStorage.name})).toBe('Аня')})
  it('присваивание свойства переживает reload и не пишет в host',async()=>{await a().locator('body').evaluate(()=>{localStorage.name='Анна';location.reload()});await a().getByRole('heading').waitFor();await expect.poll(()=>a().locator('body').evaluate(()=>localStorage.getItem('name'))).toBe('Анна');expect(await page.evaluate(()=>localStorage.getItem('name'))).toBeNull()})
  it('delete изолирован от другого сайта и от sessionStorage',async()=>{
    await b().locator('body').evaluate(()=>{localStorage.name='other'})
    expect(await a().locator('body').evaluate(()=>{localStorage.name='mine';sessionStorage.name='session';delete localStorage.name;return {local:localStorage.getItem('name'),session:sessionStorage.name}})).toEqual({local:null,session:'session'})
    expect(await b().locator('body').evaluate(()=>localStorage.name)).toBe('other')
  })
  it('Object.keys и JSON не перечисляют методы или токен host',async()=>{expect(await a().locator('body').evaluate(()=>{localStorage.one='1';return {keys:Object.keys(localStorage),json:JSON.stringify(localStorage),has:'one' in localStorage,length:localStorage.length}})).toEqual({keys:['one'],json:'{"one":"1"}',has:true,length:1})})
  it('сохраняет Storage prototype и стабильные методы',async()=>{expect(await a().locator('body').evaluate(()=>({instance:localStorage instanceof Storage,proto:Object.getPrototypeOf(localStorage)===Storage.prototype,tag:Object.prototype.toString.call(localStorage),method:localStorage.getItem===localStorage.getItem}))).toEqual({instance:true,proto:true,tag:'[object Storage]',method:true})})
  it('приводит индекс key и проверяет обязательные параметры',async()=>{expect(await a().locator('body').evaluate(()=>{localStorage.one='1';let missing=false;try{Reflect.apply(localStorage.setItem,localStorage,['bad'])}catch{missing=true}return{first:localStorage.key(NaN),negative:localStorage.key(-1),missing}})).toEqual({first:'one',negative:null,missing:true})})
  it('storage events передают логические ключ, URL и storageArea только своему сайту',async()=>{
    for(const frame of [peer(),b()])await frame.locator('body').evaluate(()=>{const w=window as unknown as{events:unknown[]};w.events=[];addEventListener('storage',event=>w.events.push({key:event.key,url:event.url,own:event.storageArea===localStorage,value:event.newValue}))})
    await a().locator('body').evaluate(()=>{localStorage.shared='updated'})
    await expect.poll(()=>peer().locator('body').evaluate(()=>(window as unknown as{events:unknown[]}).events)).toEqual([{key:'shared',url:site+'/a',own:true,value:'updated'}])
    expect(await b().locator('body').evaluate(()=>(window as unknown as{events:unknown[]}).events)).toEqual([])
  })
  it('databases перечисляет только базы текущего логического origin',async()=>{await db(a(),'mine');await db(b(),'other');expect(await a().locator('body').evaluate(async()=>(await indexedDB.databases()).map(db=>db.name))).toEqual(['mine']);expect(await b().locator('body').evaluate(async()=>(await indexedDB.databases()).map(db=>db.name))).toEqual(['other'])})
  it('IDBDatabase.name и deleteDatabase используют исходное имя',async()=>{expect(await db(a(),'logical')).toBe('logical');await a().locator('body').evaluate(()=>new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('logical');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)}));expect(await a().locator('body').evaluate(()=>indexedDB.databases())).toEqual([])})
  it('запрет localStorage не ломает загрузку страницы и оставляет временное хранилище',async()=>{
    await page.addInitScript(()=>{if(location.pathname==='/api/preview'&&location.search.includes('%2Fblocked'))Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError')}})})
    await page.goto(base+'/host?blocked=1');await a().getByRole('heading').waitFor()
    expect(await a().locator('body').evaluate(()=>{localStorage.temporary='ready';return localStorage.getItem('temporary')})).toBe('ready')
    expect(await a().locator('#voicechat-preview-inspector').count()).toBe(1)
  })
})
