import { parseLoginEnrollmentDeepLink, REST } from '@voicechat/shared'

interface MachineResult { machineToken: string; serverUrl: string }
type FetchLike = typeof fetch

function normalizeServer(value: string): string {
  const url = new URL(value.trim())
  if (!/^https?:$/.test(url.protocol)) throw new Error('Адрес ChatAI должен использовать http или https')
  return url.origin
}
function wsAgentUrl(httpUrl: string): string {
  const url = new URL(httpUrl)
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/agent`
}
async function jsonError(response: Response): Promise<string> {
  try { return ((await response.json()) as { error?: string }).error ?? `HTTP ${response.status}` }
  catch { return `HTTP ${response.status}` }
}

export async function enrollWithDeepLink(value: string, request: FetchLike, machineName: string): Promise<MachineResult> {
  const parsed = parseLoginEnrollmentDeepLink(value)
  if (!parsed) throw new Error('Некорректная или неподдерживаемая enrollment-ссылка')
  const response = await request(parsed.serverUrl + REST.loginEnrollmentRedeem, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: parsed.token, name: machineName })
  })
  if (!response.ok) throw new Error(await jsonError(response))
  const body = await response.json() as { machineToken?: string; serverUrl?: string }
  if (!body.machineToken || !body.serverUrl) throw new Error('Сервер вернул неполный результат enrollment')
  return { machineToken: body.machineToken, serverUrl: wsAgentUrl(body.serverUrl) }
}

export async function loginAndCreateMachine(
  input: { serverUrl: string; login: string; password: string },
  request: FetchLike,
  machineName: string
): Promise<MachineResult> {
  const server = normalizeServer(input.serverUrl)
  const login = await request(server + REST.sessionLogin, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: input.login, password: input.password, remember: false })
  })
  if (!login.ok) throw new Error(await jsonError(login))
  const session = await login.json() as { token?: string; requires2fa?: boolean }
  if (session.requires2fa) throw new Error('Для аккаунта включён второй фактор; используйте enrollment из открытого ChatAI')
  if (!session.token) throw new Error('Сервер не вернул сессию')
  const created = await request(server + REST.agents, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ name: machineName })
  })
  if (!created.ok) throw new Error(await jsonError(created))
  const body = await created.json() as { token?: string }
  if (!body.token) throw new Error('Сервер не вернул токен машины')
  return { machineToken: body.token, serverUrl: wsAgentUrl(server) }
}
