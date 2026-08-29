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
  not_found: 'Объект не найден.'
}

/**
 * Текст для человека по телу ответа. Неизвестный код возвращается как есть —
 * терять информацию хуже, чем показать технический текст.
 */
export function serverErrorMessage(body: { error?: unknown; message?: unknown; feature?: unknown } | null): string {
  const code = typeof body?.error === 'string' ? body.error : null
  if (code === 'feature_unavailable') return featureUnavailableMessage(body?.feature)
  if (code && MESSAGES[code]) return MESSAGES[code]
  const value = body?.error ?? body?.message
  return typeof value === 'string' ? value : ''
}

/** Известен ли код: нужно тестам и отладке, чтобы видеть непокрытые ответы. */
export function isKnownServerErrorCode(code: string): boolean {
  return code === 'feature_unavailable' || code in MESSAGES
}
