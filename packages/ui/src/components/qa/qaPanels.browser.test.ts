// @vitest-environment node
import { mkdir } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { resolve } from 'node:path'

let server:ChildProcess, browser:Browser
const root=resolve(__dirname,'../../../../..')
const port=19000+Math.floor(Math.random()*1000)
const base=`http://127.0.0.1:${port}`
beforeAll(async()=>{
  await mkdir(resolve(root,'.generated_images'),{recursive:true})
  server=spawn('npm',['run','-w','@voicechat/ui','storybook','--','--ci','--no-open','--port',String(port)],{cwd:root,stdio:'ignore',detached:true})
  for(let index=0;index<100;index++){
    try{if((await fetch(base+'/iframe.html')).ok)break}catch{}
    if(index===99)throw new Error('Storybook did not start')
    await new Promise(resolve=>setTimeout(resolve,500))
  }
  browser=await chromium.launch()
  // Прогреваем самый тяжёлый lazy-модуль до старта таймера параметризованных
  // проверок. Готовность Storybook shell не означает, что story module уже
  // скомпилирован Vite; именно холодная компиляция делала первый tab случайным.
  const warmup=await browser.newPage({viewport:{width:390,height:844}})
  try{
    const response=await warmup.goto(base+'/iframe.html?id=projects-projectsettings--general-mobile&viewMode=story',{waitUntil:'domcontentloaded',timeout:30000})
    if(!response?.ok())throw new Error(`ProjectSettings warmup failed: HTTP ${response?.status()??'no response'}`)
    await warmup.getByTestId('project-settings').waitFor({state:'visible',timeout:30000})
  }finally{await warmup.close()}
},120000)
afterAll(async()=>{
  await browser?.close()
  if(server?.pid)try{process.kill(-server.pid,'SIGTERM')}catch{}
},120000)

// @testCase TC-INTEGRATION-06
it.each([
 ['qa-stage-runs--component-mobile','.component-qa-panel'],
 ['qa-stage-runs--integration-groups','.qa-stage-panel'],
 ['qa-stage-runs--automated-playwright-page-errors','.qa-stage-panel'],
 ['qa-stage-runs--automated-selective-retry','.qa-stage-panel'],
 ['qa-manual-qa--mobile-checklist','.manual-qa']
])('keeps %s usable at 390px without horizontal overflow',async(id,selector)=>{
 const page=await browser.newPage({viewport:{width:390,height:844}})
 try{
  const response=await page.goto(base+'/iframe.html?id='+id+'&viewMode=story',{waitUntil:'domcontentloaded',timeout:15000})
  if(!response?.ok())throw new Error(`Story ${id} failed to load: HTTP ${response?.status()??'no response'}`)
  await page.locator(selector).waitFor({state:'visible',timeout:15000})
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

const projectSettingsStories = [
 ['general','projects-projectsettings--general-mobile'],
 ['llm','projects-projectsettings--llm-mobile'],
 ['board','projects-projectsettings--board-mobile'],
 ['workflow','projects-projectsettings--workflow-mobile'],
 ['members','projects-projectsettings--members-mobile'],
 ['machines','projects-projectsettings--machines-responsive']
] as const

// @testCase TC-UI-01
it.each(projectSettingsStories)('keeps ProjectSettings %s usable at 390x844',async(tab,id)=>{
 const page=await browser.newPage({viewport:{width:390,height:844}})
 try{
  const response=await page.goto(base+'/iframe.html?id='+id+'&viewMode=story',{waitUntil:'domcontentloaded',timeout:15000})
  if(!response?.ok())throw new Error(`ProjectSettings ${tab} failed to load: HTTP ${response?.status()??'no response'}`)
  const settings=page.getByTestId('project-settings')
  await settings.waitFor({state:'visible',timeout:15000})
  await page.getByRole('tab',{selected:true}).waitFor({state:'visible',timeout:5000})
  await page.evaluate(()=>document.fonts.ready)
  const geometry=await page.evaluate(()=>{
   const form=document.querySelector<HTMLElement>('.project-settings-form')
   const panel=document.querySelector<HTMLElement>('[data-testid="project-settings-scroll"]')
   return {
    page:document.documentElement.scrollWidth,viewport:window.innerWidth,
    form:form&&[form.clientWidth,form.scrollWidth],panel:panel&&[panel.clientWidth,panel.scrollWidth]
   }
  })
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport+1)
  expect(geometry.form?.[1]).toBeLessThanOrEqual((geometry.form?.[0]??0)+1)
  expect(geometry.panel?.[1]).toBeLessThanOrEqual((geometry.panel?.[0]??0)+1)
  const selected=page.getByRole('tab',{selected:true})
  expect(await selected.getAttribute('tabindex')).toBe('0')
  expect(await selected.evaluate(element=>{const tab=element.getBoundingClientRect();const list=element.parentElement!.getBoundingClientRect();return tab.left>=list.left-1&&tab.right<=list.right+1})).toBe(true)
  for(const cell of await page.locator('.proj-machines-table tbody td').all())expect(await cell.getAttribute('data-label')).toBeTruthy()
  await page.screenshot({path:resolve(root,'.generated_images/project-settings-'+tab+'.png'),fullPage:true})
 }finally{await page.close()}
},30000)
