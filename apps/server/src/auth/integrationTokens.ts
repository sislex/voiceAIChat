import type { FastifyInstance } from 'fastify'
export type { IntegrationPrincipal } from '@voicechat/shared'

/** Integration ingress: the only non-internal paths an integration token may call. */
export const INTEGRATION_PREFIX = '/integrations/v1/'

/** Reserved credential namespace, including malformed and revoked credentials. */
export function integrationBearer(authorization: string | undefined): string | null {
  return /^Bearer\s+(sit_\S+)$/i.exec(authorization ?? '')?.[1] ?? null
}

export function registerIntegrationTokenGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!
    if (integrationBearer(req.headers.authorization) && !path.startsWith('/internal/') && !path.startsWith(INTEGRATION_PREFIX)) {
      return reply.code(403).send({ error: 'integration_access_denied' })
    }
  })
}
