// Домен «settings»: таблицы settings, app_config, schema_migrations.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { DEFAULT_SETTINGS, normalizeChatInstructions, type Settings } from '@voicechat/shared'
import { BaseRepo } from './base.js'
import { settingsKey } from './support.js'

export class SettingsRepo extends BaseRepo {
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
  }
}
