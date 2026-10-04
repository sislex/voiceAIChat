import { z } from 'zod'
import { CHAT_INSTRUCTION_KINDS, WHISPER_MODELS, type ChatSettingsPatch } from '@voicechat/shared'

const text = z.string()
const nullableText = text.nullable()
const provider = z.enum(['claude', 'codex'])
const permission = z.enum(['plan', 'acceptEdits', 'bypassPermissions'])
const strings = z.array(text)
const common = {
  llmEngineId: nullableText, workdir: nullableText, execTarget: nullableText,
  model: text, codexModel: text, llmProvider: provider, permissionMode: permission
}
const personalization = z.object({
  preferredName: text.max(80).nullable(), birthDay: z.number().int().min(1).max(31).nullable(),
  birthMonth: z.number().int().min(1).max(12).nullable(),
  birthYear: z.number().int().min(1900).max(9999).nullable(),
  responseLanguage: text.regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).nullable(),
  responseStyle: z.enum(['brief', 'normal', 'detailed', 'step-by-step']),
  tone: z.enum(['neutral', 'friendly', 'business', 'plain']), avatar: nullableText.optional()
}).strict().refine(p => p.birthDay === null || p.birthMonth === null
  || p.birthDay <= new Date(Date.UTC(p.birthYear ?? 2000, p.birthMonth, 0)).getUTCDate())
const account = z.object({
  ...common, defaultAgentId: nullableText, aiAssistProvider: provider, aiAssistModel: text,
  aiAssistPrompts: z.array(z.object({ id: text, title: text, text, enabled: z.boolean(), readonly: z.boolean().optional() }).strict()),
  personalization,
  chatInstructions: z.array(z.object({ id: text, title: text, description: text, enabled: z.boolean(),
    kind: z.enum(CHAT_INSTRUCTION_KINDS).optional(), text: text.optional() }).strict()),
  contextPresets: z.array(z.object({ id: text, name: text.max(60), disabled: strings }).strict()).max(20),
  defaultContextPresetId: nullableText, whisperModel: z.enum(WHISPER_MODELS),
  diarization: z.boolean(), voice: text, autoSpeak: z.boolean(), bargeIn: z.boolean(),
  handsFree: z.boolean(), theme: z.enum(['light', 'dark', 'green', 'system']), showConsole: z.boolean()
}).partial().strict()
const conversation = z.object({
  ...common, model: nullableText, codexModel: nullableText, llmProvider: provider.nullable(),
  permissionMode: permission.nullable(), title: text, projectId: nullableText, skills: strings,
  contextPresetId: nullableText, kbMode: z.enum(['auto', 'manual', 'off']), disabledContext: strings,
  previewUrl: text.refine(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }).nullable(),
  previewEngine: z.enum(['proxy', 'chromium']), loadServiceData: z.boolean()
}).partial().strict()
const envelope = { version: z.literal(1), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }
const patch = z.discriminatedUnion('owner', [
  z.object({ ...envelope, owner: z.literal('account'), values: account }).strict(),
  z.object({ ...envelope, owner: z.literal('conversation'), values: conversation }).strict()
])

export class InvalidChatSettings extends Error {}

export function parseChatSettingsPatch(value: unknown): ChatSettingsPatch {
  const result = patch.safeParse(value)
  if (!result.success) throw new InvalidChatSettings('Invalid chat settings patch')
  return result.data as ChatSettingsPatch
}
