import type { StandProxy } from '../standProxy.js'

/** Make's preview adapter always requests an inspector-enabled lease. */
export function makeStandPreviewAccess(proxy: Pick<StandProxy, 'access'>, host: string) {
  return (user: string, project: string, stand: string) =>
    proxy.access(user, project, stand, host, undefined, { inject: 'make-inspector' })
}
