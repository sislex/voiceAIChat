// Потоковый exec машины между процессами: сервер пишет NDJSON (`{ chunk }`… и одна `{ result }` или
// `{ error }`), клиент читает его через `node:http` — у undici таймаут тела по умолчанию 5 минут, а шаг CI
// может работать дольше; лимит времени задаёт сама команда (`timeoutMs`), обрыв по `signal` рвёт
// соединение, и сервер отменяет команду. Используется ядром ↔ канбаном и ядром ↔ процессом машин.
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { FastifyReply } from 'fastify'
import type { ExecMeta, ExecResult, MachinesService } from '../machines/service.js'

export interface ExecStreamRequest {
  agentId: string
  command: string
  timeoutMs: number
  /** false — обычный `exec` с журналом команд (meta), вывод приходит одним `result.output`. */
  stream: boolean
  meta?: ExecMeta
}
export type ExecStreamLine = { chunk: string } | { result: ExecResult } | { error: string }

/** Сторона сервера: выполняет команду и пишет поток в ответ; обрыв соединения клиентом отменяет команду. */
export async function serveExecStream(reply: FastifyReply, body: ExecStreamRequest, machines: Pick<MachinesService, 'exec' | 'execStream'>): Promise<void> {
  const controller = new AbortController()
  reply.hijack()
  const raw = reply.raw
  raw.on('close', () => { if (!raw.writableFinished) controller.abort() })
  raw.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })
  raw.flushHeaders()
  const write = (line: ExecStreamLine): void => { if (!raw.writableEnded) raw.write(`${JSON.stringify(line)}\n`) }
  try {
    const result = body.stream
      ? await machines.execStream(body.agentId, body.command, body.timeoutMs, (chunk) => write({ chunk }), controller.signal)
      : await machines.exec(body.agentId, body.command, body.timeoutMs, controller.signal, body.meta)
    write({ result })
  } catch (error) {
    write({ error: error instanceof Error ? error.message : String(error) })
  }
  raw.end()
}

export interface ExecStreamClientOptions {
  baseUrl: string
  token: string
  path: string
}

/** Сторона клиента: чанки — в `onChunk`, `result` завершает вызов, `error` — исключение. */
export function execOverHttp(opts: ExecStreamClientOptions, body: ExecStreamRequest, onChunk?: (data: string) => void, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const url = new URL(opts.path.replace(/^\//, ''), `${opts.baseUrl.replace(/\/+$/, '')}/`)
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
