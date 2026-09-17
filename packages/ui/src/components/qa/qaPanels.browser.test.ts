// @vitest-environment node
import { mkdir } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { resolve } from 'node:path'

let server:ChildProcess, browser:Browser
const root=resolve(__dirname,'../../../../..')
const port=19000+Math.floor(Math.random()*1000)
const base=`http://127.0.0.1:${port}`
const teardownTimeoutMs=120000

type QaPanelsCleanup=()=>void|Promise<void>
async function finishQaPanelsTeardown(...cleanups:QaPanelsCleanup[]){
  const results=await Promise.allSettled(cleanups.map(cleanup=>Promise.resolve().then(cleanup)))
  const errors=results.flatMap(result=>result.status==='rejected'?[result.reason]:[])
  if(errors.length===1)throw errors[0]
  if(errors.length>1)throw new AggregateError(errors,'QA panels teardown failed')
}
beforeAll(async()=>{
  await mkdir(resolve(root,'.generated_images'),{recursive:true})
  server=spawn('npm',['run','-w','@voicechat/ui','storybook','--','--ci','--no-open','--port',String(port)],{cwd:root,stdio:'ignore',detached:true})
  for(let index=0;index<100;index++){
    try{if((await fetch(base+'/iframe.html')).ok)break}catch{}
    if(index===99)throw new Error('Storybook did not start')
    await new Promise(resolve=>setTimeout(resolve,500))
  }
  browser=await chromium.launch()
},120000)
afterAll(async()=>{
  await finishQaPanelsTeardown(
    () => browser?.close(),
    () => { if(server?.pid)process.kill(-server.pid,'SIGTERM') },
  )
},teardownTimeoutMs)

// @testCase TC-01
it('waits for every QA panels teardown operation',async()=>{
  let releaseBrowser!:()=>void, releaseStorybook!:()=>void
  let finished=false
  const teardown=finishQaPanelsTeardown(
    ()=>new Promise<void>(resolve=>{releaseBrowser=resolve}),
    ()=>new Promise<void>(resolve=>{releaseStorybook=resolve}),
  ).then(()=>{finished=true})
  await vi.waitFor(()=>expect(releaseBrowser).toBeTypeOf('function'))
  await vi.waitFor(()=>expect(releaseStorybook).toBeTypeOf('function'))
  releaseBrowser()
  await Promise.resolve()
  expect(finished).toBe(false)
  releaseStorybook()
  await teardown
  expect(finished).toBe(true)
},30000)

// @testCase TC-03
it('finishes remaining teardown work and reports a real cleanup error',async()=>{
  const error=new Error('browser close failed')
  let storybookStopped=false
  await expect(finishQaPanelsTeardown(
    async()=>{throw error},
    async()=>{storybookStopped=true},
  )).rejects.toBe(error)
  expect(storybookStopped).toBe(true)
},30000)

// @testCase TC-02
// @testCase TC-04
// @testCase TC-08
it.each([
 ['qa-stage-runs--component-mobile','.component-qa-panel'],
 ['qa-stage-runs--integration-groups','.qa-stage-panel'],
 ['qa-stage-runs--automated-playwright-page-errors','.qa-stage-panel'],
 ['qa-stage-runs--automated-selective-retry','.qa-stage-panel'],
 ['qa-manual-qa--mobile-checklist','.manual-qa']
])('keeps %s usable at 390px without horizontal overflow',async(id,selector)=>{
 const page=await browser.newPage({viewport:{width:390,height:844}})
 try{
  await page.goto(base+'/iframe.html?id='+id+'&viewMode=story')
  await page.locator(selector).waitFor()
  await page.getByText('Что проверялось',{exact:true}).waitFor()
  await page.evaluate(()=>document.fonts.ready)
  const geometry=await page.locator(selector).evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,page:document.documentElement.scrollWidth,viewport:window.innerWidth}))
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1)
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport+1)
  for(const cell of await page.locator(selector+' .vc-results tbody tr td').all())expect(await cell.getAttribute('data-label')).toBeTruthy()
  const logs=page.getByText('Потоковый лог',{exact:true})
  if(await logs.count())expect(await logs.first().evaluate(element=>element.closest('details')?.open??element.closest('[aria-expanded]')?.getAttribute('aria-expanded'))).not.toBe(true)
  const image=page.getByRole('button',{name:'Увеличить: Снимок'})
  if(await image.count()){
   await image.click()
   await page.getByRole('dialog').waitFor()
   await page.keyboard.press('Escape')
   await page.getByRole('dialog').waitFor({state:'detached'})
  }
  await page.screenshot({path:resolve(root,'.generated_images/'+id+'.png'),fullPage:true})
 }finally{await page.close()}
},30000)
