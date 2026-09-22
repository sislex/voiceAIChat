import { randomUUID } from 'node:crypto'
import { machinePreviewUrl } from '@voicechat/browser-contracts/playwrightReader'
import { type BrowserCommand, type BrowserInspectResult, type DevelopmentBrowserEvidence } from '@voicechat/shared'
import type { BrowserRunnerClient } from '@sislexa/playwright-reader/browser-runner/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REST } from '@voicechat/shared'
import { DevelopmentPreviewError, redactPreviewLog, type DevelopmentPreviewRuntime } from './developmentPreview.js'

/** Observe the task session the model actually opened; an empty or unrelated page never passes. */
export function developmentBrowserCheck(browser: BrowserRunnerClient, proxyBase: string, shotsRoot: string): NonNullable<DevelopmentPreviewRuntime['check']> {
  return async (input, status, signal) => {
    if (!status.url || !status.sha || !status.configDigest) throw new DevelopmentPreviewError('evidence_missing','Preview target identity is incomplete')
    const sessionId = 'task-' + input.taskId
    const session = await browser.start({sessionId,userKey:input.userId,conversationKey:sessionId})
    const expected = machinePreviewUrl(proxyBase,status.url)
    if (session.currentUrl !== status.url && session.currentUrl !== expected) throw new DevelopmentPreviewError('browser_navigation_failed','Model has not opened the exact preview URL in this task session')
    const calls: DevelopmentBrowserEvidence['calls'] = []
    const send = async (tool: string, command: BrowserCommand) => {
      const result = await browser.command(sessionId,{requestId:randomUUID(),incarnation:session.incarnation,actor:'assistant',command},signal)
      if (('ok' in result && !result.ok) || ('error' in result && result.error)) throw new DevelopmentPreviewError('browser_unavailable','Browser ' + tool + ' failed')
      calls.push({tool,at:Date.now(),ok:true})
      return result
    }
    await send('open',{type:'navigate',url:session.currentUrl})
    await send('read',{type:'selector',action:{kind:'read',limit:5000}})
    const consoleResult = await send('errors',{type:'inspect',action:{kind:'console',level:'error',limit:50}}) as BrowserInspectResult
    const network = await send('network',{type:'inspect',action:{kind:'network',failedOnly:true,limit:50}}) as BrowserInspectResult
    const a11y = await send('a11y',{type:'selector',action:{kind:'a11y',limit:100}})
    const styles = await send('styles',{type:'inspect',action:{kind:'styles',selector:'body',properties:['display','visibility','overflow']}}) as BrowserInspectResult
    const shot = await browser.screenshot(sessionId,{requestId:randomUUID(),incarnation:session.incarnation,actor:'assistant',command:{type:'screenshot',format:'png',animations:'disabled'}},signal)
    const directory = join(shotsRoot,input.runId), name = Date.now() + '.png'
    mkdirSync(directory,{recursive:true})
    writeFileSync(join(directory,name),shot.buffer,{flag:'wx'})
    const saved = {url:REST.ciRunBrowserShot(input.runId,name)}
    calls.push({tool:'screenshot',at:Date.now(),ok:true})
    return {
      url:status.url,sha:status.sha,configDigest:status.configDigest,viewport:session.viewport,calls,screenshots:[saved.url],
      findings:{
        console:(consoleResult.console ?? []).map((e)=>redactPreviewLog(e.text)),
        runtime:(consoleResult.console ?? []).filter((e)=>e.sourceType==='pageerror').map((e)=>redactPreviewLog(e.text)),
        network:(network.network ?? []).filter((e)=>!e.ok).map((e)=>redactPreviewLog(e.method + ' ' + e.url + ' ' + e.status)),
        a11y:['text' in a11y ? redactPreviewLog(a11y.text ?? '') : ''],
        styles:[JSON.stringify(styles.styles ?? {})]
      }
    }
  }
}
