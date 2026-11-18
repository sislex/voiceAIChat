import { readFile } from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Readable } from 'node:stream'
import { STORAGE_REST, STORAGE_ERROR_STATUS, type StorageError, type StorageEntry, type StorageThumbnailSize } from '@voicechat/shared/fileStorage'
import type { FileStorageService, WriteStorageFileOptions } from '../../../../packages/file-storage/src/service.js'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'
import { storageBytes, type StorageBody } from '../../../../packages/file-storage/src/client.js'
import type { FileStorageConfig } from './config.js'

type Json = Record<string, unknown> | unknown[]
const tenantContext = new AsyncLocalStorage<{ tenantId?: string; role?: string }>()
/** `role` lets the storage service apply its own admin checks (cluster, quota administration). */
export function withStorageTenant<T>(tenantId: string | undefined, run: () => Promise<T>, role?: string): Promise<T> {
  return tenantContext.run({ tenantId, role }, run)
}
/** A preview is replaced by the original only for images a browser can scale itself. */
const PREVIEW_FALLBACK_BYTES = 2 * 1024 * 1024
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`

export async function createRemoteStorageRuntime(config: FileStorageConfig, userToken?: () => Promise<string>) {
  const token = userToken ? undefined : (await readFile(config.serviceTokenFile!, 'utf8')).trim()
  if (!userToken && !token) throw new Error('File storage service token is empty')
  const base = config.url!
  const headers = async (userId: string, extra?: Record<string, string>) => {
    if (userToken) return { authorization: `Bearer ${await userToken()}`, ...extra }
    const context = tenantContext.getStore()
    return { authorization: `Bearer ${token}`, 'x-sislexa-user': userId,
      ...(context?.tenantId ? {'x-sislexa-tenant': context.tenantId} : {}),
      ...(context?.role === 'admin' ? {'x-sislexa-role': 'admin'} : {}), ...extra }
  }
  const call = async (userId: string, path: string, init: RequestInit = {}) => {
    let response: Response
    try { response = await fetch(base + path, {...init, redirect: "error", headers: {...await headers(userId), ...init.headers}}) }
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
    // Storage prefixes select directories, so look up the file in its parent.
    const separator = path.lastIndexOf('/')
    const prefix = separator === -1 ? undefined : path.slice(0, separator + 1)
    const result = await json<{entries: StorageEntry[]}>(user, query(STORAGE_REST.files(space), {prefix}))
    const entry = result.entries.find(item => item.path === path)
    if (!entry) throw new StorageServiceError('not_found')
    return entry
  }
  const openFile = async (u:string,s:string,path:string,range?:string) => {
    const response = await call(u,query(STORAGE_REST.file(s),{path}),{headers:range?{range}:{}})
    return {stream: Readable.fromWeb(response.body! as never), contentLength:Number(response.headers.get('content-length') ?? 0), contentRange:response.headers.get('content-range') ?? undefined}
  }
  const writeFile = async (u:string,s:string,path:string,body:StorageBody,options:WriteStorageFileOptions={}) => {
    // The service answers 413 as soon as a streamed body passes the quota and closes the socket, so
    // fetch fails without a response. Count what was sent to tell a quota refusal from an outage.
    let sentBytes = body instanceof Uint8Array ? body.byteLength : 0
    const sent = body instanceof Uint8Array ? body : (async function* () {
      for await (const chunk of body as AsyncIterable<Uint8Array>) { sentBytes += chunk.byteLength; yield chunk }
    })()
    let response: Response
    try { response=await call(u,query(STORAGE_REST.file(s),{path}),{method:'PUT',body:sent as never,duplex:'half',headers:{'content-type':options.mimeType ?? 'application/octet-stream',...(options.size===undefined?{}:{'content-length':String(options.size)}),...(options.ifMatch===undefined?{}:{'if-match':String(options.ifMatch)}),...(options.createOnly?{'if-none-match':'*'}:{})}} as RequestInit) }
    catch (error) {
      if (!(error instanceof StorageServiceError) || (error.code !== 'storage_unavailable' && error.code !== 'quota_exceeded')) throw error
      const usage = await json<{usedBytes:number;quotaBytes:number}>(u, STORAGE_REST.usage).catch(() => null)
      if (!usage) throw error
      const free = Math.max(0, usage.quotaBytes - usage.usedBytes)
      if (error.code === 'quota_exceeded' || sentBytes > free)
        throw new StorageServiceError('quota_exceeded', `Файл не помещается в хранилище: занято ${megabytes(usage.usedBytes)} из ${megabytes(usage.quotaBytes)}, свободно ${megabytes(free)}`, { usedBytes: usage.usedBytes, limitBytes: usage.quotaBytes })
      throw error
    }
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
    async readThumbnail(u:string,s:string,path:string,size:StorageThumbnailSize) {
      const entry=await statFile(u,s,path)
      try {
        const response=await call(u,query(STORAGE_REST.thumbnail(s),{path,size}))
        return {entry,bytes:await storageBytes(Readable.fromWeb(response.body! as never)),mimeType:response.headers.get('content-type') ?? 'image/webp'}
      } catch (error) {
        // The file itself is fine; only the preview tool of the storage host failed or is missing.
        if (!(error instanceof StorageServiceError) || !['node_unavailable','storage_unavailable','preview_unavailable','unsupported_media_type'].includes(error.code)) throw error
        const mimeType=entry.mimeType.toLowerCase()
        if (entry.size>PREVIEW_FALLBACK_BYTES || !['image/png','image/jpeg','image/webp','image/gif'].includes(mimeType))
          throw new StorageServiceError('preview_unavailable', 'Превью этого файла недоступно; сам файл можно скачать')
        const opened=await openFile(u,s,path)
        return {entry,bytes:await storageBytes(opened.stream as StorageBody),mimeType}
      }
    },
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
