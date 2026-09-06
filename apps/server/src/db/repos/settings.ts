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
  getSettings(userId: string): Settings {
    const settings = this.readSettings(userId)
    const stored = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(settingsKey(userId)) as { value: string } | undefined
    if (!stored) return settings
    try {
      const parsed = JSON.parse(stored.value) as Partial<Settings>
      const missing = (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).filter((key) => parsed[key] === undefined)
      if (missing.length) this.saveSettings(userId, settings)
    } catch {
      // Повреждённую запись переписываем дефолтами: читать её всё равно нечем.
      this.saveSettings(userId, settings)
    }
    return settings
  }

  /** Чистое чтение записи с мержем дефолтов — без побочной записи в БД. */
  readSettings(userId: string): Settings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(settingsKey(userId)) as { value: string } | undefined
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

  saveSettings(userId: string, settings: Settings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(settingsKey(userId), JSON.stringify(settings))
  }

  getAppConfig(key: string): string | null {
    const r = this.db.prepare(`SELECT value FROM app_config WHERE key = ?`).get(key) as { value: string } | undefined
    return r?.value ?? null
  }

  setAppConfig(key: string, value: string): void {
    this.db.prepare(`INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
  }
}
