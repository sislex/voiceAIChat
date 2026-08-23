import { randomUUID } from 'node:crypto'
import { ManifestError, assertManifestEquivalent, parseManifestJson } from '@voicechat/shared'

export interface RemoteManifestFs {
  read(machineId:string,path:string):Promise<{dataBase64?:string}>
  write(machineId:string,path:string,dataBase64:string):Promise<unknown>
  mkdir(machineId:string,path:string):Promise<unknown>
  rename(machineId:string,from:string,to:string):Promise<unknown>
  delete(machineId:string,path:string):Promise<unknown>
}
export type ManifestParser<T>=(value:unknown,path:string)=>T
const parent=(path:string):string=>{const normalized=path.replace(/[\\/]+$/,'');const index=Math.max(normalized.lastIndexOf('/'),normalized.lastIndexOf('\\'));if(index<1)throw new Error(`Manifest path has no target directory: ${path}`);return normalized.slice(0,index)}
const encoded=(value:string)=>Buffer.from(value,'utf8').toString('base64')

export async function readRemoteManifest<T>(fs:RemoteManifestFs,machineId:string,path:string,parser:ManifestParser<T>):Promise<T>{
  let file:{dataBase64?:string}
  try{file=await fs.read(machineId,path)}catch(error){throw new ManifestError('absent',path,error instanceof Error?error.message:String(error))}
  if(typeof file.dataBase64!=='string')throw new ManifestError('corrupt',path,'remote file has no data')
  return parseManifestJson(Buffer.from(file.dataBase64,'base64').toString('utf8'),path,parser)
}

/** Publish once through a temporary file in the target directory. Existing valid equivalent files are confirmed; all others are preserved. */
export async function publishRemoteManifest<T>(fs:RemoteManifestFs,machineId:string,path:string,value:T,parser:ManifestParser<T>):Promise<'created'|'confirmed'>{
  const expected=parser(value,path)
  try{const current=await readRemoteManifest(fs,machineId,path,parser);assertManifestEquivalent(current,expected,path);return 'confirmed'}
  catch(error){if(!(error instanceof ManifestError)||error.code!=='absent')throw error}
  const directory=parent(path),temp=`${path}.tmp-${randomUUID()}`
  await fs.mkdir(machineId,directory)
  try{
    await fs.write(machineId,temp,encoded(JSON.stringify(expected,null,2)+'\n'))
    try{const current=await readRemoteManifest(fs,machineId,path,parser);assertManifestEquivalent(current,expected,path);return 'confirmed'}
    catch(error){if(!(error instanceof ManifestError)||error.code!=='absent')throw error}
    await fs.rename(machineId,temp,path)
    const published=await readRemoteManifest(fs,machineId,path,parser)
    assertManifestEquivalent(published,expected,path)
    return 'created'
  }finally{try{await fs.delete(machineId,temp)}catch{/* temp may already have been renamed */}
  }
}
