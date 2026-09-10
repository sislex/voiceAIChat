import { beforeAll,afterAll,expect,it } from 'vitest'
import { createServer,type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium,type Browser,type Page } from 'playwright'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
let server:ViteDevServer,browser:Browser,page:Page,base:string
const errors:string[]=[]
beforeAll(async()=>{
 const root=resolve(__dirname,'..')
 server=await createServer({configFile:false,root,plugins:[react(),{name:'release-fixture',configureServer(server){server.middlewares.use('/',async(req,res,next)=>{if(req.url!=='/'&&req.url!=='/?fixture')return next();res.setHeader('content-type','text/html');res.end(await server.transformIndexHtml('/', '<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/e2e/fixtures/application-releases/main.tsx"></script></body></html>'))})}}],resolve:{alias:[{find:/^@shared\//,replacement:root+'/packages/shared/src/'}]},server:{host:'127.0.0.1',port:0},logLevel:'error'})
 await server.listen();base=server.resolvedUrls!.local[0]
 browser=await chromium.launch();page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));await page.goto(base)
})
afterAll(async()=>{await browser?.close();await server?.close()})
it('установка приложения в браузере обновляет версию, digest и историю',async()=>{
 await page.getByRole('checkbox').check()
 await expect.poll(()=>page.getByText('Выбранный состав совместим с окружением.').isVisible()).toBe(true)
 await page.getByRole('button',{name:'Установить выбранные версии'}).click()
 await expect.poll(()=>page.getByText('make 1.1.0 · Установлен',{exact:true}).count()).toBeGreaterThan(0)
 await page.getByText('Артефакты установленной версии',{exact:true}).click()
 await expect.poll(()=>page.getByText('registry.test/make@sha256:'+'b'.repeat(64),{exact:true}).first().isVisible()).toBe(true)
 const path=process.env.VC_VISUAL_ARTIFACTS??'/tmp/voicechat-application-releases-browser';await mkdir(path,{recursive:true});await page.screenshot({path:resolve(path,'release-center-desktop.png'),fullPage:true})
})
it('несовместимая production-версия блокирует действие и панель помещается на мобильном экране',async()=>{
 await page.reload();await page.getByRole('combobox',{name:'Окружение'}).selectOption('production');await page.getByRole('checkbox').check();await expect.poll(()=>page.getByText(/core 2.0.0: требуется/).isVisible()).toBe(true);expect(await page.getByRole('button',{name:'Установить выбранные версии'}).isDisabled()).toBe(true)
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 const path=process.env.VC_VISUAL_ARTIFACTS??'/tmp/voicechat-application-releases-browser';await page.screenshot({path:resolve(path,'release-center-mobile.png'),fullPage:true});expect(errors).toEqual([])
})
