import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import axe from 'axe-core'
import os from 'node:os'
const root=fileURLToPath(new URL('.',import.meta.url))
// A competing gate invalidates the fixed resource profile; do not hide it as a regression.
const runs=resolve(root,'../../../.long-runs')
for(const name of await readdir(runs).catch(()=>[])){
  if(!name.endsWith('.json')) continue
  const run=JSON.parse(await readFile(resolve(runs,name),'utf8'))
  if(run.state==='running'){
    let alive=false
    try{process.kill(run.pid,0);alive=true}catch{}
    if(alive) throw new Error('Non-reproducible environment: wait for the active repository gate '+run.runId)
  }
}
const baseline=JSON.parse(await readFile(new URL('./baseline.json',import.meta.url),'utf8'))
const qa=process.argv.includes('--qa')
const regression=process.argv.includes('--regression')
if(baseline.schemaVersion!==1 || baseline.repeats!==7 || !baseline.mount || !baseline.filter) throw new Error('Missing or incompatible versioned baseline')
const server=await createServer({root,configFile:false,plugins:[react()],resolve:{alias:{'@shared':resolve(root,'../../shared/src')}},server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../../..')]}}})
await server.listen()
const url=server.resolvedUrls.local[0]
let browser
const results={ environment:{node:process.version,nodeMajor:process.versions.node.split('.')[0],cpu:os.cpus()[0].model,parallelism:os.availableParallelism(),browser:'',platform:process.platform,viewport:'1280x720',cpuSlowdown:4,repeats:7},mount:[],filter:[],qa:[] }
try {
  browser=await chromium.launch({headless:true})
  results.environment.browser=browser.version()
  if(['platform','browser','cpu','parallelism','nodeMajor'].some(key=>results.environment[key]!==baseline.environment[key])) throw new Error('Non-reproducible environment: expected '+JSON.stringify(baseline.environment)+'; actual '+JSON.stringify(results.environment))
  // @testCase T4
  if(qa) for(const [width,height] of [[1440,900],[1280,720],[768,1024],[390,844],[320,700]]) for(const theme of ['light','dark']) for(const state of ['ready','empty','insufficient','loading','error','offline','updating','stale']) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:true,colorScheme:theme})
    const page=await context.newPage()
    const safeArea=await context.newCDPSession(page)
    await safeArea.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:30,bottom:30,left:20,right:20}})
    await page.goto(url+'?theme='+theme+'&state='+state)
    await page.getByRole('button',{name:'Apply filters'}).waitFor()
    if(state==='ready') await page.getByText('Sufficient sample',{exact:true}).first().waitFor()
    if(state==='empty') await page.getByText('No observations',{exact:true}).waitFor()
    if(state==='insufficient') await page.getByText('Insufficient sample: minimum 20',{exact:true}).first().waitFor()
    if(state==='error') await page.getByText(/Could not load UI performance/).waitFor()
    if(['offline','updating','stale'].includes(state)) {
      await page.getByText('Sufficient sample',{exact:true}).first().waitFor()
      if(state==='offline') { await context.setOffline(true); await page.getByText(/Offline — displayed data/).waitFor() }
      else {
        await page.getByRole('button',{name:'Apply filters'}).click()
        await page.getByText(state==='updating'?'Updating…':/Could not load UI performance/).waitFor()
        assert(await page.getByText('Sufficient sample',{exact:true}).first().isVisible(),'Existing observations disappeared')
      }
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow')
    assert(await page.locator('.ui-performance').evaluate(el=>parseFloat(getComputedStyle(el).paddingTop)>=30),'Safe-area padding missing')
    await page.addScriptTag({content:axe.source})
    const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('.ui-performance'))).violations)
    assert.deepEqual(violations.map(v=>v.id),[],'Accessibility violations')
    const input=page.getByLabel('Version',{exact:true})
    await input.tap(); assert(await input.evaluate(el=>el===document.activeElement),'Touch focus')
    await page.keyboard.press('Tab')
    assert(await page.getByRole('button',{name:'Apply filters'}).evaluate(el=>el===document.activeElement),'Keyboard order')
    await input.focus()
    const before=await page.evaluate(()=>visualViewport.height)
    await page.setViewportSize({width,height:Math.max(240,height-300)})
    assert(await page.evaluate(()=>visualViewport.height)<before,'Visual viewport did not shrink')
    await input.scrollIntoViewIfNeeded()
    assert(await input.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=visualViewport.height && r.top>=0}),'Focused input obscured')
    for(const control of await page.locator('input,select,button,summary').all()) {
      if(!await control.isVisible()) continue
      await control.scrollIntoViewIfNeeded()
      assert(await control.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el || el.contains(hit)}),'An action is overlapped')
    }
    if(state==='ready' && (width===390 || width===1440)) {
      await page.setViewportSize({width,height})
      await mkdir(resolve(root,'artifacts'),{recursive:true})
      await page.screenshot({path:resolve(root,'artifacts',`dashboard-${width}-${theme}.png`),fullPage:true})
    }
    results.qa.push({width,height,theme,state,keyboard:'visual viewport resize emulation',passed:true})
    await context.close()
  }
  // @testCase T5
  if(!qa) for(let i=0;i<baseline.repeats;i++){
    const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'})
    const page=await context.newPage()
    const cdp=await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
    await page.goto(url+'?delay='+(regression?1000:0))
    await page.getByText('Sufficient sample',{exact:true}).first().waitFor()
    results.mount.push(await page.evaluate(()=>performance.now()))
    await page.getByLabel('platform',{exact:true}).selectOption('web')
    const start=await page.evaluate(()=>performance.now())
    await page.getByRole('button',{name:'Apply filters'}).click()
    await page.getByText(/Applied filters:.*web/).waitFor()
    results.filter.push(await page.evaluate(()=>performance.now())-start)
    await context.close()
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
  const comparisons=qa?[]:['mount','filter'].map(metric=>{
    const after=median(results[metric]),before=baseline[metric].medianMs
    const limit=before*(1+baseline.relativeThreshold)+baseline.absoluteThresholdMs
    return {metric,before,after,delta:after-before,limit,pass:after<=limit}
  })
  await mkdir(resolve(root,'artifacts'),{recursive:true})
  await writeFile(resolve(root,'artifacts',qa?'qa.json':regression?'regression.json':'budget.json'),JSON.stringify({...results,comparisons},null,2))
  console.log(JSON.stringify({qa:results.qa.length,comparisons},null,2))
  if(comparisons.some(c=>!c.pass)) process.exitCode=1
} finally {await browser?.close();await server.close()}
