import type { StandProxy } from '../standProxy.js'

/** Make requests an inspector lease and preserves the proxy's configured public scheme. */
export function makeStandPreviewAccess(proxy: Pick<StandProxy, 'access'>, host: string) {
  return (user: string, project: string, stand: string) =>
    proxy.access(user, project, stand, host, undefined, { inject: 'make-inspector' })
}
