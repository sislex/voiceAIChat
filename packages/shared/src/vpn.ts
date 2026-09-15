/** Administrative credentials never cross the agent protocol or command log. */
export type VpnMode = 'off' | 'server' | 'client'
export const VPN_ERRORS = {
  unsupported: 'VPN поддерживается на Linux и macOS. Обновите агент до версии 0.18.0.',
  not_installed: 'Установите системный Tailscale с tailscale.com/download и повторите проверку.',
  service: 'Запустите системную службу Tailscale и повторите проверку.',
  login: 'Войдите в свою сеть через приложение Tailscale на машине.',
  permission: 'Предоставьте агенту системные права управления Tailscale и сетевой защитой.',
  forwarding: 'На Linux включите net.ipv4.ip_forward=1 и net.ipv6.conf.all.forwarding=1 через sysctl и сохраните настройки. Затем повторите подготовку VPN-сервера.',
  network: 'Подключите свою сеть Tailscale и проверьте административный доступ.',
  binding: 'Войдите на машине в подключённую сеть Tailscale и повторите проверку.',
  policy: 'Политика Tailscale содержит конфликтующие разрешения или изменена извне. Проверьте её и повторите подготовку.',
  guard: 'Защита от прямого выхода и служебный канал не подтверждены. Требуется подготовка системного VPN-адаптера.',
  offline: 'Агент недоступен. Восстановите подключение и повторите проверку.',
  gateway: 'Шлюз недоступен или не подготовлен. Включите собственный VPN-сервер и повторите проверку.',
  conflict: 'Переход не завершён либо шлюз используется клиентами. Проверьте состояние и отключите зависимые клиенты.',
  invalid: 'Проверьте режим, выбранную машину и версию состояния.',
  apply: 'Применение не подтверждено. Защита не снимается автоматически; повторите проверку состояния.',
  secret_storage: 'Администратор ChatAI должен настроить ключ шифрования VC_VPN_SECRET_KEY.'
} as const
export type VpnErrorCode = keyof typeof VPN_ERRORS
export interface VpnDesired { mode: VpnMode; gatewayId: string | null; allowLan: boolean }
export interface VpnChange extends VpnDesired { operationId: string; expectedRevision: number }
export interface VpnObservation {
  revision?: number
  operationId?: string
  observedAt: number
  mode: VpnMode | 'unknown'
  deviceId: string | null
  tailnet: string | null
  addresses: string[]
  gatewayDeviceId: string | null
  gatewayOnline: boolean | null
  allowLan: boolean
  externalIp: string | null
  protected: boolean
  recoveryReady: boolean
  error: VpnErrorCode | null
}
export interface VpnState {
  desired: VpnDesired
  revision: number
  operationId: string | null
  phase: 'idle' | 'applying' | 'error'
  observed: VpnObservation | null
  error: VpnErrorCode | null
}
export interface VpnGateway { id: string; name: string }
export interface VpnView {
  selectedGateway?: VpnGateway | null
  state: VpnState
  gateways: VpnGateway[]
  network: { tailnet: string; verifiedAt: number } | null
}
export type VpnAgentRequest = { action: 'inspect' } |
  { action: 'apply'; operationId: string; revision: number; desired: VpnDesired; deviceId: string; gatewayDeviceId: string | null; gatewayAddress?: string }
export interface VpnBridge {
  read(machineId: string): Promise<VpnView>
  change(machineId: string, change: VpnChange): Promise<VpnView>
  connect(tailnet: string, secret: string): Promise<void>
}
export const VPN_REST = {
  network: '/api/agents/vpn/network',
  machine: (id: string): string => '/api/agents/' + encodeURIComponent(id) + '/vpn'
}
export const VPN_STALE_MS = 90_000
export const initialVpnState = (): VpnState => ({
  desired: { mode: 'off', gatewayId: null, allowLan: false },
  revision: 0, operationId: null, phase: 'idle', observed: null, error: null
})
export const isVpnFresh = (o: VpnObservation | null, now: number): boolean =>
  o !== null && o.observedAt <= now + 5_000 && now - o.observedAt < VPN_STALE_MS
export function parseVpnChange(value: unknown): VpnChange | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!['off', 'server', 'client'].includes(String(v.mode)) ||
      typeof v.allowLan !== 'boolean' || typeof v.operationId !== 'string' ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(v.operationId) ||
      !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0 ||
      (v.mode === 'client' ? typeof v.gatewayId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(v.gatewayId) : v.gatewayId !== null)) return null
  return { mode: v.mode as VpnMode, gatewayId: v.gatewayId as string | null,
    allowLan: v.allowLan, operationId: v.operationId, expectedRevision: Number(v.expectedRevision) }
}
/** Whitelist diagnostics instead of trying to redact arbitrary CLI output. */
export function sanitizeVpnObservation(value: unknown): VpnObservation | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!Number.isSafeInteger(v.observedAt) || !['off', 'server', 'client', 'unknown'].includes(String(v.mode))) return null
  const id = (x: unknown): string | null => typeof x === 'string' && /^[a-zA-Z0-9._@-]{1,253}$/.test(x) ? x : null
  const ip = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-fA-F.:]{2,45}$/.test(x)
  return { ...(Number.isSafeInteger(v.revision) && Number(v.revision) >= 0 ? { revision: Number(v.revision) } : {}),
    ...(typeof v.operationId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(v.operationId) ? { operationId: v.operationId } : {}),
    observedAt: Number(v.observedAt), mode: v.mode as VpnObservation['mode'],
    deviceId: id(v.deviceId), tailnet: id(v.tailnet),
    addresses: Array.isArray(v.addresses) ? v.addresses.filter(ip).slice(0, 8) : [],
    gatewayDeviceId: id(v.gatewayDeviceId), gatewayOnline: typeof v.gatewayOnline === 'boolean' ? v.gatewayOnline : null,
    allowLan: v.allowLan === true, externalIp: ip(v.externalIp) ? v.externalIp : null,
    protected: v.protected === true, recoveryReady: v.recoveryReady === true,
    error: typeof v.error === 'string' && Object.hasOwn(VPN_ERRORS, v.error) ? v.error as VpnErrorCode : v.error == null ? null : 'apply' }
}
