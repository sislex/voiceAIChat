// Технические коды ответов сервера → текст для человека.
//
// Сервер отвечает короткими кодами (`forbidden`, `csrf`, `machine_offline`) —
// это удобно для клиентов и логов, но в тосте такой код ничего не объясняет и
// подталкивает повторить бесполезное действие. Перевод живёт здесь, а
// применяется один раз в транспорте: иначе каждый экран переводил бы по-своему.
import { featureUnavailableMessage } from './projectTypes'

/** Коды, у которых текст не зависит от контекста ответа. */
const MESSAGES: Readonly<Record<string, string>> = {
  unauthorized: 'Сессия истекла — войдите заново.',
  forbidden: 'Недостаточно прав для этого действия.',
  csrf: 'Запрос отклонён по защите от подделки. Обновите страницу и повторите.',
  password_change_required: 'Сначала смените временный пароль — до этого доступно только чтение.',
  token_missing: 'Не передан токен доступа.',
  unavailable: 'Сервис временно недоступен.',
  runner_unavailable: 'Исполнитель недоступен — проверьте, запущен ли он.',
  browser_runner: 'Браузерный исполнитель недоступен.',
  preview_unavailable: 'Превью недоступно для этой задачи.',
  machine_offline: 'Машина не в сети.',
  no_online_machine: 'Нет ни одной машины в сети.',
  offline: 'Нет связи с сервером.',
  run_exists: 'Такой ран уже запущен.',
  codex_thread_in_use: 'Диалог Codex занят другим раном.',
  invalid_url: 'Некорректный адрес.',
  not_found: 'Объект не найден.',
  // Панель кода: коды отказов git. Без перевода человек видел в тосте
  // `workspace_not_found` и не понимал, что делать.
  workspace_not_found: 'Рабочая копия не найдена — возможно, её удалили вместе с задачей.',
  workspace_released: 'Рабочая копия удалена cleanup-шагом рана — запустите ран задачи заново.',
  workspace_busy: 'Каталог занят активным раном: смотреть можно, менять — нет.',
  path_missing: 'У рабочей копии не задан каталог — проверьте настройки проекта.',
  not_a_repository: 'В каталоге нет git-репозитория.',
  read_only_workspace: 'Эта рабочая копия доступна только для чтения.',
  read_only_machine: 'Изменение рабочей копии запрещено: роль, режим доступа машины или её политика.',
  dirty_worktree: 'В рабочей копии есть незакоммиченные изменения — закоммитьте или отбросьте их.',
  protected_branch: 'В main, master и release/* панель не отправляет: это делают merge-ран и релизы.',
  push_rejected: 'Origin отклонил отправку: ветка ушла вперёд — подтяните изменения и повторите.',
  push_not_confirmed: 'В origin не оказалось отправленного коммита — повторите отправку.',
  git_credentials_missing: 'Git-доступ на машине не настроен: добавьте токен в настройках проекта.',
  git_locked: 'Git занят другой операцией в этом каталоге (index.lock) — повторите через несколько секунд.',
  git_busy: 'В этой рабочей копии уже идёт операция — дождитесь её окончания.',
  git_timeout: 'Команда git не завершилась за отведённое время.',
  git_failed: 'Команда git завершилась ошибкой.',
  nothing_to_commit: 'Коммитить нечего: в рабочей копии нет изменений.',
  nothing_to_discard: 'Отбрасывать нечего: выбранные файлы не изменены.',
  confirmation_mismatch: 'Подтверждение не совпало — введите имя ветки точно.',
  not_conflicted: 'У файла нет конфликтных стадий — возможно, конфликт уже разрешён.',
  detached_head: 'HEAD не на ветке — сначала переключитесь на ветку.',
  command_denied: 'Команда запрещена политикой проекта или роли.',
  invalid_branch: 'Недопустимое имя ветки.',
  invalid_ref: 'Недопустимая ревизия.',
  invalid_path: 'Недопустимый путь файла.',
  invalid_message: 'Сообщение коммита пустое или слишком длинное.',
  file_too_large: 'Файл больше допустимого размера для правки.'
}

/**
 * Текст для человека по телу ответа. Неизвестный код возвращается как есть —
 * терять информацию хуже, чем показать технический текст.
 */
export function serverErrorMessage(body: { error?: unknown; message?: unknown; feature?: unknown } | null): string {
  const code = typeof body?.error === 'string' ? normalizeServerErrorCode(body.error) : null
  if (code === 'feature_unavailable') return featureUnavailableMessage(body?.feature)
  if (code && MESSAGES[code]) return MESSAGES[code]
  const value = body?.error ?? body?.message
  return typeof value === 'string' ? value : ''
}

/**
 * Коды сервера пишутся то через пробел, то через подчёркивание: 404 почти везде
 * отдаётся как `not found`, а остальные — как `feature_unavailable`. Приводим к
 * одной форме, иначе таблица переводов промахивается мимо самого частого ответа
 * и человек видит английский технический текст.
 */
function normalizeServerErrorCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '_')
}

/** Известен ли код: нужно тестам и отладке, чтобы видеть непокрытые ответы. */
export function isKnownServerErrorCode(code: string): boolean {
  const normalized = normalizeServerErrorCode(code)
  return normalized === 'feature_unavailable' || normalized in MESSAGES
}
