// Внутренний RPC между сервисами одного стенда (ядро ↔ Make, ядро ↔ канбан): один POST на вызов,
// тело `{ method, args }`, Bearer общего `VC_INTERNAL_TOKEN`, ошибка — `{ error }` со статусом.
// Формат один на всех соседей, чтобы у каждого порта не появлялась своя копия транспорта; сами
// диспетчеры (список разрешённых методов) живут рядом с портами, которые обслуживают.

export interface RpcRequest { method: string; args: unknown[] }
export type RpcResponse = { result: unknown } | { error: string }

/** У ядра: аутентификация пересланного запроса — cookie/Bearer пользователя разбирает только ядро. */
export const INTERNAL_WHOAMI_PATH = '/internal/whoami'

export interface WhoamiRequest {
  method: string
  url: string
  headers: { cookie?: string; authorization?: string; [csrf: string]: string | undefined }
}
export type WhoamiResponse =
  | { ok: true; user: { name: string; role: string; mustChangePassword?: boolean } }
  | { ok: false; status: 401 | 403; error: string }

export class RpcError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Клиент RPC: один POST на вызов, Bearer внутреннего токена, ошибки — исключением с текстом сервера. */
export function createRpcClient(opts: { baseUrl: string; token: string; path: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${opts.baseUrl.replace(/\/+$/, '')}${opts.path}`
  return async <T>(method: string, ...args: unknown[]): Promise<T> => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ method, args } satisfies RpcRequest),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
    })
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as RpcResponse
    if (!res.ok || 'error' in body) throw new RpcError(res.status, 'error' in body ? body.error : `HTTP ${res.status}`)
    return body.result as T
  }
}

/**
 * Диспетчер RPC над объектом порта: разрешены только перечисленные методы, `undefined` результата
 * превращается в `null` (JSON не знает undefined). Методы с побочным протоколом (стримы, обратные
 * вызовы) сюда не кладут — у них свои эндпоинты.
 */
export function createRpcDispatcher<T extends object>(target: T, methods: readonly (keyof T & string)[]): (req: RpcRequest) => Promise<unknown> {
  return async ({ method, args }) => {
    if (!Array.isArray(args) || !(methods as readonly string[]).includes(method)) throw new RpcError(400, `неизвестный метод ${method}`)
    const fn = target[method as keyof T] as unknown as (...x: unknown[]) => unknown
    return (await fn.apply(target, args)) ?? null
  }
}
