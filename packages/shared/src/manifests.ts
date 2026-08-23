export const MANIFEST_FORMAT_VERSION = 1 as const

export type ManifestDiagnosticCode = 'absent' | 'corrupt' | 'unsupported' | 'conflict'
export class ManifestError extends Error {
  constructor(public readonly code: ManifestDiagnosticCode, public readonly path: string, message: string) {
    super(`${code}: ${path}: ${message}`); this.name = 'ManifestError'
  }
}
export interface EnvironmentManifest { formatVersion: 1; projectId: string; taskId?: string; kind: 'production'|'staging'|'test'|'preview'; machineId: string; storageId: string; createdAt: string }
export type RunManifestType = 'development'|'qa'|'merge'|'preview'|'release'
export interface RunManifest { formatVersion: 1; runId: string; runType: RunManifestType; initiator: string; machineId: string; workspace: string; branch: string; sourceCommit: string; createdAt: string; startedAt: string }
export type RunReportStatus = 'success'|'failed'|'cancelled'|'interrupted'
export interface ManifestCheck { name: string; status: 'passed'|'failed'|'skipped'; message?: string }
export interface ManifestErrorItem { code: string; message: string }
export interface ManifestArtifact { path: string; kind?: string }
export interface RunReportManifest { formatVersion: 1; runId: string; status: RunReportStatus; sourceCommit: string; finalCommit: string|null; checks: ManifestCheck[]; errors: ManifestErrorItem[]; artifacts: ManifestArtifact[]; finishedAt: string; interruptedAt?: string; cancelledAt?: string }

const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k)
const object=(v:unknown,path:string):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ManifestError('corrupt',path,'expected JSON object');return v as Record<string,unknown>}
const allow=(v:Record<string,unknown>,fields:readonly string[],path:string)=>{const extra=Object.keys(v).filter(k=>!fields.includes(k));if(extra.length)throw new ManifestError('corrupt',path,`unknown fields: ${extra.join(', ')}`)}
const text=(v:unknown,field:string,path:string)=>{if(typeof v!=='string'||!v.trim())throw new ManifestError('corrupt',path,`${field} must be a non-empty string`);return v}
const time=(v:unknown,field:string,path:string)=>{const s=text(v,field,path);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)||Number.isNaN(Date.parse(s)))throw new ManifestError('corrupt',path,`${field} must be a UTC ISO timestamp`);return s}
const commit=(v:unknown,field:string,path:string)=>{const s=text(v,field,path);if(!/^[0-9a-f]{7,64}$/i.test(s))throw new ManifestError('corrupt',path,`${field} must be a Git commit`);return s}
const version=(v:Record<string,unknown>,path:string)=>{if(!Number.isInteger(v.formatVersion))throw new ManifestError('corrupt',path,'formatVersion must be an integer');if(v.formatVersion!==MANIFEST_FORMAT_VERSION)throw new ManifestError('unsupported',path,`formatVersion ${String(v.formatVersion)} is not supported`)}
const oneOf=<T extends string>(v:unknown,values:readonly T[],field:string,path:string):T=>{if(typeof v!=='string'||!values.includes(v as T))throw new ManifestError('corrupt',path,`${field} has an invalid value`);return v as T}
const optional=(v:Record<string,unknown>,field:string,path:string)=>own(v,field)?text(v[field],field,path):undefined

export function parseEnvironmentManifest(value:unknown,path='environment.json'):EnvironmentManifest{
  const v=object(value,path);version(v,path);allow(v,['formatVersion','projectId','taskId','kind','machineId','storageId','createdAt'],path)
  const result:EnvironmentManifest={formatVersion:1,projectId:text(v.projectId,'projectId',path),kind:oneOf(v.kind,['production','staging','test','preview'],'kind',path),machineId:text(v.machineId,'machineId',path),storageId:text(v.storageId,'storageId',path),createdAt:time(v.createdAt,'createdAt',path)}
  const taskId=optional(v,'taskId',path);if(taskId)result.taskId=taskId
  if((result.kind==='test'||result.kind==='preview')&&!taskId)throw new ManifestError('corrupt',path,'taskId is required for task environments')
  if((result.kind==='production'||result.kind==='staging')&&taskId)throw new ManifestError('corrupt',path,'taskId is not allowed for project environments')
  return result
}
export function parseRunManifest(value:unknown,path='run.json'):RunManifest{
  const v=object(value,path);version(v,path);allow(v,['formatVersion','runId','runType','initiator','machineId','workspace','branch','sourceCommit','createdAt','startedAt'],path)
  return {formatVersion:1,runId:text(v.runId,'runId',path),runType:oneOf(v.runType,['development','qa','merge','preview','release'],'runType',path),initiator:text(v.initiator,'initiator',path),machineId:text(v.machineId,'machineId',path),workspace:text(v.workspace,'workspace',path),branch:text(v.branch,'branch',path),sourceCommit:commit(v.sourceCommit,'sourceCommit',path),createdAt:time(v.createdAt,'createdAt',path),startedAt:time(v.startedAt,'startedAt',path)}
}
export function validateArtifactPath(value:string):string{
  if(/^(?:[\\/]|[A-Za-z]:[\\/])/.test(value))throw new Error('artifact path must be relative')
  const normalized=value.replace(/\\/g,'/');if(!normalized||normalized.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('artifact path must stay inside managed storage');return normalized
}
export function parseRunReportManifest(value:unknown,path='report.json'):RunReportManifest{
  const v=object(value,path);version(v,path);allow(v,['formatVersion','runId','status','sourceCommit','finalCommit','checks','errors','artifacts','finishedAt','interruptedAt','cancelledAt'],path)
  if(!Array.isArray(v.checks)||!Array.isArray(v.errors)||!Array.isArray(v.artifacts))throw new ManifestError('corrupt',path,'checks, errors and artifacts must be arrays')
  const status=oneOf(v.status,['success','failed','cancelled','interrupted'],'status',path)
  const checks=v.checks.map((item,index)=>{const i=object(item,path);allow(i,['name','status','message'],path);const r:ManifestCheck={name:text(i.name,`checks[${index}].name`,path),status:oneOf(i.status,['passed','failed','skipped'],`checks[${index}].status`,path)};const message=optional(i,'message',path);if(message)r.message=message;return r})
  const errors=v.errors.map((item,index)=>{const i=object(item,path);allow(i,['code','message'],path);return {code:text(i.code,`errors[${index}].code`,path),message:text(i.message,`errors[${index}].message`,path)}})
  const artifacts=v.artifacts.map((item,index)=>{const i=object(item,path);allow(i,['path','kind'],path);let safe:string;try{safe=validateArtifactPath(text(i.path,`artifacts[${index}].path`,path))}catch(error){throw new ManifestError('corrupt',path,error instanceof Error?error.message:String(error))}const r:ManifestArtifact={path:safe};const kind=optional(i,'kind',path);if(kind)r.kind=kind;return r})
  const result:RunReportManifest={formatVersion:1,runId:text(v.runId,'runId',path),status,sourceCommit:commit(v.sourceCommit,'sourceCommit',path),finalCommit:v.finalCommit===null?null:commit(v.finalCommit,'finalCommit',path),checks,errors,artifacts,finishedAt:time(v.finishedAt,'finishedAt',path)}
  if(own(v,'interruptedAt'))result.interruptedAt=time(v.interruptedAt,'interruptedAt',path);if(own(v,'cancelledAt'))result.cancelledAt=time(v.cancelledAt,'cancelledAt',path)
  if(status==='interrupted'&&!result.interruptedAt)throw new ManifestError('corrupt',path,'interruptedAt is required');if(status==='cancelled'&&!result.cancelledAt)throw new ManifestError('corrupt',path,'cancelledAt is required')
  return result
}
export function parseManifestJson<T>(json:string,path:string,parser:(value:unknown,path:string)=>T):T{let value:unknown;try{value=JSON.parse(json)}catch(error){throw new ManifestError('corrupt',path,error instanceof Error?error.message:String(error))}return parser(value,path)}
export function serializeManifest<T>(value:T,parser:(value:unknown,path:string)=>T,path='manifest.json'):string{return JSON.stringify(parser(value,path),null,2)+'\n'}
export function assertManifestEquivalent<T>(existing:T,expected:T,path:string):void{if(JSON.stringify(existing)!==JSON.stringify(expected))throw new ManifestError('conflict',path,'existing manifest differs from canonical state')}
