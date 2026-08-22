import { isMachineStoragePathAllowed, managedEnvironmentPaths, type ManagedEnvironmentPaths } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { ProductionTarget, ReleaseManager } from './releaseManager.js'

export interface ManagedPreflightResult {
  ok: boolean
  environment: 'production' | 'staging'
  paths: ManagedEnvironmentPaths
  checks: Record<'marker'|'manifest'|'origin'|'branch'|'write'|'freeSpace'|'deployCommand'|'healthCheckCommand', { ok: boolean; message: string }>
}
const quote=(value:string):string=>`'${value.replace(/'/g,`'"'"'`)}'`
const platformFor=(root:string):string=>/^(?:[A-Za-z]:[\\/]|\\\\)/.test(root)?'win32':'linux'

export class ManagedEnvironmentResolver {
  constructor(private readonly db:VoiceChatDb,private readonly releases:ReleaseManager,private readonly allowedDirsOf:(agentId:string)=>string[]=()=>[],private readonly minimumFreeBytes=512*1024*1024){}

  resolve(userId:string,projectId:string,kind:'production'|'staging'){
    const project=this.db.getProject(userId,projectId)
    if(!project?.productionAgentId||!project.gitUrl)throw new Error('Managed-машина или gitUrl не настроены')
    const machine=this.db.getProjectMachine(projectId,project.productionAgentId)
    if(!machine?.storageId||!machine.storageRoot)throw new Error('Для managed-окружения не настроено MachineStorage выбранной машины')
    if(!this.releases.isOnline(machine.agentId))throw new Error('Managed-машина offline')
    const platform=platformFor(machine.storageRoot)
    const paths=managedEnvironmentPaths(machine.storageRoot,projectId,kind,platform)
    if(!isMachineStoragePathAllowed(paths.root,this.allowedDirsOf(machine.agentId),platform))throw new Error('Managed-окружение находится вне разрешённых директорий машины')
    const assignment=machine.directories?.[kind]
    if(!assignment||assignment.override||assignment.path!==paths.root)throw new Error(`Managed-каталог ${kind} не является каноническим`)
    if(!project.productionDeployCommand?.trim()||!project.productionHealthCheckCommand?.trim())throw new Error('Deploy-команда или health-check не настроены')
    const target:ProductionTarget={projectId,agentId:machine.agentId,path:paths.repository,prepareCheckout:true,gitUrl:project.gitUrl,expectedRepository:project.gitUrl,baseBranch:project.ciBaseBranch||'main',testCommand:project.testCommand?.trim()||'npm run typecheck && npm run test',deployCommand:project.productionDeployCommand,healthCheckCommand:project.productionHealthCheckCommand,limits:project.releaseTimeouts,mode:'managed',managedRoot:paths.root,managedDirectories:[paths.app,paths.config,paths.logs,paths.artifacts,paths.temporary],managedManifestPath:paths.manifest,managedManifest:{formatVersion:1,projectId,kind,machineId:machine.agentId,storageId:machine.storageId}}
    return {target,paths,storageId:machine.storageId,storageRoot:machine.storageRoot}
  }

  async preflight(userId:string,projectId:string,kind:'production'|'staging'='production'):Promise<ManagedPreflightResult>{
    const {target,paths,storageId,storageRoot}=this.resolve(userId,projectId,kind)
    const separator=platformFor(storageRoot)==='win32'?'\\':'/'
    const marker=`${storageRoot}${separator}.voicechat${separator}storage.json`
    const manifest=JSON.stringify(target.managedManifest)
    const script=[
      `test ! -L ${quote(storageRoot)} && test ! -L ${quote(paths.root)}`,
      `test -r ${quote(marker)} && grep -F ${quote(storageId)} ${quote(marker)} >/dev/null`,
      `if [ -e ${quote(paths.manifest)} ]; then test \"$(tr -d '\\n\\r ' < ${quote(paths.manifest)})\" = ${quote(manifest)}; fi`,
      `if [ -e ${quote(paths.repository)} ]; then test -d ${quote(paths.repository+'/.'+'git')} && test \"$(git -C ${quote(paths.repository)} config --get remote.origin.url)\" = ${quote(target.gitUrl)} && test -z \"$(git -C ${quote(paths.repository)} status --porcelain)\"; fi`,
      `p=${quote(storageRoot+'/.voicechat-managed-probe-$')}; : > \"$p\" && rm -f \"$p\"`,
      `available=$(df -Pk ${quote(storageRoot)} | awk 'NR==2 {print $4*1024}'); test \"\${available:-0}\" -ge ${this.minimumFreeBytes}`
    ].join(' && ')
    const result=await this.releases.runPreflight(target,script)
    const ok=result.exitCode===0&&!result.timedOut
    const message=ok?'Проверка пройдена':result.output||'Managed preflight не пройден'
    const names=['marker','manifest','origin','branch','write','freeSpace','deployCommand','healthCheckCommand'] as const
    const checks=Object.fromEntries(names.map(name=>[name,{ok,message}])) as ManagedPreflightResult['checks']
    return {ok,environment:kind,paths,checks}
  }
}
