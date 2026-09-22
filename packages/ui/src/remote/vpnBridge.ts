import { VPN_ERRORS, VPN_REST, type VpnBridge } from '@shared/vpn'
import { authHeaders, credentialedFetch, notifyUnauthorized } from "@sislexa/identity/client/browser"
export function createVpnBridge(base: string): VpnBridge {
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    try {
      const response = await credentialedFetch(base + path, {
        method, headers: { ...authHeaders(), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (response.status === 401) notifyUnauthorized()
      const value = await response.json() as { code?: string }
      if (!response.ok) throw new Error(value.code && Object.hasOwn(VPN_ERRORS, value.code) ? value.code : 'apply')
      return value as T
    } catch (error) {
      const code = error instanceof Error && Object.hasOwn(VPN_ERRORS, error.message) ? error.message : 'apply'
      throw new Error(code)
    }
  }
  return {
    read: id => request(VPN_REST.machine(id)),
    change: (id, change) => request(VPN_REST.machine(id), 'PUT', change),
    connect: async (tailnet, secret) => { await request(VPN_REST.network, 'POST', { tailnet, secret }) }
  }
}
