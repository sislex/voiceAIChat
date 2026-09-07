// Клиент потокового exec машины через ядро (`/internal/kanban/exec-stream`): NDJSON-строки `{ chunk }`
// приходят в `onChunk`, последняя `{ result }` завершает вызов. Нарочно `node:http`, а не fetch: у
// undici есть таймаут тела по умолчанию (5 мин), а шаг CI может работать дольше; лимит времени задаёт
// сама команда (`timeoutMs`), обрыв по `signal` рвёт соединение — ядро отменяет команду.
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { ExecResult } from '../core.js'
import { INTERNAL_KANBAN_EXEC_STREAM_PATH, type ExecStreamLine, type ExecStreamRequest } from '../internal.js'

export interface ExecStreamClientOptions {
  coreUrl: string
  token: string
}

export function execViaCore(opts: ExecStreamClientOptions, body: ExecStreamRequest, onChunk?: (data: string) => void, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const url = new URL(INTERNAL_KANBAN_EXEC_STREAM_PATH, opts.coreUrl.replace(/\/+$/, '') + '/')
    const payload = JSON.stringify(body)
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: `Bearer ${opts.token}` }
    })
    let settled = false
    const finish = (fn: () => void): void => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); fn() }
    const onAbort = (): void => { req.destroy(new Error('aborted')); finish(() => reject(new Error('exec aborted'))) }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('error', (error) => finish(() => reject(error)))
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (d: string) => { text += d })
        res.on('end', () => finish(() => reject(new Error(`exec-stream: HTTP ${res.statusCode} ${text.slice(0, 200)}`))))
        return
      }
      let buffer = ''
      res.setEncoding('utf8')
      const handle = (raw: string): void => {
        if (!raw.trim()) return
        const line = JSON.parse(raw) as ExecStreamLine
        if ('chunk' in line) onChunk?.(line.chunk)
        else if ('result' in line) finish(() => resolve(line.result))
        else finish(() => reject(new Error(line.error)))
      }
      res.on('data', (data: string) => {
        buffer += data
        let nl = buffer.indexOf('\n')
        while (nl >= 0) {
          const raw = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          try { handle(raw) } catch (error) { finish(() => reject(error)) }
          nl = buffer.indexOf('\n')
        }
      })
      res.on('end', () => {
        if (buffer.trim()) { try { handle(buffer) } catch (error) { finish(() => reject(error)) } }
        finish(() => reject(new Error('exec-stream: поток оборвался без результата')))
      })
      res.on('error', (error) => finish(() => reject(error)))
    })
    req.end(payload)
  })
}
