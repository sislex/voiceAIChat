import { describe, expect, it } from 'vitest'
import { isKnownServerErrorCode, serverErrorMessage } from './serverErrors'

describe('перевод кодов ответов сервера', () => {
  it('короткий код превращается в объяснение, а не остаётся кодом', () => {
    expect(serverErrorMessage({ error: 'forbidden' })).toBe('Недостаточно прав для этого действия.')
    expect(serverErrorMessage({ error: 'csrf' })).toContain('Обновите страницу')
    expect(serverErrorMessage({ error: 'machine_offline' })).toBe('Машина не в сети.')
  })

  it('отказ по возможностям типа берёт название подсистемы из тела', () => {
    expect(serverErrorMessage({ error: 'feature_unavailable', feature: 'ci' })).toContain('CI-ранов')
  })

  it('неизвестный код возвращается как есть — информацию не теряем', () => {
    expect(serverErrorMessage({ error: 'что-то_новое' })).toBe('что-то_новое')
    // Готовая человеческая фраза от сервера тоже проходит насквозь.
    expect(serverErrorMessage({ error: 'Другой деплой уже выполняется' })).toBe('Другой деплой уже выполняется')
  })

  it('поле message используется, если error пустой', () => {
    expect(serverErrorMessage({ message: 'Что-то пошло не так' })).toBe('Что-то пошло не так')
    expect(serverErrorMessage(null)).toBe('')
    expect(serverErrorMessage({})).toBe('')
  })

  it('список известных кодов покрывает те, что реально шлёт сервер', () => {
    // Список снят грепом по apps/server: если появится новый код, тест напомнит
    // добавить перевод, а не оставлять его пользователю в тосте.
    for (const code of [
      'unauthorized', 'forbidden', 'csrf', 'password_change_required', 'token_missing',
      'unavailable', 'runner_unavailable', 'browser_runner', 'preview_unavailable',
      'machine_offline', 'no_online_machine', 'offline', 'run_exists',
      'codex_thread_in_use', 'invalid_url', 'feature_unavailable',
      // Именно с пробелом: так 404 отдаётся в полусотне мест сервера. Раньше в
      // таблице лежал `not_found`, которого сервер не шлёт нигде, и человек
      // видел в тосте английское «not found».
      'not found'
    ]) {
      expect(isKnownServerErrorCode(code), code).toBe(true)
    }
  })

  it('код с пробелом переводится так же, как с подчёркиванием', () => {
    expect(serverErrorMessage({ error: 'not found' })).toBe('Объект не найден.')
    expect(serverErrorMessage({ error: 'Not Found' })).toBe('Объект не найден.')
    expect(serverErrorMessage({ error: 'not_found' })).toBe('Объект не найден.')
  })
})

describe('коды панели кода переводятся', () => {
  it('технический код не доходит до человека', () => {
    // Раньше в панели вместо объяснения показывался `workspace_not_found`.
    expect(serverErrorMessage({ error: 'workspace_not_found' })).toContain('Рабочая копия не найдена')
    expect(serverErrorMessage({ error: 'protected_branch' })).toContain('merge-ран')
    expect(serverErrorMessage({ error: 'git_credentials_missing' })).toContain('токен')
    expect(serverErrorMessage({ error: 'dirty_worktree' })).toContain('незакоммиченные')
    expect(serverErrorMessage({ error: 'confirmation_mismatch' })).toContain('имя ветки')
  })
})
