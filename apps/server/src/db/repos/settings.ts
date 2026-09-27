// Домен «settings»: таблицы settings, app_config, schema_migrations.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { DEFAULT_SETTINGS, normalizeChatInstructions, sanitizeSettingsPatch, applyChatSettingsPatch, createChatSettingsSnapshot, type ChatSettingsSnapshot, type ChatSettingsConflict, type Settings } from '@voicechat/shared'
import { BaseRepo } from './base.js'
import { settingsKey } from './support.js'
import { accountValues, conversationValues, settingsJson, type Values } from './chatSettings.js'
import { InvalidChatSettings, parseChatSettingsPatch } from '../../chatSettingsValidation.js'

interface CanonicalSettingsState {
  version: 1
  revision: number
  account: Values
  conversations: Record<string, Values>
}
const canonicalKey = (userId: string): string => `chat-settings-v1:${userId}`

export class SettingsRepo extends BaseRepo {
  /** Remove migrated conversation preferences along with the source conversation. */
  async deleteConversationChatSettings(userId: string, conversationId: string): Promise<void> {
    await this.sql.transaction(async () => {
      const key = canonicalKey(userId)
      await this.sql.run('UPDATE settings SET value = value WHERE key = ?', [key])
      const row = await this.sql.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
      if (!row) return
      const state = JSON.parse(row.value) as CanonicalSettingsState
      if (!Object.hasOwn(state.conversations, conversationId)) return
      delete state.conversations[conversationId]
      state.revision++
      await this.sql.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(state), key])
    })
  }

  async getChatSettings(userId: string, conversationId?: string): Promise<ChatSettingsSnapshot | null> {
    const result = await this.chatSettings(userId, conversationId)
    if (result && 'code' in result) throw Error('Unexpected settings conflict on read')
    return result
  }

  async patchChatSettings(userId: string, input: unknown, conversationId?: string): Promise<ChatSettingsSnapshot | ChatSettingsConflict | null> {
    return this.chatSettings(userId, conversationId, parseChatSettingsPatch(input))
  }

  private async chatSettings(userId: string, conversationId?: string, input?: unknown): Promise<ChatSettingsSnapshot | ChatSettingsConflict | null> {
    const patch = input === undefined ? undefined : parseChatSettingsPatch(input)
    if (patch?.owner === 'conversation' && !conversationId) throw new InvalidChatSettings('Conversation required')
    const run = () => this.sql.transaction(async () => {
      const key = canonicalKey(userId)
      // INSERT/UPDATE acquires a database lock on both supported SQL adapters.
      // A process-local mutex would allow two Core hosts to accept the same revision.
      await this.sql.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
        [key, JSON.stringify({ version: 1, revision: 0, account: {}, conversations: {} })])
      await this.sql.run('UPDATE settings SET value = value WHERE key = ?', [key])
      const row = await this.sql.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
      const state = JSON.parse(row!.value) as CanonicalSettingsState
      if (state.version !== 1 || !Number.isSafeInteger(state.revision)) throw Error('Unsupported persisted chat settings')
      // Lock legacy records before reading, so legacy writers cannot interleave with the patch.
      await this.sql.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
        [settingsKey(userId), JSON.stringify(DEFAULT_SETTINGS)])
      await this.sql.run('UPDATE settings SET value = value WHERE key = ?', [settingsKey(userId)])
      if (conversationId) await this.repos.chat.lockChatSettings(userId, conversationId)
      const conversation = conversationId ? await this.repos.chat.getConversation(userId, conversationId) : null
      if (conversationId && !conversation) return null
      const legacy = await this.getSettings(userId)
      const account = accountValues({ ...DEFAULT_SETTINGS, ...sanitizeSettingsPatch(legacy) })
      const previous = conversationId && Object.hasOwn(state.conversations, conversationId) ? state.conversations[conversationId] : undefined
      const values = conversation ? conversationValues(conversation, previous) : {}
      // Mixed-version clients still write legacy records. Detect those changes before CAS.
      if ((Object.keys(state.account).length && settingsJson(account) !== settingsJson(state.account))
        || (previous && settingsJson(values) !== settingsJson(previous))) state.revision++
      state.account = account
      if (conversationId) Object.defineProperty(state.conversations, conversationId, { value: values, enumerable: true, writable: true, configurable: true })
      const snapshot = (): ChatSettingsSnapshot => createChatSettingsSnapshot({ version: 1, revision: state.revision,
        account: state.account, conversation: conversationId ? state.conversations[conversationId]! : {}, device: {} })
      let result: ChatSettingsSnapshot | ChatSettingsConflict = snapshot()
      if (patch) {
        result = applyChatSettingsPatch(result, patch)
        if (!('code' in result)) {
          if (patch.owner === 'account') {
            await this.saveSettings(userId, { ...legacy, ...sanitizeSettingsPatch(patch.values) })
            state.account = accountValues(await this.readSettings(userId))
          } else {
            const updated = { ...patch.values }
            if (updated.contextPresetId !== undefined && updated.contextPresetId !== null) {
              const preset = legacy.contextPresets.find(item => item.id === updated.contextPresetId)
              if (!preset) throw new InvalidChatSettings('Context preset not found')
              if (updated.disabledContext === undefined) updated.disabledContext = preset.disabled
            }
            // Selecting a provider restores that provider's saved model.
            if (updated.llmProvider !== undefined) {
              const modelKey = updated.llmProvider === 'codex' ? 'codexModel' : 'model'
              if (updated[modelKey] === undefined) updated[modelKey] = values[modelKey] ?? null
            }
            await this.repos.chat.applyCanonicalSettings(userId, conversationId!, updated)
            state.conversations[conversationId!] = conversationValues((await this.repos.chat.getConversation(userId, conversationId!))!,
              { ...values, ...updated })
          }
          state.revision++
          result = snapshot()
        }
      }
      await this.sql.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(state), key])
      return result
    })
    for (let attempt = 0; ; attempt++) {
      try { return await run() } catch (error) {
        const code = (error as { code?: string }).code
        if (attempt >= 3 || !['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', '40001', '40P01'].includes(code ?? '')) throw error
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)))
      }
    }
  }
  /**
   * Читает настройки и **фиксирует** дефолты полей, которых в записи ещё не
   * было. Без этого «поле появилось в релизе» и «человек выбрал такое
   * значение» неотличимы: смена дефолта в следующем релизе молча переезжала бы
   * всем, кто ничего не менял. Дозаполнение — разовая запись на пользователя.
   */
  async getSettings(userId: string): Promise<Settings> {
    const settings = await this.readSettings(userId)
    const stored = (await this.sql.get(`SELECT value FROM settings WHERE key = ?`, [settingsKey(userId)])) as { value: string } | undefined
    if (!stored) return settings
    try {
      const parsed = JSON.parse(stored.value) as Partial<Settings>
      const missing = (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).filter((key) => parsed[key] === undefined)
      if (missing.length) await this.saveSettings(userId, settings)
    } catch {
      // Повреждённую запись переписываем дефолтами: читать её всё равно нечем.
      await this.saveSettings(userId, settings)
    }
    return settings
  }

  /** Чистое чтение записи с мержем дефолтов — без побочной записи в БД. */
  async readSettings(userId: string): Promise<Settings> {
    const row = (await this.sql.get(`SELECT value FROM settings WHERE key = ?`, [settingsKey(userId)])) as { value: string } | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    try {
      // Мержим с дефолтами, чтобы новые поля не ломали старый конфиг.
      const parsed = JSON.parse(row.value) as Partial<Settings>
      const generatedFilesTtlDays = Number.isInteger(parsed.generatedFilesTtlDays) && parsed.generatedFilesTtlDays! >= 1 && parsed.generatedFilesTtlDays! <= 3650
        ? parsed.generatedFilesTtlDays!
        : DEFAULT_SETTINGS.generatedFilesTtlDays
      return { ...DEFAULT_SETTINGS, ...parsed, generatedFilesTtlDays, personalization: { ...DEFAULT_SETTINGS.personalization, ...parsed.personalization }, chatInstructions: normalizeChatInstructions(parsed.chatInstructions) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async saveSettings(userId: string, settings: Settings): Promise<void> {
    await this.sql.run(`INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [settingsKey(userId), JSON.stringify(settings)])
  }

  async getAppConfig(key: string): Promise<string | null> {
    const r = (await this.sql.get(`SELECT value FROM app_config WHERE key = ?`, [key])) as { value: string } | undefined
    return r?.value ?? null
  }

  async setAppConfig(key: string, value: string): Promise<void> {
    await this.sql.run(`INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value])
  }

  /** Каскад удаления аккаунта: запись настроек пользователя. */
  async deleteUserSettings(userId: string): Promise<void> {
    await this.sql.run(`DELETE FROM settings WHERE key = ?`, [settingsKey(userId)])
    await this.sql.run('DELETE FROM settings WHERE key = ?', [canonicalKey(userId)])
  }
}
