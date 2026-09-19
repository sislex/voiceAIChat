/** Accounting metadata, never proof of identity or permission. Servers must build
 * it from authenticated identities and authorized resources, not request bodies. */
export interface PlatformOperationContext {
  readonly version: 1
  readonly userId: string
  readonly identityIssuer: string
  readonly actorClientId: string
  readonly billingAccountId: string
  readonly environmentId: string
  readonly originModuleId: string
  readonly projectId: string | null
  readonly operationId: string
  readonly rootOperationId: string
  readonly parentOperationId: string | null
}

export type PlatformOperationInput = Omit<PlatformOperationContext,
  'version' | 'rootOperationId' | 'parentOperationId'>

export function assertPlatformIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid platform identifier: ${field}`)
  }
}

/** Structural validation only: this does not validate a token, issuer trust, or ownership. */
export function parsePlatformOperationContext(value: unknown): PlatformOperationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid platform operation context')
  }
  const source = value as Record<string, unknown>
  const fields = ['userId', 'identityIssuer', 'actorClientId', 'billingAccountId',
    'environmentId', 'originModuleId', 'operationId', 'rootOperationId'] as const
  const optionalFields = ['projectId', 'parentOperationId'] as const
  const known = new Set<string>(['version', ...fields, ...optionalFields])
  if (source.version !== 1 || Object.keys(source).some((key) => !known.has(key))) {
    throw new Error('Unsupported platform operation context')
  }
  for (const key of fields) assertPlatformIdentifier(source[key], key)
  for (const key of optionalFields) {
    if (source[key] !== null) assertPlatformIdentifier(source[key], key)
  }
  const context = source as unknown as PlatformOperationContext
  if ((context.parentOperationId === null && context.rootOperationId !== context.operationId)
    || (context.parentOperationId !== null
      && (context.parentOperationId === context.operationId || context.rootOperationId === context.operationId))) {
    throw new Error('Invalid platform operation ancestry')
  }
  return Object.freeze({
    version: 1,
    userId: context.userId,
    identityIssuer: context.identityIssuer,
    actorClientId: context.actorClientId,
    billingAccountId: context.billingAccountId,
    environmentId: context.environmentId,
    originModuleId: context.originModuleId,
    projectId: context.projectId,
    operationId: context.operationId,
    rootOperationId: context.rootOperationId,
    parentOperationId: context.parentOperationId,
  })
}

export function createPlatformOperationContext(input: PlatformOperationInput): PlatformOperationContext {
  return parsePlatformOperationContext({
    ...input, version: 1, rootOperationId: input.operationId, parentOperationId: null,
  })
}

/** A child changes its actor and operation ID while retaining the payer and origin. */
export function createChildPlatformOperationContext(
  parent: PlatformOperationContext,
  operationId: string,
  actorClientId: string,
): PlatformOperationContext {
  const verifiedShape = parsePlatformOperationContext(parent)
  return parsePlatformOperationContext({
    ...verifiedShape, operationId, actorClientId, parentOperationId: verifiedShape.operationId,
  })
}
