import { CHAT_SETTING_OWNERS, type ChatSettingValue, type Conversation } from '@voicechat/shared'

export type Values = Record<string, ChatSettingValue>

/** Project only the S1 inventory; device and unrelated account data stay out. */
export function accountValues(settings: object): Values {
  const source = settings as Values
  return Object.fromEntries(CHAT_SETTING_OWNERS.account.filter(key => source[key] !== undefined)
    .map(key => [key, source[key]!]))
}

/** Adapt legacy names at the persistence boundary, never in individual hosts. */
export function conversationValues(c: Conversation, previous: Values = {}): Values {
  return {
    loadServiceData: previous.loadServiceData === true,
    title: c.title, projectId: c.projectId ?? null, execTarget: c.execTarget, workdir: c.workdir,
    skills: c.skillNames, llmEngineId: c.llmEngineId ?? null, llmProvider: c.llmProvider,
    model: c.llmProvider === 'codex' ? previous.model ?? null : c.llmModel,
    codexModel: c.llmProvider === 'codex' ? c.llmModel : previous.codexModel ?? null,
    permissionMode: c.permissionMode,
    contextPresetId: settingsJson(c.disabledContext ?? []) === settingsJson(previous.disabledContext ?? [])
      ? previous.contextPresetId ?? null : null,
    kbMode: c.kbContextMode ?? 'auto', disabledContext: c.disabledContext ?? [],
    previewUrl: c.previewUrl ?? null, previewEngine: c.previewEngine ?? 'proxy'
  }
}

/** Comparison ignores object property ordering from JSON clients. */
export function settingsJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}
