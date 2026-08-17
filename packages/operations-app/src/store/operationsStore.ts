import type { CcItem, CcProject, CcSession } from '@shared/cc'
import type { CxItem, CxProject, CxSession } from '@shared/codexSessions'
import type { SessionUsage } from '@shared/types'
import type { KbDocument, KbSearchResult, KbStatus } from '@shared/kb'
import type { CiRunSummary } from '@shared/ci'
import type { DiagnosticRecord, MachineCatalog, MachineCatalogEntry, MachineUtilityKind, OperationsDependencies, TerminalSession } from '../contracts'
import { redactDiagnostics } from '../redaction'
import { createController } from '../controllers/createController'
import { createStoreCore, type Store } from './core'

export interface OperationsState {
  machines: readonly MachineCatalogEntry[]; machinesLoading: boolean; machinesError: string|null
  utility: { kind: MachineUtilityKind; agentId: string; cwd: string; revealFile?: boolean }|null
  console: { running: boolean; output: string; error: string|null }
  terminal: { sessionId: string|null; output: string; error: string|null }
  explorer: { cwd: string; loading: boolean; result: unknown; error: string|null }
  observer: { engine:'claude'|'codex'; projects:(CcProject|CxProject)[]; sessions:(CcSession|CxSession)[]; transcript:(CcItem|CxItem)[]; usage:SessionUsage|null; loading:boolean; error:string|null }
  knowledge: { status:KbStatus|null; query:string; results:KbSearchResult[]; document:KbDocument|null; loading:boolean; error:string|null }
  ci: { runs:CiRunSummary[]; loading:boolean; error:string|null }
  diagnostics: { records:DiagnosticRecord[]; loading:boolean; error:string|null }
}
export interface OperationsActions {
  refreshMachines():Promise<void>; applyMachines(value:readonly MachineCatalogEntry[]):void
  openUtility(kind:MachineUtilityKind, agentId?:string, path?:string, revealFile?:boolean):void; closeUtility():void
  runConsole(command:string):Promise<void>; openTerminal():Promise<void>; terminalInput(data:string):void; terminalResize(cols:number,rows:number):void; closeTerminal():void
  explore(path:string):Promise<void>; closeExplorer():void
  openObserver(engine:'claude'|'codex'):Promise<void>; selectObserverProject(project:string):Promise<void>; selectObserverSession(project:string,id:string):Promise<void>; closeObserver():void; resumeObserver():Promise<string|null>
  searchKnowledge(query:string):Promise<void>; openKnowledgeDocument(id:string):Promise<void>; closeKnowledge():void
  refreshCi():Promise<void>; openCiTask(projectId:string,taskId:string):void; closeCi():void
  collectDiagnostics():Promise<void>; closeDiagnostics():void; reset():void
}
export type OperationsStore=Store<OperationsState,OperationsActions>
const initial=():OperationsState=>({machines:[],machinesLoading:false,machinesError:null,utility:null,console:{running:false,output:'',error:null},terminal:{sessionId:null,output:'',error:null},explorer:{cwd:'',loading:false,result:null,error:null},observer:{engine:'claude',projects:[],sessions:[],transcript:[],usage:null,loading:false,error:null},knowledge:{status:null,query:'',results:[],document:null,loading:false,error:null},ci:{runs:[],loading:false,error:null},diagnostics:{records:[],loading:false,error:null}})
export function createOperationsStore(deps:OperationsDependencies):OperationsStore {
  const core=createStoreCore(initial()); const controllers={machines:createController(),console:createController(),terminal:createController(),explorer:createController(),observer:createController(),knowledge:createController(),ci:createController(),diagnostics:createController()}
  let terminal:TerminalSession|null=null
  const set=core.setState, state=core.getState
  const catalog:MachineCatalog={get:()=>state().machines,subscribe:core.subscribe}
  const cleanupTerminal=()=>{controllers.terminal.reset();terminal?.close();terminal=null;set({terminal:{sessionId:null,output:'',error:null}})}
  core.onDispose(()=>Object.values(controllers).forEach((controller)=>controller.dispose()))
  core.onDispose(()=>{terminal?.close();terminal=null})
  const actions:OperationsActions={
    async refreshMachines(){const token=controllers.machines.guard();set({machinesLoading:true,machinesError:null});try{const machines=await deps.machines.list();if(controllers.machines.current(token))set({machines,machinesLoading:false})}catch(error){if(controllers.machines.current(token))set({machinesLoading:false,machinesError:String(error)})}},
    applyMachines(machines){set({machines})},
    openUtility(kind,agentId,path,revealFile){const machine=state().machines.find((item)=>item.id===agentId&&item.online)??state().machines.find((item)=>item.online);if(!machine)return;set({utility:{kind,agentId:machine.id,cwd:path??machine.policy.allowedDirs[0]??'',...(revealFile?{revealFile}: {})},explorer:{...state().explorer,cwd:path??state().explorer.cwd}})},
    closeUtility(){set({utility:null})},
    async runConsole(command){const target=state().utility;if(!target||target.kind!=='console')return;const token=controllers.console.guard();set({console:{running:true,output:state().console.output,error:null}});try{const result=await deps.console.exec(target.agentId,command);if(controllers.console.current(token))set({console:{running:false,output:state().console.output+result.output,error:null}})}catch(error){if(controllers.console.current(token))set({console:{running:false,output:state().console.output,error:String(error)}})}},
    async openTerminal(){const target=state().utility;if(!target||target.kind!=='terminal')return;cleanupTerminal();const token=controllers.terminal.guard();try{const next=await deps.terminal.open(target.agentId,target.cwd);if(!controllers.terminal.current(token)){next.close();return}terminal=next;set({terminal:{sessionId:next.id,output:'',error:null}});controllers.terminal.own(next.onOutput((output)=>{if(terminal===next)set({terminal:{...state().terminal,output:state().terminal.output+output}})}));controllers.terminal.own(next.onExit(()=>{if(terminal===next){terminal=null;set({terminal:{...state().terminal,sessionId:null}})}}))}catch(error){if(controllers.terminal.current(token))set({terminal:{sessionId:null,output:'',error:String(error)}})}},
    terminalInput(data){if(terminal&&state().terminal.sessionId===terminal.id)terminal.input(data)},terminalResize(cols,rows){if(terminal&&state().terminal.sessionId===terminal.id)terminal.resize(cols,rows)},closeTerminal:cleanupTerminal,
    async explore(path){const target=state().utility;if(!target||target.kind!=='explorer')return;const token=controllers.explorer.guard();set({explorer:{...state().explorer,cwd:path,loading:true,error:null}});try{const result=await deps.files.list(target.agentId,path);if(controllers.explorer.current(token)&&state().utility?.agentId===target.agentId&&state().explorer.cwd===path)set({explorer:{cwd:path,loading:false,result,error:null}})}catch(error){if(controllers.explorer.current(token))set({explorer:{...state().explorer,loading:false,error:String(error)}})}},closeExplorer(){controllers.explorer.reset();set({explorer:{...state().explorer,loading:false,error:null}})},
    async openObserver(engine){controllers.observer.reset();set({observer:{...state().observer,engine,projects:[],sessions:[],transcript:[],usage:null,loading:true,error:null}});const token=controllers.observer.guard();try{const projects=engine==='claude'?await deps.observer.claudeProjects():await deps.observer.codexProjects();if(controllers.observer.current(token))set({observer:{...state().observer,projects,loading:false}})}catch(error){if(controllers.observer.current(token))set({observer:{...state().observer,loading:false,error:String(error)}})}},
    async selectObserverProject(project){const engine=state().observer.engine;const token=controllers.observer.guard();set({observer:{...state().observer,sessions:[],transcript:[],loading:true,error:null}});try{const sessions=engine==='claude'?await deps.observer.claudeSessions(project):await deps.observer.codexSessions(project);if(controllers.observer.current(token))set({observer:{...state().observer,sessions,loading:false}})}catch(error){if(controllers.observer.current(token))set({observer:{...state().observer,loading:false,error:String(error)}})}},
    async selectObserverSession(project,id){const engine=state().observer.engine;controllers.observer.reset();const token=controllers.observer.guard();set({observer:{...state().observer,transcript:[],usage:null,loading:true,error:null}});try{const result=engine==='claude'?await deps.observer.claudeTranscript(project,id):await deps.observer.codexTranscript(id);if(!controllers.observer.current(token))return;set({observer:{...state().observer,transcript:result.items,usage:result.usage,loading:false}});const off=engine==='claude'?deps.observer.subscribeClaude(project,id,(items)=>{if(controllers.observer.current(token))set({observer:{...state().observer,transcript:[...state().observer.transcript,...items].slice(-4000)}})}):deps.observer.subscribeCodex(id,(items)=>{if(controllers.observer.current(token))set({observer:{...state().observer,transcript:[...state().observer.transcript,...items].slice(-4000)}})});controllers.observer.own(off)}catch(error){if(controllers.observer.current(token))set({observer:{...state().observer,loading:false,error:String(error)}})}},
    closeObserver(){controllers.observer.reset();set({observer:{...state().observer,projects:[],sessions:[],transcript:[],usage:null,loading:false,error:null}})},async resumeObserver(){return deps.chat.resume(state().observer.engine,null,String((state().observer.sessions[0] as {id?:string}|undefined)?.id??''))},
    async searchKnowledge(query){const token=controllers.knowledge.guard();set({knowledge:{...state().knowledge,query,loading:true,error:null}});try{const [status,results]=await Promise.all([deps.knowledge.status(),deps.knowledge.search(query)]);if(controllers.knowledge.current(token))set({knowledge:{...state().knowledge,status,results,loading:false}})}catch(error){if(controllers.knowledge.current(token))set({knowledge:{...state().knowledge,loading:false,error:String(error)}})}},
    async openKnowledgeDocument(id){const token=controllers.knowledge.guard();set({knowledge:{...state().knowledge,loading:true,error:null}});try{const document=await deps.knowledge.document(id);if(controllers.knowledge.current(token))set({knowledge:{...state().knowledge,document,loading:false}})}catch(error){if(controllers.knowledge.current(token))set({knowledge:{...state().knowledge,loading:false,error:String(error)}})}},closeKnowledge(){controllers.knowledge.reset();set({knowledge:{...state().knowledge,loading:false,error:null}})},
    async refreshCi(){const token=controllers.ci.guard();set({ci:{...state().ci,loading:true,error:null}});try{const runs=await deps.ci.list();if(controllers.ci.current(token))set({ci:{runs,loading:false,error:null}})}catch(error){if(controllers.ci.current(token))set({ci:{...state().ci,loading:false,error:String(error)}})}},openCiTask(projectId,taskId){deps.projects.openTask(projectId,taskId)},closeCi(){controllers.ci.reset();set({ci:{...state().ci,loading:false,error:null}})},
    async collectDiagnostics(){const token=controllers.diagnostics.guard();set({diagnostics:{...state().diagnostics,loading:true,error:null}});try{const records=(await deps.diagnostics.collect()).map((record)=>({...record,value:redactDiagnostics(record.value)}));if(controllers.diagnostics.current(token))set({diagnostics:{records,loading:false,error:null}})}catch(error){if(controllers.diagnostics.current(token))set({diagnostics:{...state().diagnostics,loading:false,error:String(error)}})}},closeDiagnostics(){controllers.diagnostics.reset();set({diagnostics:{...state().diagnostics,loading:false,error:null}})},
    reset(){Object.values(controllers).forEach((controller)=>controller.reset());terminal?.close();terminal=null;set(initial())}
  }
  const unsubscribe=deps.machines.subscribe?.((machines)=>actions.applyMachines(machines));if(unsubscribe)core.onDispose(unsubscribe)
  return {getState:core.getState,subscribe:core.subscribe,actions,dispose:core.dispose,...({catalog} as object)} as OperationsStore
}
export function machineCatalog(store:OperationsStore):MachineCatalog{return {get:()=>store.getState().machines,subscribe:store.subscribe}}
