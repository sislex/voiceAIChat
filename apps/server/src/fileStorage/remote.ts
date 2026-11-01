import { readFile } from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Readable } from 'node:stream'
import { STORAGE_REST, STORAGE_ERROR_STATUS, type StorageError, type StorageEntry, type StorageThumbnailSize } from '@voicechat/shared/fileStorage'
import type { FileStorageService, WriteStorageFileOptions } from '../../../../packages/file-storage/src/service.js'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'
import { storageBytes, type StorageBody } from '../../../../packages/file-storage/src/client.js'
import type { FileStorageConfig } from './config.js'

type Json = Record<string, unknown> | unknown[]
const tenantContext = new AsyncLocalStorage<string | undefined>()
export function withStorageTenant<T>(tenantId: string | undefined, run: () => Promise<T>): Promise<T> {
  return tenantContext.run(tenantId, run)
}

export async function createRemoteStorageRuntime(config: FileStorageConfig) {
  const token = (await readFile(config.serviceTokenFile!, 'utf8')).trim()
  if (!token) throw new Error('File storage service token is empty')
  const base = config.url!
  const headers = (userId: string, extra?: Record<string, string>) => {
    const tenant = tenantContext.getStore()
    return { authorization: `Bearer ${token}`, 'x-sislexa-user': userId,
      ...(tenant ? {'x-sislexa-tenant': tenant} : {}), ...extra }
  }
  const call = async (userId: string, path: string, init: RequestInit = {}) => {
    let response: Response
    try { response = await fetch(base + path, {...init, headers: {...headers(userId), ...init.headers}}) }
    catch { throw new StorageServiceError('storage_unavailable') }
    if (!response.ok) {
      let error: Partial<StorageError> = {}
      try { error = await response.json() as StorageError } catch { /* invalid upstream error */ }
      const code = error.error
      if (code && code in STORAGE_ERROR_STATUS)
        throw new StorageServiceError(code)
      throw new StorageServiceError(response.status === 503 ? 'storage_unavailable' : 'node_unavailable')
    }
    return response
  }
  const json = async <T>(user: string, path: string, method = 'GET', body?: Json): Promise<T> =>
    (await call(user, path, {method, ...(body === undefined ? {} : {body: JSON.stringify(body), headers: {'content-type':'application/json'}})})).json() as Promise<T>
  const query = (path: string, values: Record<string, string | number | boolean | undefined>) => {
    const url = new URL(path, 'http://storage')
    for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, String(value))
    return url.pathname + url.search
  }
  const statFile = async (user: string, space: string, path: string): Promise<StorageEntry> => {
    const result = await json<{entries: StorageEntry[]}>(user, query(STORAGE_REST.files(space), {prefix:path}))
    const entry = result.entries.find(item => item.path === path)
    if (!entry) throw new StorageServiceError('not_found')
    return entry
  }
  const openFile = async (u:string,s:string,path:string,range?:string) => {
    const response = await call(u,query(STORAGE_REST.file(s),{path}),{headers:range?{range}:{}})
    return {stream: Readable.fromWeb(response.body! as never), contentLength:Number(response.headers.get('content-length') ?? 0), contentRange:response.headers.get('content-range') ?? undefined}
  }
  const writeFile = async (u:string,s:string,path:string,body:StorageBody,options:WriteStorageFileOptions={}) => {
    const response=await call(u,query(STORAGE_REST.file(s),{path}),{method:'PUT',body:body as never,duplex:'half',headers:{'content-type':options.mimeType ?? 'application/octet-stream',...(options.size===undefined?{}:{'content-length':String(options.size)}),...(options.ifMatch===undefined?{}:{'if-match':String(options.ifMatch)}),...(options.createOnly?{'if-none-match':'*'}:{})}} as RequestInit)
    return response.json()
  }
  const service = {
    createUpload: (u:string,s:string,r:Json) => json(u, STORAGE_REST.uploads(s), 'POST', r),
    fileUrl: (u:string,s:string,r:Json) => json(u, STORAGE_REST.fileUrl(s), 'POST', r),
    getUpload: (u:string,s:string,id:string) => json(u, STORAGE_REST.upload(s,id)),
    async putUploadPart(u:string,s:string,id:string,n:number,bytes:Uint8Array) { await call(u, STORAGE_REST.uploadPart(s,id,n), {method:'PUT',body:bytes as never,headers:{'content-type':'application/octet-stream'}}) },
    completeUpload: (u:string,s:string,id:string) => json(u, STORAGE_REST.uploadComplete(s,id), 'POST', {}),
    async abortUpload(u:string,s:string,id:string) { await call(u, STORAGE_REST.upload(s,id), {method:'DELETE'}) },
    usage: (u:string) => json(u, STORAGE_REST.usage), cluster: (u:string) => json(u, STORAGE_REST.cluster),
    listSpaces: (u:string) => json(u, STORAGE_REST.spaces), createSpace: (u:string,r:Json) => json(u, STORAGE_REST.spaces,'POST',r),
    getSpace: (u:string,s:string) => json(u, STORAGE_REST.space(s)), updateSpace: (u:string,s:string,r:Json) => json(u, STORAGE_REST.space(s),'PATCH',r),
    mergeDuplicates: (u:string,s:string,r:Json) => json(u, STORAGE_REST.mergeDuplicates(s),'POST',r),
    async deleteSpace(u:string,s:string) { await call(u, STORAGE_REST.space(s),{method:'DELETE'}) },
    listEntries: (u:string,s:string,prefix?:string,withContent?:boolean) => json(u,query(STORAGE_REST.files(s),{prefix,withContent:withContent?'small':undefined})),
    statFile,
    openFile,
    async readFile(u:string,s:string,path:string) { const entry=await statFile(u,s,path); const opened=await openFile(u,s,path); return {entry,bytes:await storageBytes(opened.stream as StorageBody)} },
    async readThumbnail(u:string,s:string,path:string,size:StorageThumbnailSize) { const entry=await statFile(u,s,path); const response=await call(u,query(STORAGE_REST.thumbnail(s),{path,size})); return {entry,bytes:await storageBytes(Readable.fromWeb(response.body! as never)),mimeType:response.headers.get('content-type') ?? 'image/webp'} },
    writeFile,
    async deleteFile(u:string,s:string,path:string) { await call(u,query(STORAGE_REST.file(s),{path}),{method:'DELETE'}) },
    move: (u:string,s:string,from:string,to:string) => json(u,STORAGE_REST.move(s),'POST',{from,to}),
    listShares: (u:string,s:string) => json(u,STORAGE_REST.shares(s)), createShare: (u:string,s:string,r:Json) => json(u,STORAGE_REST.shares(s),'POST',r),
    async revokeShare(u:string,s:string,id:string) { await call(u,STORAGE_REST.share(s,id),{method:'DELETE'}) },
    describeLink: (u:string,t:string) => json(u,STORAGE_REST.link(t)), acceptLink: (u:string,t:string) => json(u,STORAGE_REST.link(t),'POST',{}),
    async checkBatch() {},
    async copy(u:string,s:string,from:string,to:string,options:WriteStorageFileOptions={}) { const entry=await statFile(u,s,from); const opened=await openFile(u,s,from); return writeFile(u,s,to,opened.stream,{...options,mimeType:entry.mimeType,size:entry.size}) },
    async expireUploads() {},
  } as unknown as FileStorageService
  return {service, async close() { /* global fetch pool is process-owned */ }}
}
