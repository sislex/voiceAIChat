import type { FastifyInstance } from 'fastify'
import type { ReaderProjectRequest, ReaderProjectResponse } from '@voicechat/shared'
import { isReaderProjectPath } from '@voicechat/shared'

/** Доставляем только пути своего Fastify; авторизацию вложенного приложения проверяют обычные routes. */
export async function readerProjectResource(app: FastifyInstance, request: ReaderProjectRequest): Promise<ReaderProjectResponse> {
  const fail = (status: number, message: string): ReaderProjectResponse => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, bodyBase64: Buffer.from(JSON.stringify({ error: message })).toString('base64') })
  if (!isReaderProjectPath(request.path)) return fail(403, 'Служебный адрес нельзя открыть внутри Reader')
  if (!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)) return fail(405, 'Метод не поддерживается')
  const body = request.bodyBase64 === undefined ? undefined : Buffer.from(request.bodyBase64, 'base64')
  if (body && body.length > 5 * 1024 * 1024) return fail(413, 'Тело запроса больше 5 MiB')
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !/^(?:host|connection|content-length|transfer-encoding|forwarded|x-forwarded-.+|x-vc-internal-.+)$/i.test(name)))
  const response = await app.inject({ method: request.method as 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS', url: request.path, headers: { ...headers, host: 'app.internal' }, ...(body ? { payload: body } : {}) })
  if (response.rawPayload.length > 5 * 1024 * 1024) return fail(413, 'Ответ приложения больше 5 MiB')
  const responseHeaders: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) responseHeaders[name] = Array.isArray(value) ? value : String(value)
  return { status: response.statusCode, headers: responseHeaders, bodyBase64: response.rawPayload.toString('base64') }
}
