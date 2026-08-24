// Loopback HTTP-мост тестовых окружений Web Reader: сервер присылает
// http.request, агент выполняет его строго к 127.0.0.1 своей машины и
// возвращает статус, заголовки и тело. Target host фиксирован (как в
// tunnel.connect) — сервер и клиент не могут направить запрос наружу.

import { request as httpRequest } from 'node:http'
import type { AgentHttpRequest, AgentHttpResponse } from '@voicechat/shared'

/** Кап тела ответа: тем же лимитом ограничен серверный /api/preview. */
export const HTTP_PROXY_MAX_BYTES = 5 * 1024 * 1024
export const HTTP_PROXY_TIMEOUT_MS = 10_000

/** Валидация запроса моста: только разумный порт и абсолютный path. */
export function validateHttpProxyRequest(request: AgentHttpRequest): string | null {
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65_535) return 'некорректный порт'
  if (typeof request.path !== 'string' || !request.path.startsWith('/')) return 'некорректный путь'
  if (typeof request.method !== 'string' || !/^[A-Z]+$/.test(request.method)) return 'некорректный метод'
  return null
}

/** Выполняет запрос к 127.0.0.1:<port>. Редиректам не следует — решает сервер. */
export function fetchLocal(request: AgentHttpRequest, timeoutMs = HTTP_PROXY_TIMEOUT_MS): Promise<AgentHttpResponse> {
  const invalid = validateHttpProxyRequest(request)
  if (invalid) return Promise.reject(new Error(invalid))
  const body = request.bodyBase64 === undefined ? undefined : Buffer.from(request.bodyBase64, 'base64')
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: request.port,
        method: request.method,
        path: request.path,
        headers: {
          ...request.headers,
          host: `127.0.0.1:${request.port}`,
          ...(body === undefined ? {} : { 'content-length': String(body.length) })
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > HTTP_PROXY_MAX_BYTES) {
            response.destroy()
            reject(new Error('Ответ тестового окружения слишком большой'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const headers: Record<string, string | string[]> = {}
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers[name] = value
          }
          resolve({ status: response.statusCode ?? 502, headers, bodyBase64: Buffer.concat(chunks).toString('base64') })
        })
        response.on('error', reject)
      }
    )
    req.once('timeout', () => req.destroy(new Error('Тестовое окружение не ответило вовремя')))
    req.once('error', reject)
    req.end(body)
  })
}
