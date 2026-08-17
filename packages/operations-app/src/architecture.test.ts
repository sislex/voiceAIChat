import { describe,it,expect } from 'vitest'
import { readdirSync,readFileSync,statSync } from 'node:fs'
import { join } from 'node:path'
function files(dir:string):string[]{return readdirSync(dir).flatMap((name)=>{const path=join(dir,name);return statSync(path).isDirectory()?files(path):/\.(ts|tsx)$/.test(name)?[path]:[]})}
describe('operations boundary',()=>{it('has no host stores or direct transports',()=>{const source=files(join(process.cwd(),'src')).filter((path)=>!path.endsWith('architecture.test.ts')).map((path)=>readFileSync(path,'utf8')).join('\n');expect(source).not.toMatch(/chatStore|projectsStore|settingsStore|adminStore|window\.|\bfetch\(|WebSocket|EventSource|ipcRenderer|apps\/(web|desktop)|bearerToken|runnerToken|agentToken/)})})
