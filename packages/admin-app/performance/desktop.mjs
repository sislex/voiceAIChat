import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron } from 'playwright'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve,join } from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const fixture=await mkdtemp(join(tmpdir(),'ui-performance-desktop-'))
const server=await createServer({root:resolve(root,'packages/admin-app/performance'),configFile:false,plugins:[react()],resolve:{alias:{'@shared':resolve(root,'packages/shared/src')}},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}}})
let app
try {

  await writeFile(join(fixture,'main.cjs'),"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({webPreferences:{preload:"+JSON.stringify(require.resolve('@sislexa/desktop/preload'))+",contextIsolation:true, sandbox:false}});w.loadURL(process.env.UI_PERFORMANCE_URL)});")
  await server.listen()
  app=await _electron.launch({executablePath:require('electron'),args:['--no-sandbox',join(fixture,'main.cjs')],env:{...process.env,UI_PERFORMANCE_URL:server.resolvedUrls.local[0]}})
  const page=await app.firstWindow()
  await page.getByRole('button',{name:'Apply filters'}).waitFor()
  // @testCase T1
  const result=await page.evaluate(async path=>{
    const {uiPerformance}=await import(path)
    let delivered
    window.api={'uiPerformance:send':async batch=>{delivered=batch}}
    const p=uiPerformance()
    p.beginMessage(false)
    await new Promise(r=>setTimeout(r,30))
    p.mark('message','message_first_token')
    p.finish('message','chat')
    await p.flush()
    return {kind:window.desktopHost?.kind,delivered}
  },'/@fs/'+resolve(root,'packages/ui/src/lib/uiPerformance.ts'))
  assert.equal(result.kind,'desktop')
  assert.equal(result.delivered.samples[0].platform,'desktop')
  assert(result.delivered.samples[0].duration>=20)
  console.log('Native Electron preload and monotonic telemetry: passed')
} finally {await app?.close();await server.close();await rm(fixture,{recursive:true,force:true})}
