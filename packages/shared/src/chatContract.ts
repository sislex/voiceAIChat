/** Opaque server-issued reference; contains no bearer credential. */
export interface ChatDelegationReference {
  readonly id: string
  readonly userId: string
  readonly tenantId: string
  readonly applicationId: string
  readonly grantId: string
}

/** Stable permissions are authorization decisions. Capabilities only describe usable features. */
export const CHAT_PERMISSIONS = [
  'chat:conversations:read',
  'chat:conversations:create',
  'chat:groups:read',
  'chat:groups:write',
  'chat:messages:write',
  'chat:turns:run',
  'chat:turns:cancel',
  'chat:settings:read',
  'chat:settings:write'
] as const
export type ChatPermission = typeof CHAT_PERMISSIONS[number]

export const CHAT_CAPABILITIES = [
  'chat.text',
  'chat.attachments',
  'chat.queue',
  'chat.tools',
  'chat.voice.input',
  'chat.voice.output'
] as const
export type ChatCapability = typeof CHAT_CAPABILITIES[number]

export interface ChatCapabilityState {
  id: ChatCapability
  available: boolean
  /** Stable machine-readable reason; details may be shown to a person. */
  reason?: 'not-granted' | 'host-unsupported' | 'temporarily-unavailable'
  detail?: string
}

export type ChatResourceGrant =
  | { kind: 'all-conversations' }
  | { kind: 'application-owned' }
  | { kind: 'conversation-ids'; conversationIds: readonly string[] }

/** Structural adapter for SDK `ApplicationAttribution` v1 (SDK 1.2 contract). */
export interface ChatApplicationAttribution {
  readonly version: 1
  readonly originApplicationId: string
  readonly executorApplicationId: string
  readonly tokenId: string | null
  readonly delegationId: string | null
}

/**
 * Context created at a trusted authentication boundary. Request payloads must never
 * supply or override it. `application` is attribution, not proof by itself.
 */
export interface VerifiedChatApplicationContext {
  version: 1
  application: ChatApplicationAttribution
  principal: {
    identityIssuer: string
    userId: string
    tenantId: string
    environmentId: string
  }
  sessionId: string
  verifiedAt: number
  expiresAt: number
  permissions: readonly ChatPermission[]
  capabilities: readonly ChatCapabilityState[]
  resources: ChatResourceGrant
}

export interface TrustedChatApplicationContextInput extends VerifiedChatApplicationContext {}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/
const permissionSet = new Set<string>(CHAT_PERMISSIONS)
const capabilitySet = new Set<string>(CHAT_CAPABILITIES)

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !identifier.test(value)) throw Error(`Invalid ${name}`)
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) immutable(item)
    Object.freeze(value)
  }
  return value
}

/** Concrete adapter used after Identity/SDK verification; validates and detaches trusted records. */
export function createVerifiedChatApplicationContext(
  input: TrustedChatApplicationContextInput,
  now: number
): VerifiedChatApplicationContext {
  if (input.version !== 1) throw Error('Unsupported chat application context')
  for (const [name, value] of Object.entries({ ...input.principal, sessionId: input.sessionId })) {
    assertIdentifier(value, name)
  }
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(input.verifiedAt) || !Number.isSafeInteger(input.expiresAt)
    || input.verifiedAt < 0 || input.expiresAt <= input.verifiedAt || now < input.verifiedAt || now >= input.expiresAt) {
    throw Error('Chat application context is not current')
  }
  if (input.application.version !== 1) throw Error('Unsupported application attribution')
  for (const key of ['originApplicationId', 'executorApplicationId'] as const) {
    assertIdentifier(input.application[key], key)
  }
  for (const key of ['tokenId', 'delegationId'] as const) {
    if (input.application[key] !== null) assertIdentifier(input.application[key], key)
  }
  if (input.application.originApplicationId !== input.application.executorApplicationId
    && input.application.delegationId === null) throw Error('Cross-application context requires delegation')
  if (!Array.isArray(input.permissions) || new Set(input.permissions).size !== input.permissions.length
    || input.permissions.some(item => !permissionSet.has(item))) throw Error('Invalid chat permissions')
  if (!Array.isArray(input.capabilities) || new Set(input.capabilities.map(item => item.id)).size !== input.capabilities.length) {
    throw Error('Invalid chat capabilities')
  }
  for (const capability of input.capabilities) {
    if (!capabilitySet.has(capability.id) || typeof capability.available !== 'boolean') throw Error('Invalid chat capability')
    if (capability.available && capability.reason !== undefined) throw Error('Available capability cannot have a reason')
    if (!capability.available && capability.reason === undefined) throw Error('Unavailable capability requires a reason')
  }
  let resources: ChatResourceGrant
  if (input.resources.kind === 'conversation-ids') {
    if (new Set(input.resources.conversationIds).size !== input.resources.conversationIds.length) throw Error('Duplicate conversation grant')
    for (const id of input.resources.conversationIds) assertIdentifier(id, 'conversationId')
    resources = { kind: input.resources.kind, conversationIds: [...input.resources.conversationIds].sort() }
  } else if (input.resources.kind === 'all-conversations' || input.resources.kind === 'application-owned') {
    resources = { kind: input.resources.kind }
  } else throw Error('Invalid chat resource grant')

  return immutable({
    version: 1,
    application: { ...input.application },
    principal: { ...input.principal },
    sessionId: input.sessionId,
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
    permissions: [...input.permissions].sort(),
    capabilities: input.capabilities.map(item => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
    resources
  })
}

export type ChatAccessDenial = 'expired' | 'permission' | 'capability' | 'resource'
export type ChatAccessDecision = { allowed: true } | { allowed: false; reason: ChatAccessDenial }

/** Permission and resource access are always required; a capability never grants either. */
export function decideChatAccess(input: {
  context: VerifiedChatApplicationContext
  permission: ChatPermission
  capability?: ChatCapability
  conversation?: { id: string; originApplicationId: string | null }
  now: number
}): ChatAccessDecision {
  if (input.now < input.context.verifiedAt || input.now >= input.context.expiresAt) return { allowed: false, reason: 'expired' }
  if (!input.context.permissions.includes(input.permission)) return { allowed: false, reason: 'permission' }
  if (input.capability && !input.context.capabilities.some(item => item.id === input.capability && item.available)) {
    return { allowed: false, reason: 'capability' }
  }
  if (input.conversation) {
    const grant = input.context.resources
    const allowed = grant.kind === 'all-conversations'
      || (grant.kind === 'conversation-ids' && grant.conversationIds.includes(input.conversation.id))
      || (grant.kind === 'application-owned'
        && input.conversation.originApplicationId === input.context.application.originApplicationId)
    if (!allowed) return { allowed: false, reason: 'resource' }
  }
  return { allowed: true }
}

export type ChatSettingOwner = 'account' | 'conversation' | 'device'
export type ChatSettingValue = string | number | boolean | null
  | readonly ChatSettingValue[] | { readonly [key: string]: ChatSettingValue }

export interface ChatSettingsSnapshot {
  version: 1
  revision: number
  account: Readonly<Record<string, ChatSettingValue>>
  conversation: Readonly<Record<string, ChatSettingValue>> & { readonly loadServiceData?: boolean }
  /** Device values are echoed by a local adapter and are never persisted by Core. */
  device: Readonly<Record<string, ChatSettingValue>>
}

export type ChatSettingsPatch = {
  version: 1
  expectedRevision: number
  owner: 'account'
  values: Readonly<Record<string, ChatSettingValue>>
} | {
  version: 1
  expectedRevision: number
  owner: 'conversation'
  values: Readonly<Record<string, ChatSettingValue>> & { readonly loadServiceData?: boolean }
}

export interface ChatSettingsConflict {
  code: 'settings_revision_conflict'
  current: ChatSettingsSnapshot
}

export const CHAT_SETTING_OWNERS = immutable({
  account: [
    'llmEngineId', 'llmProvider', 'model', 'codexModel', 'permissionMode', 'workdir', 'execTarget',
    'defaultAgentId', 'aiAssistProvider', 'aiAssistModel', 'aiAssistPrompts', 'personalization',
    'chatInstructions', 'contextPresets', 'defaultContextPresetId', 'whisperModel', 'diarization',
    'voice', 'autoSpeak', 'bargeIn', 'handsFree', 'theme', 'showConsole'
  ],
  conversation: [
    'title', 'projectId', 'execTarget', 'workdir', 'skills', 'llmEngineId', 'llmProvider',
    'model', 'codexModel', 'permissionMode', 'contextPresetId', 'kbMode', 'disabledContext',
    'previewUrl', 'previewEngine', 'loadServiceData'
  ],
  device: ['micDeviceId', 'outputDeviceId', 'compactView', 'panelWidth', 'mobileTab']
} as const)

function validateSettingValues(owner: ChatSettingOwner, values: Readonly<Record<string, ChatSettingValue>>): void {
  if (!Object.hasOwn(CHAT_SETTING_OWNERS, owner)) throw Error('Invalid settings owner')
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('Invalid settings values')
  const allowed = CHAT_SETTING_OWNERS[owner] as readonly string[]
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.includes(key)) throw Error(`Setting ${key} does not belong to ${owner}`)
    if (key === 'loadServiceData' && typeof value !== 'boolean') throw Error('Setting loadServiceData must be boolean')
    if (!validSettingValue(value)) throw Error(`Invalid setting ${key}`)
  }
}

function validSettingValue(value: unknown, depth = 0): value is ChatSettingValue {
  if (depth > 8) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => validSettingValue(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>)
    .every(([key, item]) => identifier.test(key) && validSettingValue(item, depth + 1))
}

function cloneSettingValue(value: ChatSettingValue): ChatSettingValue {
  if (Array.isArray(value)) return value.map(item => cloneSettingValue(item))
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneSettingValue(item)])
  )
  return value
}

function cloneSettingRecord(values: Readonly<Record<string, ChatSettingValue>>): Record<string, ChatSettingValue> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cloneSettingValue(value)]))
}

/** Concrete adapter that combines persisted account/conversation state with local device state. */
export function createChatSettingsSnapshot(input: Omit<ChatSettingsSnapshot, 'conversation'> & {
  conversation: Readonly<Record<string, ChatSettingValue>> & { readonly loadServiceData?: boolean }
}): ChatSettingsSnapshot {
  if (input.version !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 0) throw Error('Invalid settings revision')
  validateSettingValues('account', input.account)
  validateSettingValues('conversation', input.conversation)
  validateSettingValues('device', input.device)
  return immutable({ version: 1, revision: input.revision, account: cloneSettingRecord(input.account),
    conversation: { loadServiceData: false, ...cloneSettingRecord(input.conversation) },
    device: cloneSettingRecord(input.device) })
}

export function applyChatSettingsPatch(current: ChatSettingsSnapshot, patch: ChatSettingsPatch): ChatSettingsSnapshot | ChatSettingsConflict {
  const snapshot = createChatSettingsSnapshot(current)
  if (patch.version !== 1 || !Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 0) throw Error('Invalid settings patch')
  if (patch.owner !== 'account' && patch.owner !== 'conversation') throw Error('Invalid settings owner')
  validateSettingValues(patch.owner, patch.values)
  if (patch.expectedRevision !== snapshot.revision) return { code: 'settings_revision_conflict', current: snapshot }
  return createChatSettingsSnapshot({ ...snapshot, revision: snapshot.revision + 1,
    [patch.owner]: { ...snapshot[patch.owner], ...patch.values } })
}

export type ChatReconnectResult =
  | { status: 'resumed'; cursor: string }
  | { status: 'resync-required'; reason: 'initial-connect' | 'cursor-expired' | 'scope-changed' | 'server-restarted' }

export interface ChatConnectionSnapshot {
  version: 1
  connectionId: string
  cursor: string
  context: VerifiedChatApplicationContext
  settings: ChatSettingsSnapshot
  reconnect: ChatReconnectResult
}

/** A reconnect is authorized again; previous verified context and subscriptions are never reused. */
export function resolveChatReconnect(input: {
  requestedCursor?: string
  replayableCursors?: readonly string[]
  currentCursor: string
  scopeChanged: boolean
  serverRestarted: boolean
}): ChatReconnectResult {
  if (!input.requestedCursor) return { status: 'resync-required', reason: 'initial-connect' }
  if (input.serverRestarted) return { status: 'resync-required', reason: 'server-restarted' }
  if (input.scopeChanged) return { status: 'resync-required', reason: 'scope-changed' }
  if (input.replayableCursors !== undefined && !input.replayableCursors.includes(input.requestedCursor)) {
    return { status: 'resync-required', reason: 'cursor-expired' }
  }
  return { status: 'resumed', cursor: input.currentCursor }
}

const artifactPayload = {
  artifactVersion: 1,
  contract: 'sislexa.core.chat',
  contractVersion: '1.1.0',
  rest: {
    context: '/api/chat/context',
    settings: '/api/chat/settings',
    conversationSettings: '/api/conversations/:conversationId/settings',
    conversationGroups: '/api/conversation-groups',
    conversationGroup: '/api/conversation-groups/:groupId',
    conversationMembership: '/api/conversations/:conversationId/membership'
  },
  websocket: {
    client: ['chat.connect'],
    server: ['chat.ready', 'chat.settings.updated']
  },
  semantics: {
    capabilityGrantsPermission: false,
    reconnectReverifiesContext: true,
    missedEventsRequireSnapshot: true,
    deviceSettingsPersistedByCore: false
  },
  settingsOwnership: CHAT_SETTING_OWNERS
} as const

/** Canonical, deeply frozen handoff artifact. Its canonical JSON has the exported SHA-256. */
export const CHAT_CONTRACT_ARTIFACT = immutable(artifactPayload)
export const CHAT_CONTRACT_ARTIFACT_SHA256 = 'a7b143b2a7c28506857a2b1f52d6937a1ae148de32883d76a3ccb0056c4defd9'

export function canonicalChatContractArtifact(): string {
  return JSON.stringify(CHAT_CONTRACT_ARTIFACT)
}
